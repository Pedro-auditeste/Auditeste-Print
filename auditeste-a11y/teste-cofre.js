/* Critérios de aceite do Marco 1, do Caminho B, contra o servidor de verdade.
 *
 * Cada caso aqui é uma linha da checklist do diagnóstico. Não testa "abriu a
 * tela": testa que o Tenant B não alcança a evidência do Tenant A sabendo o
 * id dela, que o link expirado não devolve arquivo, e que excluir apaga o
 * objeto junto com o metadado.
 *
 *   node teste-cofre.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const PORTA = 8988;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-')), 'cofre.db');

let falhas = 0, feitos = 0;
let proc = null;

async function caso(nome, fn) {
  try {
    await fn();
    feitos++;
    console.log('  ok     ' + nome);
  } catch (err) {
    falhas++;
    console.log('  FALHOU ' + nome);
    console.log('           ' + String(err && err.message).split('\n')[0]);
  }
}

/* Cliente com pote de cookies: sem isso nada além do login funciona, e o
 * cookie é justamente o que está sendo testado. */
function navegador() {
  const potes = new Map();
  return {
    potes,
    async pedir(caminho, opcoes) {
      const o = Object.assign({ redirect: 'manual' }, opcoes || {});
      o.headers = Object.assign({}, o.headers || {});
      if (potes.size) {
        o.headers.cookie = [...potes].map(([k, v]) => k + '=' + v).join('; ');
      }
      if (o.json !== undefined) {
        o.headers['Content-Type'] = 'application/json';
        o.body = JSON.stringify(o.json);
        delete o.json;
      }
      const r = await fetch(BASE + caminho, o);
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const c of set) {
        const [par] = c.split(';');
        const i = par.indexOf('=');
        const nome = par.slice(0, i).trim();
        const valor = par.slice(i + 1).trim();
        if (!valor) potes.delete(nome); else potes.set(nome, valor);
      }
      const texto = await r.text();
      let corpo = null;
      try { corpo = JSON.parse(texto); } catch (e) { corpo = texto; }
      return { status: r.status, corpo, headers: r.headers, setCookie: set, bytes: texto.length };
    }
  };
}

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function esperarServidor() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + '/ping');
      if (r.ok) { await r.text(); return; }
    } catch (e) { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('o servidor não subiu');
}

async function principal() {
  /* ---------- semente ---------- */
  banco.abrir(ARQUIVO);
  const ailos = banco.criarTenant('Ailos', 90);
  const outro = banco.criarTenant('Outro Cliente', 30);

  const uAdmin = banco.criarUsuario('admin@auditeste.com', contas.hashSenha('senha-bem-longa-1'));
  banco.vincular(ailos.id, uAdmin.id, 'admin');

  const uConsultor = banco.criarUsuario('consultor@auditeste.com', contas.hashSenha('senha-bem-longa-2'));
  banco.vincular(ailos.id, uConsultor.id, 'consultor');

  const uIntruso = banco.criarUsuario('intruso@auditeste.com', contas.hashSenha('senha-bem-longa-3'));
  banco.vincular(outro.id, uIntruso.id, 'admin');

  const uSemVinculo = banco.criarUsuario('solto@auditeste.com', contas.hashSenha('senha-bem-longa-4'));

  /* Conta dedicada ao teste de forca bruta: martelar a do consultor travava
   * a conta e derrubava os casos seguintes. A trava funcionando e o ponto. */
  const uIsca = banco.criarUsuario('martelo@auditeste.com', contas.hashSenha('senha-bem-longa-5'));
  banco.vincular(ailos.id, uIsca.id, 'leitor');

  proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      /* 0.0.0.0 e nao loopback: o portao do Print so existe em servidor
       * exposto, e e justamente ele que estes casos medem. */
      PORT: String(PORTA), HOST: '0.0.0.0',
      COFRE_BANCO: ARQUIVO, COFRE_SEGREDO: 'segredo-de-teste',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.resume();
  proc.stderr.resume();
  await esperarServidor();

  console.log('\ncofre · identidade\n');

  const admin = navegador();
  const consultor = navegador();
  const intruso = navegador();
  const anonimo = navegador();

  await caso('anonimo nao lista projeto nenhum', async () => {
    const r = await anonimo.pedir('/api/projetos');
    assert.strictEqual(r.status, 401);
  });

  await caso('senha errada nao entra', async () => {
    const r = await admin.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'errada' } });
    assert.strictEqual(r.status, 401);
    assert.ok(!/senha|hash/i.test(JSON.stringify(r.corpo).replace(/E-mail ou senha/, '')),
      'a resposta não pode dizer qual dos dois estava errado');
  });

  await caso('conta sem vinculo a cliente nenhum nao entra', async () => {
    const n = navegador();
    const r = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'solto@auditeste.com', senha: 'senha-bem-longa-4' } });
    assert.strictEqual(r.status, 403);
  });

  await caso('login correto entra e o cookie e HttpOnly + SameSite', async () => {
    const r = await admin.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const c = (r.setCookie || []).join(' ');
    assert.ok(/HttpOnly/i.test(c), 'sem HttpOnly o script da página lê o token');
    assert.ok(/SameSite=Lax/i.test(c), 'sem SameSite o cookie viaja em pedido de outro site');
    assert.strictEqual(r.corpo.sessao.tenantNome, 'Ailos');
  });

  await caso('o token de sessao nao fica em texto no banco', async () => {
    const cru = admin.potes.get('cofre');
    assert.ok(cru, 'sem cookie');
    const achado = banco.obterSessao(cru);
    assert.strictEqual(achado, null, 'o valor do cookie não pode ser a chave da sessão no banco');
    assert.ok(banco.obterSessao(contas.hashToken(cru)), 'a sessão deveria existir pelo hash');
  });

  await caso('/api/eu responde com o cliente da sessao', async () => {
    const r = await admin.pedir('/api/eu');
    assert.strictEqual(r.corpo.autenticado, true);
    assert.strictEqual(r.corpo.tenantNome, 'Ailos');
    assert.strictEqual(r.corpo.papel, 'admin');
  });

  await caso('forca bruta trava a conta depois de MAX tentativas', async () => {
    const n = navegador();
    let travou = false;
    for (let i = 0; i < contas.MAX_TENTATIVAS + 2; i++) {
      const r = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'martelo@auditeste.com', senha: 'x' } });
      if (r.status === 429) { travou = true; break; }
    }
    assert.ok(travou, 'nunca travou: dá para varrer senha à vontade');
  });

  await caso('a trava e por conta: a senha certa da conta martelada nao entra...', async () => {
    const n = navegador();
    const r = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'martelo@auditeste.com', senha: 'senha-bem-longa-5' } });
    assert.strictEqual(r.status, 429, 'travada deveria recusar até a senha certa');
  });

  await caso('...e as outras contas seguem entrando normalmente', async () => {
    const r = await intruso.pedir('/api/entrar', { method: 'POST', json: { email: 'intruso@auditeste.com', senha: 'senha-bem-longa-3' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  });

  console.log('\ncofre · isolamento entre clientes\n');

  let projetoId, execucaoId, evidenciaId, objetoId;

  await caso('cria projeto, execucao e evidencia com print', async () => {
    let r = await admin.pedir('/api/projetos', { method: 'POST', json: { nome: 'Portal', cliente: 'Ailos' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    projetoId = r.corpo.projeto.id;

    r = await admin.pedir('/api/execucoes', { method: 'POST', json: { projetoId, titulo: 'Regressivo' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    execucaoId = r.corpo.execucao.id;

    r = await admin.pedir('/api/evidencias', {
      method: 'POST',
      json: { execucaoId, ordem: 1, titulo: 'Entrar no portal', acao: 'Clicar', antes: PIXEL, depois: PIXEL }
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    evidenciaId = r.corpo.evidencia.id;

    r = await admin.pedir('/api/evidencias/' + evidenciaId);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.objetos.length, 2, 'antes e depois deveriam estar anexados');
    objetoId = r.corpo.objetos[0].id;
  });

  await caso('a evidencia nasce com prazo de validade', async () => {
    const ev = banco.obterEvidencia(ailos.id, evidenciaId);
    assert.ok(ev.expira_em > Date.now(), 'sem expira_em não existe retenção');
    const dias = Math.round((ev.expira_em - ev.criada_em) / 86400000);
    assert.strictEqual(dias, 90, 'deveria usar a retenção do cliente');
  });

  await caso('CRITERIO: usuario do outro cliente nao le a evidencia sabendo o id', async () => {
    const r = await intruso.pedir('/api/evidencias/' + evidenciaId);
    assert.strictEqual(r.status, 404, 'vazou evidência entre clientes');
  });

  await caso('CRITERIO: nem baixa o objeto sabendo o id', async () => {
    const r = await intruso.pedir('/api/objetos/' + objetoId);
    assert.strictEqual(r.status, 404, 'vazou o arquivo entre clientes');
  });

  await caso('nem enxerga a execucao ou o projeto do outro', async () => {
    let r = await intruso.pedir('/api/evidencias?execucao=' + execucaoId);
    assert.deepStrictEqual(r.corpo.evidencias, []);
    r = await intruso.pedir('/api/projetos');
    assert.deepStrictEqual(r.corpo.projetos.map(x => x.id), []);
  });

  await caso('nem pendura evidencia na execucao do outro', async () => {
    const r = await intruso.pedir('/api/evidencias', {
      method: 'POST', json: { execucaoId, titulo: 'invasao', depois: PIXEL }
    });
    assert.strictEqual(r.status, 404, 'escreveu na execução de outro cliente');
  });

  await caso('CRITERIO: evidencia nao tem acesso anonimo', async () => {
    const r = await anonimo.pedir('/api/objetos/' + objetoId);
    assert.strictEqual(r.status, 401);
  });

  await caso('consulta sem tenant no contexto falha, nao devolve tudo', () => {
    assert.throws(() => banco.listarProjetos(''), /sem tenant/);
    assert.throws(() => banco.obterEvidencia(undefined, evidenciaId), /sem tenant/);
    assert.throws(() => banco.criarProjeto(null, uAdmin.id, 'x'), /sem tenant/);
  });

  console.log('\ncofre · link assinado\n');

  let assinado = null;

  await caso('link assinado entrega o arquivo sem sessao', async () => {
    const r = await admin.pedir('/api/objetos/' + objetoId + '/link');
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assinado = r.corpo.url;
    const s = await anonimo.pedir(assinado);
    assert.strictEqual(s.status, 200, 'o link deveria funcionar sozinho');
  });

  await caso('CRITERIO: link expirado nao entrega o arquivo', async () => {
    const api = require('./cofre/api.js');
    process.env.COFRE_SEGREDO = 'segredo-de-teste';
    const passado = Date.now() - 1000;
    // Assinatura legítima, só que de um instante que já passou.
    const sig = require('crypto').createHmac('sha256', 'segredo-de-teste')
      .update([objetoId, ailos.id, passado].join('|')).digest('base64url');
    const r = await anonimo.pedir('/api/objetos/' + objetoId
      + '?t=' + encodeURIComponent(ailos.id) + '&ate=' + passado + '&a=' + sig);
    assert.strictEqual(r.status, 403, 'link vencido continuou entregando');
    assert.ok(api.assinaturaValida(objetoId, ailos.id, Date.now() + 1000,
      require('crypto').createHmac('sha256', 'segredo-de-teste')
        .update([objetoId, ailos.id, Date.now() + 1000].join('|')).digest('base64url')) !== undefined);
  });

  await caso('trocar o cliente no endereco invalida a assinatura', async () => {
    const adulterado = assinado.replace(encodeURIComponent(ailos.id), encodeURIComponent(outro.id));
    const r = await anonimo.pedir(adulterado);
    assert.notStrictEqual(r.status, 200, 'deu para trocar o cliente na URL');
  });

  await caso('esticar a validade no endereco invalida a assinatura', async () => {
    const adulterado = assinado.replace(/ate=\d+/, 'ate=' + (Date.now() + 999999999));
    const r = await anonimo.pedir(adulterado);
    assert.strictEqual(r.status, 403);
  });

  console.log('\ncofre · papeis\n');

  await caso('consultor entra', async () => {
    const r = await consultor.pedir('/api/entrar', { method: 'POST', json: { email: 'consultor@auditeste.com', senha: 'senha-bem-longa-2' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
  });

  await caso('consultor cria evidencia mas nao exclui', async () => {
    let r = await consultor.pedir('/api/evidencias', {
      method: 'POST', json: { execucaoId, ordem: 2, titulo: 'Segundo passo', depois: PIXEL }
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));

    r = await consultor.pedir('/api/evidencias/' + evidenciaId, { method: 'DELETE' });
    assert.strictEqual(r.status, 403, 'consultor não deveria excluir evidência');
  });

  await caso('consultor nao le a auditoria', async () => {
    const r = await consultor.pedir('/api/auditoria');
    assert.strictEqual(r.status, 403);
  });

  await caso('tirar o vinculo derruba a sessao aberta na hora', async () => {
    const antes = await consultor.pedir('/api/eu');
    assert.strictEqual(antes.corpo.autenticado, true);

    banco.abrir(ARQUIVO);
    const db = require('node:sqlite');
    // Remove o vínculo direto no banco, como faria um desligamento.
    const conexao = new db.DatabaseSync(ARQUIVO);
    conexao.prepare('DELETE FROM memberships WHERE usuario_id = ?').run(uConsultor.id);
    conexao.close();

    const depois = await consultor.pedir('/api/eu');
    assert.strictEqual(depois.corpo.autenticado, false,
      'a sessão continuou valendo depois de o acesso ser removido');
  });

  console.log('\ncofre · exclusao e retencao\n');

  await caso('CRITERIO: excluir apaga metadado e objeto juntos', async () => {
    const objetosAntes = banco.objetosDe(ailos.id, evidenciaId);
    assert.ok(objetosAntes.length, 'nada para apagar');

    const r = await admin.pedir('/api/evidencias/' + evidenciaId, { method: 'DELETE' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));

    assert.strictEqual(banco.obterEvidencia(ailos.id, evidenciaId), null, 'metadado sobreviveu');
    assert.strictEqual(banco.objetosDe(ailos.id, evidenciaId).length, 0, 'o arquivo ficou órfão no banco');
    const baixar = await admin.pedir('/api/objetos/' + objetoId);
    assert.strictEqual(baixar.status, 404, 'o arquivo excluído ainda baixa');
  });

  await caso('CRITERIO: evidencia vencida some sozinha, com o arquivo junto', async () => {
    const r = await admin.pedir('/api/evidencias', {
      method: 'POST', json: { execucaoId, titulo: 'vai vencer', depois: PIXEL }
    });
    const vid = r.corpo.evidencia.id;
    const conexao = new (require('node:sqlite').DatabaseSync)(ARQUIVO);
    conexao.prepare('UPDATE evidencias SET expira_em = ? WHERE id = ?').run(Date.now() - 1000, vid);
    conexao.close();

    const varrida = banco.varrerVencidas();
    assert.ok(varrida.evidencias >= 1, 'a varredura não pegou a vencida');
    assert.strictEqual(banco.obterEvidencia(ailos.id, vid), null);
    assert.strictEqual(banco.objetosDe(ailos.id, vid).length, 0, 'sobrou arquivo de evidência vencida');
  });

  await caso('CRITERIO: da para apagar tudo de um cliente, e so dele', async () => {
    // O outro cliente ganha conteúdo, para provar que não é atingido.
    let r = await intruso.pedir('/api/projetos', { method: 'POST', json: { nome: 'Do outro' } });
    const pOutro = r.corpo.projeto.id;
    r = await intruso.pedir('/api/execucoes', { method: 'POST', json: { projetoId: pOutro } });
    await intruso.pedir('/api/evidencias', {
      method: 'POST', json: { execucaoId: r.corpo.execucao.id, titulo: 'do outro', depois: PIXEL }
    });

    const apagar = await admin.pedir('/api/tenant/excluir-tudo', { method: 'POST', json: { confirmar: 'Ailos' } });
    assert.strictEqual(apagar.status, 200, JSON.stringify(apagar.corpo));

    assert.deepStrictEqual(banco.listarProjetos(ailos.id), [], 'sobrou projeto do cliente apagado');
    assert.strictEqual(banco.listarProjetos(outro.id).length, 1, 'apagou o cliente errado junto');
  });

  await caso('exclusao total exige o nome exato do cliente', async () => {
    const r = await intruso.pedir('/api/tenant/excluir-tudo', { method: 'POST', json: { confirmar: 'qualquer coisa' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(banco.listarProjetos(outro.id).length, 1, 'apagou mesmo sem confirmar');
  });

  console.log('\ncofre · auditoria\n');

  await caso('CRITERIO: da para dizer quem criou, viu, baixou e excluiu', async () => {
    const r = await admin.pedir('/api/auditoria?limite=500');
    assert.strictEqual(r.status, 200);
    const acoes = new Set(r.corpo.eventos.map(e => e.acao));
    for (const esperada of ['login', 'evidencia.criada', 'evidencia.vista', 'objeto.baixado',
      'evidencia.excluida', 'projeto.criado', 'tenant.dados_excluidos']) {
      assert.ok(acoes.has(esperada), 'a auditoria não registra ' + esperada);
    }
    const criacao = r.corpo.eventos.find(e => e.acao === 'evidencia.criada');
    assert.ok(criacao.email, 'evento sem quem');
    assert.ok(criacao.quando, 'evento sem quando');
    assert.ok(criacao.recurso, 'evento sem qual recurso');
  });

  await caso('a auditoria de um cliente nao mostra o outro', async () => {
    const r = await intruso.pedir('/api/auditoria?limite=500');
    const alheios = r.corpo.eventos.filter(e => e.tenant_id !== outro.id);
    assert.deepStrictEqual(alheios, [], 'auditoria vazou entre clientes');
  });

  await caso('a auditoria nao guarda o cookie nem o corpo do pedido', async () => {
    const conexao = new (require('node:sqlite').DatabaseSync)(ARQUIVO);
    const linhas = conexao.prepare('SELECT recurso FROM auditoria').all();
    conexao.close();
    const tudo = linhas.map(l => l.recurso || '').join(' ');
    assert.ok(!/cofre=/.test(tudo), 'cookie de sessão foi parar no log');
    assert.ok(!/senha|password|base64/i.test(tudo), 'conteúdo sensível foi parar no log');
  });

  console.log('\ncofre · cadastro e equipes\n');

  const google = navegador();
  const amazon = navegador();
  let googleTenant = null;

  await caso('cadastro sem convite cria uma EQUIPE NOVA', async () => {
    const r = await google.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'qa@google.com', senha: 'senha-do-google-1', equipe: 'Google'
    }});
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.sessao.tenantNome, 'Google');
    assert.strictEqual(r.corpo.sessao.papel, 'admin', 'quem cria a equipe e o admin dela');
    googleTenant = r.corpo.sessao.tenantId;
  });

  await caso('a equipe nova nasce vazia, sem enxergar nada de ninguem', async () => {
    const r = await google.pedir('/api/projetos');
    assert.deepStrictEqual(r.corpo.projetos, [], 'equipe nova ja veio com projeto de outro');
  });

  await caso('cadastro exige senha de tamanho minimo', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'curta@teste.com', senha: '123', equipe: 'X'
    }});
    assert.strictEqual(r.status, 400);
  });

  await caso('cadastro exige e-mail plausivel', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'nao-e-email', senha: 'senha-bem-longa-x', equipe: 'X'
    }});
    assert.strictEqual(r.status, 400);
  });

  await caso('cadastro sem convite exige o nome da equipe', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'semequipe@teste.com', senha: 'senha-bem-longa-x'
    }});
    assert.strictEqual(r.status, 400);
  });

  await caso('e-mail repetido nao cria segunda conta', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'qa@google.com', senha: 'outra-senha-longa', equipe: 'Google Falso'
    }});
    assert.strictEqual(r.status, 409);
  });

  await caso('CRITERIO: digitar o nome da outra equipe nao entra nela', async () => {
    /* Nome de equipe e unico: digitar "Google" (que ja existe) e recusado. O
     * ponto de seguranca continua de pe, e ate mais forte: nao so nao entra na
     * equipe alheia, como nem cria. */
    const intruso = navegador();
    const r = await intruso.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'chute@amazon.com', senha: 'senha-da-amazon-1', equipe: 'Google'
    }});
    assert.strictEqual(r.status, 409, 'nome de equipe repetido deveria ser recusado');
    const eu = await intruso.pedir('/api/eu');
    assert.strictEqual(eu.corpo.autenticado, false, 'o intruso nao pode ter entrado em lugar nenhum');
  });

  await caso('a Amazon cria a propria equipe, com nome proprio', async () => {
    const r = await amazon.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'qa@amazon.com', senha: 'senha-da-amazon-1', equipe: 'Amazon'
    }});
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    assert.notStrictEqual(r.corpo.sessao.tenantId, googleTenant);
    assert.strictEqual(r.corpo.sessao.papel, 'admin');
  });

  let projetoDoGoogle = null;

  await caso('CRITERIO: Amazon nao ve o projeto do Google', async () => {
    const criado = await google.pedir('/api/projetos', { method: 'POST', json: { nome: 'Busca interna' } });
    assert.strictEqual(criado.status, 201, JSON.stringify(criado.corpo));
    projetoDoGoogle = criado.corpo.projeto.id;

    const lista = await amazon.pedir('/api/projetos');
    assert.deepStrictEqual(lista.corpo.projetos, [], 'a Amazon enxergou projeto do Google');

    const execs = await amazon.pedir('/api/execucoes?projeto=' + projetoDoGoogle);
    assert.deepStrictEqual(execs.corpo.execucoes, [],
      'sabendo o id do projeto, a Amazon leu as execucoes do Google');

    const apagar = await amazon.pedir('/api/projetos/' + projetoDoGoogle, { method: 'DELETE' });
    assert.strictEqual(apagar.status, 404, 'a Amazon conseguiu apagar projeto do Google');
  });

  await caso('nem a auditoria do Google aparece para a Amazon', async () => {
    const r = await amazon.pedir('/api/auditoria?limite=500');
    assert.strictEqual(r.status, 200);
    const vazou = r.corpo.eventos.filter(e => /google/i.test(e.email || '') || /google/i.test(e.recurso || ''));
    assert.deepStrictEqual(vazou, [], 'auditoria do Google apareceu para a Amazon');
  });

  console.log('\ncofre · convites\n');

  let codigo = null;

  await caso('gestor gera convite e o codigo aparece uma vez', async () => {
    const r = await google.pedir('/api/convites', { method: 'POST', json: { papel: 'consultor', dias: 7 } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    assert.ok(r.corpo.codigo && r.corpo.codigo.length > 20, 'codigo fraco ou ausente');
    codigo = r.corpo.codigo;

    const lista = await google.pedir('/api/convites');
    assert.ok(lista.corpo.convites.length >= 1);
    const cru = JSON.stringify(lista.corpo.convites);
    assert.ok(!cru.includes(codigo), 'a listagem devolveu o codigo em texto: o banco so deveria ter o hash');
  });

  await caso('ninguem convida para um papel acima do proprio', async () => {
    const conv = navegador();
    await conv.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'chefe@google.com', senha: 'senha-bem-longa-z', convite: codigo
    }});
    // Entrou como consultor: nao pode nem convidar.
    const r = await conv.pedir('/api/convites', { method: 'POST', json: { papel: 'admin' } });
    assert.strictEqual(r.status, 403);
  });

  await caso('CRITERIO: com convite, a pessoa entra na equipe do convite', async () => {
    const nova = await google.pedir('/api/convites', { method: 'POST', json: { papel: 'consultor' } });
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'dev@google.com', senha: 'senha-bem-longa-y', convite: nova.corpo.codigo
    }});
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.sessao.tenantId, googleTenant, 'nao caiu na equipe do convite');
    assert.strictEqual(r.corpo.sessao.papel, 'consultor', 'o papel do convite nao foi respeitado');

    const projetos = await n.pedir('/api/projetos');
    assert.strictEqual(projetos.corpo.projetos.length, 1, 'nao enxergou o projeto da propria equipe');
  });

  await caso('convite serve uma vez so', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'atrasado@google.com', senha: 'senha-bem-longa-w', convite: codigo
    }});
    assert.strictEqual(r.status, 400, 'o mesmo convite entrou duas vezes');
  });

  await caso('convite inventado nao entra em equipe nenhuma', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'chute@teste.com', senha: 'senha-bem-longa-v', convite: 'codigo-que-eu-inventei-agora'
    }});
    assert.strictEqual(r.status, 400);
  });

  await caso('convite vencido nao vale', async () => {
    const r = await google.pedir('/api/convites', { method: 'POST', json: { papel: 'leitor' } });
    const conexao = new (require('node:sqlite').DatabaseSync)(ARQUIVO);
    conexao.prepare('UPDATE convites SET expira_em = ? WHERE usado_em IS NULL')
      .run(Date.now() - 1000);
    conexao.close();

    const n = navegador();
    const tentativa = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'tarde@google.com', senha: 'senha-bem-longa-u', convite: r.corpo.codigo
    }});
    assert.strictEqual(tentativa.status, 400);
  });

  await caso('criar equipe nova tem teto por origem, entrar por convite nao', async () => {
    const api = require('./cofre/api.js');
    const contas2 = require('./cofre/contas.js');
    let travou = false;
    for (let i = 0; i < contas2.MAX_EQUIPES_POR_IP + 4; i++) {
      const n = navegador();
      const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
        email: 'lote' + i + '@teste.com', senha: 'senha-bem-longa-lote', equipe: 'Equipe ' + i
      }});
      if (r.status === 429) { travou = true; break; }
    }
    assert.ok(travou, 'da para criar equipe sem limite nenhum a partir da mesma origem');

    /* Com o IP ja travado, o convite tem que continuar funcionando: e o caso
     * do escritorio inteiro atras de um NAT so. */
    const conv = await google.pedir('/api/convites', { method: 'POST', json: { papel: 'leitor' } });
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', { method: 'POST', json: {
      email: 'convidado-tarde@google.com', senha: 'senha-bem-longa-t', convite: conv.corpo.codigo
    }});
    assert.strictEqual(r.status, 201,
      'o freio de equipe nova bloqueou quem chegou com convite valido');
    assert.ok(api.TETO_JANELA > 0);
  });

  console.log('\ncofre · trocar de equipe\n');

  await caso('quem esta em duas equipes troca entre elas', async () => {
    // A Amazon convida alguem do Google: agora essa pessoa esta nas duas.
    const conviteAmazon = await amazon.pedir('/api/convites', { method: 'POST', json: { papel: 'leitor' } });
    const conexao = new (require('node:sqlite').DatabaseSync)(ARQUIVO);
    const dupla = conexao.prepare('SELECT id FROM usuarios WHERE email = ?').get('dev@google.com');
    conexao.close();
    assert.ok(dupla, 'usuario de teste sumiu');

    const n = navegador();
    let r = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'dev@google.com', senha: 'senha-bem-longa-y' } });
    assert.strictEqual(r.status, 200);
    const amazonId = (await amazon.pedir('/api/eu')).corpo.tenantId;

    // Sem vinculo ainda: trocar tem que ser recusado.
    r = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: amazonId } });
    assert.strictEqual(r.status, 403, 'trocou para uma equipe da qual nao faz parte');

    // Aceita o convite pela rota de vinculo do proprio cadastro nao serve
    // (a conta ja existe), entao vincula direto, como faria o admin.
    const conexao2 = new (require('node:sqlite').DatabaseSync)(ARQUIVO);
    conexao2.prepare('INSERT INTO memberships (id, tenant_id, usuario_id, papel) VALUES (?,?,?,?)')
      .run('m-teste-dupla', amazonId, dupla.id, 'leitor');
    conexao2.close();

    r = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: amazonId } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    assert.strictEqual(r.corpo.sessao.papel, 'leitor', 'levou o papel da equipe errada');

    const eu = await n.pedir('/api/eu');
    assert.strictEqual(eu.corpo.tenantId, amazonId);
    assert.strictEqual(eu.corpo.equipes.length, 2, '/api/eu deveria listar as duas equipes');

    const projetos = await n.pedir('/api/projetos');
    assert.deepStrictEqual(projetos.corpo.projetos, [],
      'depois de trocar de equipe continuou vendo o projeto da anterior');
    assert.ok(conviteAmazon.corpo.codigo);
  });

  console.log('\ncofre · teto de uso e provisionamento\n');

  await caso('sessao que martela demais leva 429', async () => {
    /* Sessao propria: o teto e por sessao, entao martelar aqui nao pode
     * derrubar as outras abas do teste. */
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    const api = require('./cofre/api.js');
    let travou = false;
    for (let i = 0; i < api.TETO_JANELA + 5; i++) {
      const r = await n.pedir('/api/projetos');
      if (r.status === 429) { travou = true; break; }
    }
    assert.ok(travou, 'nunca travou: uma sessao sozinha varre a API a vontade');
  });

  await caso('mudanca de permissao entra na auditoria', async () => {
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath,
      [path.join(__dirname, 'cofre', 'admin.js'), 'vincular', 'solto@auditeste.com', outro.id, 'leitor'],
      { env: Object.assign({}, process.env, { COFRE_BANCO: ARQUIVO }), encoding: 'utf8' });

    const r = await intruso.pedir('/api/auditoria?limite=500');
    const achou = r.corpo.eventos.some(e => e.acao === 'permissao.alterada'
      && String(e.recurso || '').includes('solto@auditeste.com'));
    assert.ok(achou, 'dar acesso a alguem nao ficou registrado em lugar nenhum');
  });

  console.log('\ncofre · sair\n');

  await caso('sair revoga a sessao de verdade', async () => {
    const r = await admin.pedir('/api/sair', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const depois = await admin.pedir('/api/projetos');
    assert.strictEqual(depois.status, 401, 'a sessão continuou valendo depois de sair');
  });

  console.log('\nequipe provedora\n');

  await caso('sem a marca, a Auditeste nao alcanca cliente nenhum', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    const r = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: googleTenant } });
    assert.strictEqual(r.status, 403, 'entrou em equipe alheia sem ser provedora');
  });

  await caso('a marca de provedora nao existe em rota nenhuma', () => {
    const api = require('fs').readFileSync(path.join(__dirname, 'cofre', 'api.js'), 'utf8');
    assert.ok(!/marcarProvedor/.test(api),
      'a API expoe marcarProvedor: qualquer conta criaria uma equipe e viraria provedora de todas');
  });

  await caso('marcada por linha de comando, a Auditeste passa a alcancar os clientes', async () => {
    banco.marcarProvedor(ailos.id, true);
    const n = navegador();
    const r = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
    const eu = await n.pedir('/api/eu');
    const nomes = eu.corpo.equipes.map(t => t.nome).sort();
    assert.ok(nomes.includes('Google'), 'nao enxergou a equipe do cliente: ' + nomes.join(','));
    const google = eu.corpo.equipes.find(t => t.nome === 'Google');
    assert.strictEqual(google.via, 'provedor', 'deveria vir marcada como acesso de provedora');
  });

  await caso('CRITERIO: a provedora entra no cliente e enxerga o que e dele', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    const t = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: googleTenant } });
    assert.strictEqual(t.status, 200, JSON.stringify(t.corpo));
    assert.strictEqual(t.corpo.sessao.via, 'provedor');

    const eu = await n.pedir('/api/eu');
    assert.strictEqual(eu.corpo.tenantId, googleTenant);
    const projetos = await n.pedir('/api/projetos');
    assert.ok(projetos.corpo.projetos.length >= 1, 'entrou no cliente e nao viu os projetos dele');
  });

  await caso('CRITERIO: e consegue EDITAR dentro do cliente', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: googleTenant } });
    const r = await n.pedir('/api/projetos', { method: 'POST', json: { nome: 'Criado pela consultoria' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));

    /* A posse se confere no banco, e nao na resposta: a API deixou de
     * devolver tenant_id de proposito, e conferir no banco e prova mais
     * forte que acreditar no que o proprio servidor respondeu. */
    assert.ok(banco.obterProjeto(googleTenant, r.corpo.projeto.id),
      'o projeto nao ficou na equipe do cliente');
    assert.strictEqual(banco.obterProjeto(ailos.id, r.corpo.projeto.id), null,
      'o projeto tambem apareceu na equipe da consultoria');
  });

  await caso('CRITERIO: a entrada da provedora fica na auditoria DO CLIENTE', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: googleTenant } });
    const r = await n.pedir('/api/auditoria?limite=200');
    const entradas = r.corpo.eventos.filter(e => e.acao === 'equipe.acessada_pela_provedora');
    assert.ok(entradas.length >= 1, 'o cliente nao consegue ver que a consultoria entrou');
    assert.ok(/Ailos/.test(entradas[0].recurso || ''), 'nao diz qual consultoria entrou');
  });

  await caso('CRITERIO: cliente NAO vira provedora, e nao alcanca ninguem', async () => {
    // O Google e cliente. Ele nao pode alcancar a Amazon nem a Auditeste.
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'qa@google.com', senha: 'senha-do-google-1' } });
    const eu = await n.pedir('/api/eu');
    assert.strictEqual(eu.corpo.equipes.length, 1, 'cliente enxergou equipe alheia: '
      + JSON.stringify(eu.corpo.equipes));
    const r = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: ailos.id } });
    assert.strictEqual(r.status, 403, 'cliente entrou na equipe da consultoria');
  });

  await caso('leitor da provedora fica na provedora', async () => {
          const u = banco.usuarioPorEmail('leitor-prov@auditeste.com');
    if (!u) {
      const novo = banco.criarUsuario('leitor-prov@auditeste.com', contas.hashSenha('senha-bem-longa-l'));
      banco.vincular(ailos.id, novo.id, 'leitor');
    }
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'leitor-prov@auditeste.com', senha: 'senha-bem-longa-l' } });
    const eu = await n.pedir('/api/eu');
    assert.strictEqual(eu.corpo.equipes.length, 1,
      'leitor da provedora saiu visitando cliente: ' + JSON.stringify(eu.corpo.equipes));
  });

  await caso('provedora nao entra em outra provedora', async () => {
    banco.marcarProvedor(outro.id, true);
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    const r = await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: outro.id } });
    assert.strictEqual(r.status, 403, 'uma provedora entrou na outra');
    banco.marcarProvedor(outro.id, false);
  });

  await caso('tirar a marca fecha a porta na hora', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'admin@auditeste.com', senha: 'senha-bem-longa-1' } });
    await n.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: googleTenant } });
    const antes = await n.pedir('/api/eu');
    assert.strictEqual(antes.corpo.autenticado, true);

    banco.marcarProvedor(ailos.id, false);

    const depois = await n.pedir('/api/eu');
    assert.strictEqual(depois.corpo.autenticado, false,
      'a sessao dentro do cliente sobreviveu a perda da marca de provedora');
    banco.marcarProvedor(ailos.id, true);
  });

  console.log('\nportao do Print\n');

  await caso('em 127.0.0.1 nao ha portao: o Print local e ferramenta de quem esta na maquina', async () => {
    const { spawn } = require('child_process');
    const local = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
      env: Object.assign({}, process.env, {
        PORT: '8996', HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO, AGENTE_API_KEY: ''
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    local.stdout.resume(); local.stderr.resume();
    try {
      let subiu = false;
      for (let i = 0; i < 80; i++) {
        try { const r = await fetch('http://127.0.0.1:8996/ping'); if (r.ok) { await r.text(); subiu = true; break; } }
        catch (e) { /* subindo */ }
        await new Promise(r => setTimeout(r, 250));
      }
      assert.ok(subiu, 'o servidor local nao subiu');
      const r = await fetch('http://127.0.0.1:8996/', { redirect: 'manual' });
      await r.text();
      assert.strictEqual(r.status, 200, 'loopback nao deveria ter portao, veio ' + r.status);
      const ping = await (await fetch('http://127.0.0.1:8996/ping')).json();
      assert.strictEqual(ping.portao, false, '/ping deveria dizer que nao ha portao em loopback');
    } finally {
      try { local.kill(); } catch (e) {}
    }
  });

  await caso('CRITERIO: sem sessao o HTML do Print nem e servido', async () => {
    const r = await fetch(BASE + '/', { redirect: 'manual' });
    await r.text();
    assert.strictEqual(r.status, 302, 'a página do Print foi entregue a quem não entrou');
    const destino = r.headers.get('location') || '';
    assert.ok(destino.startsWith('/cofre.html?ir='), 'desviou para lugar estranho: ' + destino);
  });

  await caso('index.html pela porta dos fundos tambem barra', async () => {
    const r = await fetch(BASE + '/index.html', { redirect: 'manual' });
    await r.text();
    assert.strictEqual(r.status, 302, 'deu para pular o portão pedindo o arquivo pelo nome');
  });

  await caso('com sessao o Print e servido normalmente', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'qa@google.com', senha: 'senha-do-google-1' } });
    const r = await n.pedir('/');
    assert.strictEqual(r.status, 200, 'quem entrou não conseguiu abrir o Print');
    assert.ok(String(r.corpo).includes('Audi Print'), 'veio outra coisa no lugar do Print');
  });

  await caso('a propria tela de entrada nao pode ficar atras do portao', async () => {
    const r = await fetch(BASE + '/cofre.html', { redirect: 'manual' });
    await r.text();
    assert.strictEqual(r.status, 200, 'quem não entrou não alcança nem a tela de entrar');
  });

  await caso('o healthcheck continua aberto, senao a Railway derruba o servico', async () => {
    const r = await fetch(BASE + '/ping');
    const d = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(d.portao, true, '/ping deveria contar que o portão está de pé');
  });

  await caso('o pacote da extensao continua aberto', async () => {
    const r = await fetch(BASE + '/extensao.zip', { redirect: 'manual' });
    await r.arrayBuffer();
    assert.strictEqual(r.status, 200,
      'sem isso, quem ainda não instalou o complemento não consegue instalar');
  });

  await caso('o desvio nao vira trampolim para site de fora', async () => {
    /* O ?ir= volta para dentro. Se aceitasse endereço inteiro, a tela de
     * entrada do Print viraria um link com domínio confiável que joga a
     * pessoa em qualquer lugar depois de digitar a senha. */
    const pagina = await (await fetch(BASE + '/cofre.html?ir=https://exemplo-malicioso.com')).text();
    const m = /const paraOndeIr = \(\(\) => \{([\s\S]*?)\}\)\(\);/.exec(pagina);
    assert.ok(m, 'não achei a leitura do destino na página');
    const calcular = new Function('busca',
      'const location = { search: busca };\n'
      + 'const paraOndeIr = (() => {' + m[1] + '})();\n'
      + 'return paraOndeIr;');
    assert.strictEqual(calcular('?ir=https://exemplo-malicioso.com'), '', 'aceitou endereço externo');
    assert.strictEqual(calcular('?ir=//exemplo-malicioso.com'), '', 'aceitou barra dupla');
    assert.strictEqual(calcular('?ir=/'), '/', 'recusou o destino legítimo');
    assert.strictEqual(calcular('?ir=/index.html'), '/index.html');
  });

  console.log('\nponte: sessao no lugar do token\n');

  await caso('CRITERIO: sem token e sem sessao, a ponte continua fechada', async () => {
    /* Este e o curl que abriu toda a historia. Ele nao pode voltar a passar
     * so porque agora existe outro jeito de autorizar. */
    const r = await fetch(BASE + '/scan?tipo=axe&url=https://example.com', {
      headers: { Origin: BASE }, redirect: 'manual'
    });
    await r.text().catch(() => {});
    assert.strictEqual(r.status, 401, 'a ponte voltou a aceitar chamada anonima');
  });

  await caso('CRITERIO: com sessao do cofre, a ponte autoriza sem token nenhum', async () => {
    const n = navegador();
    const entrou = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'qa@google.com', senha: 'senha-do-google-1' } });
    assert.strictEqual(entrou.status, 200, JSON.stringify(entrou.corpo));

    /* tipo invalido de proposito: 400 prova que passou pela autorizacao e
     * chegou na validacao, sem gastar um scan de verdade no teste. */
    const r = await n.pedir('/scan?tipo=inexistente&url=https://example.com');
    assert.notStrictEqual(r.status, 401, 'sessao valida levou 401 na ponte');
    assert.strictEqual(r.status, 400, 'esperava chegar na validacao, veio ' + r.status);
  });

  await caso('sessao revogada perde a ponte junto', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'qa@google.com', senha: 'senha-do-google-1' } });
    const antes = await n.pedir('/scan?tipo=inexistente&url=https://example.com');
    assert.strictEqual(antes.status, 400);

    await n.pedir('/api/sair', { method: 'POST' });
    const depois = await n.pedir('/scan?tipo=inexistente&url=https://example.com');
    assert.strictEqual(depois.status, 401, 'depois de sair a ponte continuou aberta');
  });

  await caso('/ping conta que a sessao autoriza', async () => {
    const r = await (await fetch(BASE + '/ping')).json();
    assert.strictEqual(r.sessaoAutoriza, true);
  });

  console.log('\ncofre · desligado nao quebra o resto\n');

  await caso('o Print continua servido com o cofre ligado, para quem entrou', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: 'qa@google.com', senha: 'senha-do-google-1' } });
    const r = await n.pedir('/');
    assert.strictEqual(r.status, 200);
    assert.ok(/Audi Print|evid[eê]ncia/i.test(String(r.corpo)), 'a página do Print não veio');
  });

  await caso('/ping informa o estado do cofre', async () => {
    const r = await (await fetch(BASE + '/ping')).json();
    assert.strictEqual(r.cofre, true);
  });
}

principal()
  .catch(err => { falhas++; console.log('\nERRO GERAL: ' + err.message + '\n' + err.stack); })
  .then(() => {
    if (proc) { try { proc.kill(); } catch (e) {} }
    try { banco.fechar(); } catch (e) {}
    console.log('\n' + feitos + ' passaram, ' + falhas + ' falharam\n');
    process.exit(falhas ? 1 : 0);
  });
