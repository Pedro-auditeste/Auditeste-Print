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
      PORT: String(PORTA), HOST: '127.0.0.1',
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

  console.log('\ncofre · sair\n');

  await caso('sair revoga a sessao de verdade', async () => {
    const r = await admin.pedir('/api/sair', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const depois = await admin.pedir('/api/projetos');
    assert.strictEqual(depois.status, 401, 'a sessão continuou valendo depois de sair');
  });

  console.log('\ncofre · desligado nao quebra o resto\n');

  await caso('o Print continua servido com o cofre ligado', async () => {
    const r = await fetch(BASE + '/');
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.ok(/Audi Print|evid[eê]ncia/i.test(html), 'a página do Print não veio');
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
