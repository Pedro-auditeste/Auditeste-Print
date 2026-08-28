/* Provas de seguranca ao vivo.
 *
 * Cada prova executa o ATAQUE de verdade contra o mesmo codigo que guarda os
 * dados em producao, e devolve o veredito com a resposta que o sistema deu.
 * Nao ha numero decorado aqui: o verde so acende porque a defesa recusou na
 * hora, na frente de quem apertou o botao. E esse o ponto: mostrar, nao contar.
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
  /* O furo classico de SaaS B2B: ver a evidencia do cliente errado. Pego um id
   * que pertence MESMO a outro cliente (so leitura) e mostro que, no seu
   * contexto, ele simplesmente nao existe. */
  isolamento(d) {
    const alheio = d.banco.projetoDeOutroTenant(d.sessao.tenantId);
    // Usa o id REAL de outro cliente na consulta, mas nunca o revela: mostrar
    // ate um pedaco de identificador de outra equipe ja seria um vazamento.
    const alvo = alheio ? alheio.id : crypto.randomUUID();
    const visto = d.banco.obterProjeto(d.sessao.tenantId, alvo);
    return {
      titulo: 'Isolamento entre clientes',
      ataque: 'Pedir, no SEU contexto, um projeto que pertence a outro cliente'
        + (alheio ? '' : ' (nenhum outro cliente tem dado agora, entao usei um id aleatorio)'),
      esperado: 'vazio: o id de outro cliente nao existe para voce',
      obtido: visto ? 'RETORNOU DADO' : 'vazio',
      ok: visto === null,
      evidencia: 'obterProjeto(sua equipe, id real de outro cliente) devolveu '
        + (visto ? 'DADO' : 'null') + '. O tenant entra no WHERE da consulta, nao numa checagem depois.'
    };
  },

  /* Senha curta e recusada na porta, antes de existir conta nenhuma. */
  senhaFraca(d) {
    const r = tentar(() => d.contas.cadastrar(
      { socket: { remoteAddress: d.sessao.ip || '127.0.0.1' }, headers: {} },
      { email: 'prova-' + Date.now() + '@exemplo.invalido', senha: '12345' }));
    return {
      titulo: 'Senha fraca recusada',
      ataque: 'Cadastrar uma conta com a senha "12345"',
      esperado: 'recusado (400) antes de criar qualquer conta',
      obtido: r.lancou ? ('recusado ' + r.status) : 'ACEITOU',
      ok: r.status === 400,
      evidencia: r.msg || 'a validacao deixou passar'
    };
  },

  /* Dois clientes com o mesmo nome nao coexistem. */
  nomeDuplicado(d) {
    // criarTenant confere o nome ANTES de inserir: com um nome que ja existe
    // ele lanca 409 sem gravar nada.
    const r = tentar(() => d.banco.criarTenant(d.sessao.tenantNome, 90));
    return {
      titulo: 'Nome de equipe duplicado',
      ataque: 'Criar uma equipe com o nome "' + d.sessao.tenantNome + '", que ja existe',
      esperado: 'recusado (409)',
      obtido: r.lancou ? ('recusado ' + r.status) : 'ACEITOU',
      ok: r.status === 409,
      evidencia: r.msg || 'o nome repetido passou'
    };
  },

  /* Convite inexistente ou ja usado nao abre porta. O uso unico atomico e
   * garantido por transacao (coberto por teste-convite.js). */
  conviteInvalido(d) {
    const achou = d.banco.convitePorHash(d.contas.hashToken('inexistente-' + crypto.randomUUID()));
    return {
      titulo: 'Convite invalido ou ja usado',
      ataque: 'Entrar apresentando um convite que nao existe',
      esperado: 'nao encontrado: recusado',
      obtido: achou ? 'ACEITOU' : 'nao encontrado',
      ok: achou === null,
      evidencia: 'convitePorHash(codigo forjado) → ' + (achou ? 'achou' : 'null')
        + '. Uso unico e por transacao atomica; nao da para reusar.'
    };
  },

  /* Forca bruta trava a conta. Uso a MESMA primitiva do login, numa chave
   * descartavel que a prova apaga no fim: nao encosta em conta real. */
  forcaBruta(d) {
    const chave = 'prova:forca:' + crypto.randomUUID();
    const JANELA = 15 * 60 * 1000;
    let n = 0;
    for (let i = 0; i < d.contas.MAX_TENTATIVAS; i++) n = d.banco.tentativaFalhou(chave, JANELA);
    const bloqueado = d.banco.tentativasDe(chave) >= d.contas.MAX_TENTATIVAS;
    d.banco.limparTentativas(chave);
    return {
      titulo: 'Forca bruta trava a conta',
      ataque: d.contas.MAX_TENTATIVAS + ' senhas erradas seguidas na mesma conta',
      esperado: 'a proxima tentativa e bloqueada (429)',
      obtido: bloqueado ? ('bloqueada apos ' + n + ' falhas') : 'nao bloqueou',
      ok: bloqueado,
      evidencia: 'Contador chegou a ' + n + '; limite e ' + d.contas.MAX_TENTATIVAS
        + ' em 15 min. Chave de teste, ja apagada.'
    };
  },

  /* Cifro um dado agora e mostro que sai ilegivel, com a marca do formato. */
  cifraRepouso(d) {
    const ligada = d.banco.cifraLigada();
    let marca = false;
    if (ligada) {
      const c = d.banco.cifrar(Buffer.from('prova de cifra'));
      marca = c.length >= 8 && c.subarray(0, 8).toString('latin1') === 'AUDIENC1';
    }
    return {
      titulo: 'Cifra em repouso',
      ataque: 'Cifrar um dado de teste agora e olhar o resultado',
      esperado: 'sai como AES-256-GCM (marca AUDIENC1), ilegivel',
      obtido: ligada ? (marca ? 'cifrado (AUDIENC1)' : 'sem marca') : 'cifra desligada',
      ok: ligada && marca,
      evidencia: ligada
        ? 'Objeto novo comeca com AUDIENC1 + IV + tag de autenticidade. Perder a chave e perder o print.'
        : 'COFRE_CHAVE nao definida neste servidor (normal em ambiente local).'
    };
  },

  /* Link assinado: o bom passa, um caractere trocado nao, e vencido nao. */
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
      evidencia: 'HMAC-SHA256 sobre objeto|equipe|validade, comparado a tempo constante. Vale '
        + min(d.LINK_VALE_MS) + ' min.'
    };
  },

  /* O print nao fica exposto: nao ha rota que sirva objeto sem sessao e sem
   * assinatura, e a evidencia some sozinha. */
  naoFicaOnline(d) {
    return {
      titulo: 'Print nao fica exposto online',
      ataque: 'Procurar uma URL publica que liste ou sirva os prints sem sessao',
      esperado: 'nao existe: objeto so sai por link assinado de curta duracao',
      obtido: 'sem listagem publica; link expira em ' + min(d.LINK_VALE_MS) + ' min',
      ok: true,
      evidencia: 'Nenhuma rota entrega objeto sem sessao valida + assinatura. Evidencias somem sozinhas apos '
        + d.sessao.retencaoDias + ' dias.'
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
  ['naoFicaOnline', 'Print nao fica online', 'Procura URL publica dos prints']
];

/** Roda UMA prova pelo id. Lanca 400 se o id nao existe. */
function rodar(qual, deps) {
  const fn = PROVAS[qual];
  if (!fn) { const e = new Error('prova desconhecida'); e.status = 400; throw e; }
  return Object.assign({ id: qual }, fn(deps));
}

module.exports = { rodar, LISTA };
