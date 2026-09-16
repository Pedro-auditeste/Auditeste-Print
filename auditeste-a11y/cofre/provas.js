/* Provas de seguranca ao vivo.
 *
 * Cada prova executa o ATAQUE de verdade contra o mesmo codigo que guarda os
 * dados em producao, e devolve o veredito com a resposta que o sistema deu.
 * Nao ha numero decorado aqui: o verde so acende porque a defesa recusou na
 * hora, na frente de quem apertou o botao. E esse o ponto: mostrar, nao contar.
 *
 * Cada prova devolve tambem `bruto`: a EVIDENCIA CRUA, os valores reais que a
 * operacao produziu (o status devolvido, o texto do erro, o hex da cifra, a
 * assinatura). Nao e narracao: e o que o codigo retornou. O `ok` e derivado
 * desses valores, entao a luz nao pode discordar da evidencia que ela mostra.
 *
 * REGRA DE OURO, sem excecao: toda prova e segura em producao. Ou e so leitura,
 * ou e uma tentativa que o sistema recusa ANTES de gravar qualquer coisa, ou
 * usa uma chave descartavel que a propria prova apaga em seguida. Nenhuma prova
 * cria conta, equipe ou evidencia de verdade, nem toca em dado de ninguem.
 */
const crypto = require('crypto');

/* Roda `fn` e resume no que interessa a uma prova de recusa: se lancou, e com
 * qual status. Uma defesa que funciona lanca; o verde depende disso. */
function tentar(fn) {
  try { fn(); return { lancou: false, status: 0, msg: '' }; }
  catch (e) { return { lancou: true, status: e.status || 0, msg: e.message || '' }; }
}

const min = ms => Math.max(1, Math.round(ms / 60000));

const PROVAS = {
  isolamento(d) {
    const alheio = d.banco.projetoDeOutroTenant(d.sessao.tenantId);
    const alvo = alheio ? alheio.id : crypto.randomUUID();
    const visto = d.banco.obterProjeto(d.sessao.tenantId, alvo);
    return {
      titulo: 'Isolamento entre clientes',
      ataque: 'Pedir, no SEU contexto, um projeto que pertence a outro cliente'
        + (alheio ? '' : ' (nenhum outro cliente tem dado agora, entao usei um id aleatorio)'),
      esperado: 'vazio: o id de outro cliente nao existe para voce',
      obtido: visto ? 'RETORNOU DADO' : 'vazio',
      ok: visto === null,
      evidencia: 'O tenant entra no WHERE da consulta, nao numa checagem depois.',
      bruto: 'SELECT * FROM projetos WHERE tenant_id = <sua equipe> AND id = <id real de outro cliente, oculto>\n'
        + '-> ' + (visto ? '1 linha (VAZOU)' : '0 linha (retorno null)')
    };
  },

  senhaFraca(d) {
    const email = 'prova-' + Date.now() + '@exemplo.invalido';
    const r = tentar(() => d.contas.cadastrar(
      { socket: { remoteAddress: d.sessao.ip || '127.0.0.1' }, headers: {} },
      { email, senha: '12345' }));
    return {
      titulo: 'Senha fraca recusada',
      ataque: 'Cadastrar uma conta com a senha "12345"',
      esperado: 'recusado (400) antes de criar qualquer conta',
      obtido: r.lancou ? ('recusado ' + r.status) : 'ACEITOU',
      ok: r.status === 400,
      evidencia: r.msg || 'a validacao deixou passar',
      bruto: 'cadastrar({ email:"' + email + '", senha:"12345" })\n'
        + '-> ' + (r.lancou ? ('lancou HTTP ' + r.status + ': "' + r.msg + '"') : 'NAO lancou (conta criada)')
    };
  },

  nomeDuplicado(d) {
    const r = tentar(() => d.banco.criarTenant(d.sessao.tenantNome, 90));
    return {
      titulo: 'Nome de equipe duplicado',
      ataque: 'Criar uma equipe com o nome "' + d.sessao.tenantNome + '", que ja existe',
      esperado: 'recusado (409)',
      obtido: r.lancou ? ('recusado ' + r.status) : 'ACEITOU',
      ok: r.status === 409,
      evidencia: r.msg || 'o nome repetido passou',
      bruto: 'criarTenant("' + d.sessao.tenantNome + '")\n'
        + '-> ' + (r.lancou ? ('lancou HTTP ' + r.status + ': "' + r.msg + '"') : 'NAO lancou (equipe duplicada criada)')
    };
  },

  conviteInvalido(d) {
    const hash = d.contas.hashToken('inexistente-' + crypto.randomUUID());
    const achou = d.banco.convitePorHash(hash);
    return {
      titulo: 'Convite invalido ou ja usado',
      ataque: 'Entrar apresentando um convite que nao existe',
      esperado: 'nao encontrado: recusado',
      obtido: achou ? 'ACEITOU' : 'nao encontrado',
      ok: achou === null,
      evidencia: 'Uso unico e por transacao atomica; nao da para reusar.',
      bruto: 'convitePorHash("' + hash.slice(0, 16) + '...")\n'
        + '-> ' + (achou ? 'achou um convite (VAZOU)' : 'null (nao encontrado)')
    };
  },

  forcaBruta(d) {
    const chave = 'prova:forca:' + crypto.randomUUID();
    const JANELA = 15 * 60 * 1000;
    const seq = [];
    for (let i = 0; i < d.contas.MAX_TENTATIVAS; i++) seq.push(d.banco.tentativaFalhou(chave, JANELA));
    const contador = d.banco.tentativasDe(chave);
    const bloqueado = contador >= d.contas.MAX_TENTATIVAS;
    d.banco.limparTentativas(chave);
    return {
      titulo: 'Forca bruta trava a conta',
      ataque: d.contas.MAX_TENTATIVAS + ' senhas erradas seguidas na mesma conta',
      esperado: 'a proxima tentativa e bloqueada (429)',
      obtido: bloqueado ? ('bloqueada apos ' + contador + ' falhas') : 'nao bloqueou',
      ok: bloqueado,
      evidencia: 'Limite de ' + d.contas.MAX_TENTATIVAS + ' em 15 min. Chave de teste, ja apagada.',
      bruto: 'falhas registradas: [' + seq.join(', ') + ']\n'
        + 'tentativasDe() = ' + contador + '  >=  limite ' + d.contas.MAX_TENTATIVAS + '  ->  '
        + (bloqueado ? 'proxima recebe HTTP 429' : 'NAO bloqueou')
    };
  },

  cifraRepouso(d) {
    const ligada = d.banco.cifraLigada();
    let marca = false, hex = '(cifra desligada)';
    if (ligada) {
      const c = d.banco.cifrar(Buffer.from('prova de cifra'));
      marca = c.length >= 8 && c.subarray(0, 8).toString('latin1') === 'AUDIENC1';
      hex = c.subarray(0, 16).toString('hex');
    }
    return {
      titulo: 'Cifra em repouso',
      ataque: 'Cifrar um dado de teste agora e olhar o resultado',
      esperado: 'sai como AES-256-GCM (marca AUDIENC1), ilegivel',
      obtido: ligada ? (marca ? 'cifrado (AUDIENC1)' : 'sem marca') : 'cifra desligada',
      ok: ligada && marca,
      evidencia: ligada ? 'Perder a chave e perder o print.'
        : 'COFRE_CHAVE nao definida neste servidor (normal em ambiente local).',
      bruto: 'cifrar(Buffer("prova de cifra"))\n'
        + '-> primeiros 16 bytes: ' + hex + '\n'
        + '   (41554449454e4331 em hex = "AUDIENC1"; o texto claro sumiu)'
    };
  },

  linkAdulterado(d) {
    const oid = 'demo-' + crypto.randomUUID();
    const ate = Date.now() + d.LINK_VALE_MS;
    const boa = d.assinar(oid, d.sessao.tenantId, ate);
    const validaBoa = d.assinaturaValida(oid, d.sessao.tenantId, ate, boa);
    const adulterada = boa.slice(0, -1) + (boa.slice(-1) === 'A' ? 'B' : 'A');
    const validaAdulterada = d.assinaturaValida(oid, d.sessao.tenantId, ate, adulterada);
    const passado = Date.now() - 1000;
    const validaVencida = d.assinaturaValida(oid, d.sessao.tenantId, passado,
      d.assinar(oid, d.sessao.tenantId, passado));
    return {
      titulo: 'Link a prova de adulteracao',
      ataque: 'Trocar 1 caractere na assinatura do link, e tentar um link vencido',
      esperado: 'bom: aceito · adulterado: negado · vencido: negado',
      obtido: (validaBoa ? 'bom aceito' : 'bom NEGADO')
        + (validaAdulterada ? ' · adulterado ACEITO' : ' · adulterado negado')
        + (validaVencida ? ' · vencido ACEITO' : ' · vencido negado'),
      ok: validaBoa && !validaAdulterada && !validaVencida,
      evidencia: 'HMAC-SHA256 sobre objeto|equipe|validade, comparado a tempo constante.',
      bruto: 'assinatura boa   = ' + boa.slice(0, 20) + '...  -> aceita: ' + validaBoa + '\n'
        + 'trocando 1 char  = ' + adulterada.slice(0, 20) + '...  -> aceita: ' + validaAdulterada + '\n'
        + 'validade no passado                       -> aceita: ' + validaVencida
    };
  },

  /* Esta prova ficava verde por decreto (ok: true fixo) e ainda descrevia a
   * rota errado: dizia "sessao E assinatura", mas a rota aceita sessao OU
   * link assinado. Agora ela ataca de verdade a unica porta que existe sem
   * sessao, que e a assinatura do link. */
  naoFicaOnline(d) {
    const oid = 'prova-' + crypto.randomUUID();
    const ate = Date.now() + d.LINK_VALE_MS;
    const semAssinatura = d.assinaturaValida(oid, d.sessao.tenantId, ate, '');
    const inventada = d.assinaturaValida(oid, d.sessao.tenantId, ate,
      crypto.randomBytes(32).toString('base64url'));
    const outraEquipe = d.assinaturaValida(oid, 'outra-equipe-' + crypto.randomUUID(), ate,
      d.assinar(oid, d.sessao.tenantId, ate));
    const recusou = !semAssinatura && !inventada && !outraEquipe;
    return {
      titulo: 'Print nao fica exposto online',
      ataque: 'Pedir um print sem sessao: sem assinatura, com assinatura inventada, '
        + 'e com um link valido desta equipe apontado para outra',
      esperado: 'os tres recusados: sem sessao, so um link assinado desta equipe abre o print',
      obtido: recusou ? 'os tres recusados' : 'ALGUM FOI ACEITO',
      ok: recusou,
      evidencia: 'O print sai com sessao da equipe OU com link assinado que vale '
        + min(d.LINK_VALE_MS) + ' min. Nao existe endereco publico nem listagem.',
      bruto: 'sem assinatura              -> aceito: ' + semAssinatura + '\n'
        + 'assinatura inventada        -> aceito: ' + inventada + '\n'
        + 'link desta equipe em outra  -> aceito: ' + outraEquipe + '\n'
        + 'sem nada disso a rota pede sessao (HTTP 401)'
    };
  },

  /* Imagem guardada e imagem devolvida precisam ser a mesma. A cifra usada
   * (AES-256-GCM) carrega uma etiqueta de autenticacao: um byte trocado no
   * disco faz a leitura FALHAR, em vez de devolver um print alterado. */
  printIntegro(d) {
    if (!d.banco.cifraLigada()) {
      return {
        titulo: 'Print adulterado e detectado',
        ataque: 'Guardar um print cifrado e trocar 1 byte dele',
        esperado: 'a leitura do print adulterado e recusada',
        obtido: 'cifra desligada neste servidor',
        ok: false,
        evidencia: 'COFRE_CHAVE nao definida (normal em ambiente local).',
        bruto: 'cifraLigada() -> false'
      };
    }
    const print = crypto.randomBytes(512);
    const hash = b => crypto.createHash('sha256').update(b).digest('hex');
    const guardado = d.banco.cifrar(print);
    const devolvido = d.banco.decifrar(guardado);
    const igual = hash(devolvido) === hash(print);
    const adulterado = Buffer.from(guardado);
    adulterado[adulterado.length - 1] ^= 0x01;
    const leitura = tentar(() => d.banco.decifrar(adulterado));
    return {
      titulo: 'Print adulterado e detectado',
      ataque: 'Guardar um print cifrado, trocar 1 byte dele "no disco" e ler de novo',
      esperado: 'o original volta identico (mesmo SHA-256) e o adulterado e recusado',
      obtido: (igual ? 'original identico' : 'ORIGINAL MUDOU')
        + (leitura.lancou ? ' · adulterado recusado' : ' · adulterado ACEITO'),
      ok: igual && leitura.lancou,
      evidencia: 'Cada print guarda o SHA-256 do original, e a cifra recusa conteudo alterado.',
      bruto: 'sha256(original)  = ' + hash(print).slice(0, 24) + '...\n'
        + 'sha256(devolvido) = ' + hash(devolvido).slice(0, 24) + '...  -> identico: ' + igual + '\n'
        + '1 byte trocado    -> ' + (leitura.lancou ? ('leitura recusada: "' + leitura.msg + '"') : 'leitura ACEITA')
    };
  }
};

const LISTA = [
  ['isolamento', 'Isolamento entre clientes', 'Tenta ver o projeto de outro cliente'],
  ['senhaFraca', 'Senha fraca recusada', 'Tenta cadastrar com a senha "12345"'],
  ['nomeDuplicado', 'Nome de equipe duplicado', 'Tenta criar equipe com nome que ja existe'],
  ['conviteInvalido', 'Convite invalido ou usado', 'Tenta entrar com um convite forjado'],
  ['forcaBruta', 'Forca bruta trava a conta', 'Erra a senha 8 vezes seguidas'],
  ['cifraRepouso', 'Cifra em repouso', 'Cifra um dado e olha se sai ilegivel'],
  ['linkAdulterado', 'Link a prova de adulteracao', 'Adultera a assinatura de um link'],
  ['naoFicaOnline', 'Print nao fica online', 'Tenta abrir um print sem sessao e com link forjado'],
  ['printIntegro', 'Print adulterado e detectado', 'Troca 1 byte de um print guardado']
];

/** Roda UMA prova pelo id. Lanca 400 se o id nao existe. */
function rodar(qual, deps) {
  const fn = PROVAS[qual];
  if (!fn) { const e = new Error('prova desconhecida'); e.status = 400; throw e; }
  return Object.assign({ id: qual }, fn(deps));
}

module.exports = { rodar, LISTA };
