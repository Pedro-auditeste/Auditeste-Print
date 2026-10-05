/* Bug no Jira a partir da evidência, contra um Jira e um Zephyr de mentira.
 *
 *   node teste-jira.js
 *
 * O Jira de verdade não entra em teste automático: abrir bug cria item na
 * conta da equipe. O servidor falso exige o que o Jira exige (Basic com
 * e-mail e token; X-Atlassian-Token no anexo) e guarda o que recebeu.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORTA = 8971;
const FALSO = 'http://127.0.0.1:' + PORTA;
const EMAIL = 'qa@auditeste.com.br';
const TOKEN_JIRA = 'token-jira-de-teste';
const TOKEN_ZEPHYR = 'token-zephyr-de-teste';

Object.assign(process.env, {
  JIRA_BASE: FALSO + '/jira', JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN_JIRA, JIRA_PROJETO: 'GOV',
  ZEPHYR_BASE: FALSO + '/v2', ZEPHYR_API_TOKEN: TOKEN_ZEPHYR, ZEPHYR_PROJETO: 'GOV', ZEPHYR_CICLO: 'GOV-R1'
});
const jira = require('./cofre/jira.js');

let falhas = 0;
async function caso(nome, fn) {
  try { await fn(); console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Jira e Zephyr de mentira ---------- */

const recebido = { issues: [], anexos: [], links: [], zephyr: [], comentarios: [], execucoes: [], casos: [], roteiros: [] };
let semBug = false, falhaAnexo = false, falhaComentario = false;
const zerar = () => { Object.keys(recebido).forEach(k => { recebido[k] = []; }); };

const servidor = http.createServer((req, res) => {
  const partes = [];
  req.on('data', d => partes.push(d));
  req.on('end', () => {
    const bruto = Buffer.concat(partes);
    const u = new URL(req.url, 'http://x');
    const responder = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };

    if (u.pathname.startsWith('/v2/')) {
      if (req.headers.authorization !== 'Bearer ' + TOKEN_ZEPHYR) return responder(401, { message: 'zephyr sem token' });
      const m = u.pathname.match(/^\/v2\/testexecutions\/([^/]+)\/links\/issues$/);
      if (m && req.method === 'POST') { recebido.zephyr.push({ execucao: m[1], corpo: JSON.parse(bruto.toString()) }); return responder(201, { id: 1 }); }
      if (u.pathname === '/v2/testexecutions' && req.method === 'POST') {
        recebido.execucoes.push(JSON.parse(bruto.toString()));
        return responder(201, { id: 9002, key: 'GOV-E8' });
      }
      if (u.pathname === '/v2/testcases' && req.method === 'GET') return responder(200, { values: [{ key: 'GOV-T1', name: 'Login com senha certa' }] });
      if (u.pathname === '/v2/testcycles' && req.method === 'GET') return responder(200, { values: [{ key: 'GOV-R1', name: 'Audi Print' }] });
      if (u.pathname === '/v2/testcases' && req.method === 'POST') { recebido.casos.push(JSON.parse(bruto.toString())); return responder(201, { id: 777, key: 'GOV-T20' }); }
      const roteiro = u.pathname.match(/^\/v2\/testcases\/([^/]+)\/teststeps$/);
      if (roteiro && req.method === 'POST') { recebido.roteiros.push({ caso: roteiro[1], corpo: JSON.parse(bruto.toString()) }); return responder(201, {}); }
      if (roteiro && req.method === 'GET') return responder(200, { total: roteiro[1] === 'GOV-T20' ? recebido.roteiros.length && recebido.roteiros[0].corpo.items.length : 1, values: [] });
      return responder(404, { message: 'zephyr: rota desconhecida' });
    }

    const basic = 'Basic ' + Buffer.from(EMAIL + ':' + TOKEN_JIRA).toString('base64');
    if (req.headers.authorization !== basic) return responder(401, { errorMessages: ['sem credencial'] });
    const cam = u.pathname.replace(/^\/jira/, '');

    if (cam === '/rest/api/3/project/GOV' && req.method === 'GET') {
      return responder(200, { key: 'GOV', issueTypes: [
        { id: '10001', name: 'Tarefa', subtask: false },
        { id: '10003', name: 'Subtarefa', subtask: true },
        ...(semBug ? [] : [{ id: '10004', name: 'Bug', subtask: false }])
      ] });
    }
    const umaIssue = cam.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/);
    if (umaIssue && req.method === 'GET') {
      if (umaIssue[1] !== 'GOV-12') return responder(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      return responder(200, { id: '10012', key: 'GOV-12', fields: { summary: 'História do login' } });
    }
    const comentario = cam.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
    if (comentario && req.method === 'POST') {
      if (falhaComentario) return responder(400, { errorMessages: ['comentario recusado'] });
      recebido.comentarios.push({ chave: comentario[1], corpo: JSON.parse(bruto.toString()) });
      return responder(201, { id: '500' });
    }
    if (cam === '/rest/api/3/issue' && req.method === 'POST') {
      recebido.issues.push(JSON.parse(bruto.toString()));
      return responder(201, { id: '10050', key: 'GOV-77', self: FALSO + '/jira/rest/api/3/issue/10050' });
    }
    const anexo = cam.match(/^\/rest\/api\/3\/issue\/([^/]+)\/attachments$/);
    if (anexo && req.method === 'POST') {
      if (req.headers['x-atlassian-token'] !== 'no-check') return responder(403, { errorMessages: ['XSRF check failed'] });
      if (falhaAnexo) return responder(413, { errorMessages: ['anexo grande demais'] });
      const nomes = (bruto.toString('latin1').match(/filename="([^"]+)"/g) || []).map(s => s.slice(10, -1));
      recebido.anexos.push({ chave: anexo[1], nomes });
      return responder(200, nomes.map((n, i) => ({ id: String(900 + i), filename: n })));
    }
    if (cam === '/rest/api/3/issueLink' && req.method === 'POST') {
      recebido.links.push(JSON.parse(bruto.toString()));
      return responder(201);
    }
    responder(404, { errorMessages: ['jira: rota desconhecida ' + cam] });
  });
});

const FICHA = { registro: 'EVD-20260929-001', modulo: 'Governança', ambiente: 'Homologação', versao: '1.4.0',
  tipo: 'Funcional', executor: 'Pedro', data: '29/09/2026', demanda: 'GOV-12' };
const PASSOS = [
  { acao: 'Clicar', rotulo: 'Lista', titulo: 'Clicou em Lista', elemento: '//a[normalize-space(.)="Lista"]',
    elementoId: 'aba-lista', html: '<a data-testid="tab" href="/list">Lista</a>',
    antes: '29/09/2026, 10:00:01', depois: '29/09/2026, 10:00:02', urlAntes: 'https://gov/boards/1', urlDepois: 'https://gov/list' },
  { acao: 'Digitar', rotulo: 'Busca', titulo: 'Digitou *negrito* [link|x] <script>', elemento: '//*[@id="busca"]' },
  { acao: 'Clicar', rotulo: 'Resumo', elemento: '//a[normalize-space(.)="Resumo"]' }
];
const ANEXO = { nome: 'EVD.html', tipo: 'text/html', base64: Buffer.from('<html>evidencia</html>').toString('base64') };

/* Todo texto do documento ADF, para procurar sem depender da estrutura. */
function textos(no, saida = []) {
  if (!no) return saida;
  if (no.type === 'text') saida.push(no.text);
  (no.content || []).forEach(n => textos(n, saida));
  return saida;
}

(async () => {
  await new Promise(ok => servidor.listen(PORTA, '127.0.0.1', ok));
  console.log('\njira: bug a partir da evidencia\n');

  await caso('escolhe Bug quando o projeto tem, e nunca subtarefa', async () => {
    semBug = false;
    assert.deepStrictEqual(await jira.tipoDoBug(), { id: '10004', nome: 'Bug' });
  });

  await caso('projeto sem Bug abre como Tarefa', async () => {
    semBug = true;
    try { assert.deepStrictEqual(await jira.tipoDoBug(), { id: '10001', nome: 'Tarefa' }); }
    finally { semBug = false; }
  });

  await caso('CRITERIO: o bug nasce com passos, esperado, observado e a ficha', async () => {
    zerar();
    const r = await jira.criarBug({ titulo: 'Governança: lista não abre', esperado: 'A lista abre',
      observado: 'Tela em branco', ficha: FICHA, passos: PASSOS, execucaoZephyr: 'GOV-E7', anexos: [ANEXO] });
    assert.strictEqual(r.chave, 'GOV-77');
    assert.strictEqual(r.url, FALSO + '/jira/browse/GOV-77');
    const f = recebido.issues[0].fields;
    assert.strictEqual(f.project.key, 'GOV');
    assert.strictEqual(f.issuetype.id, '10004');
    assert.strictEqual(f.summary, 'Governança: lista não abre');
    assert.deepStrictEqual(f.labels, ['audi-print']);
    const titulos = f.description.content.filter(n => n.type === 'heading').map(n => n.content[0].text);
    assert.deepStrictEqual(titulos, ['Passos para reproduzir', 'Resultado esperado', 'Resultado observado', 'Evidências']);
    const tudo = textos(f.description).join('\n');
    for (const t of ['EVD-20260929-001 (Audi Print)', 'Homologação', '1.4.0', 'GOV-12', 'GOV-E7', 'A lista abre', 'Tela em branco'])
      assert.ok(tudo.includes(t), 'faltou na descricao: ' + t);
  });

  await caso('CRITERIO: cada passo leva o detalhe do Print, na ordem', async () => {
    const d = recebido.issues[0].fields.description;
    const lista = d.content.find(n => n.type === 'orderedList');
    assert.strictEqual(lista.content.length, 3);
    const p1 = textos(lista.content[0]).join('\n');
    for (const t of ['Clicar · Lista', 'Clicou em Lista', '//a[normalize-space(.)="Lista"]', 'aba-lista',
      'Antes: 29/09/2026, 10:00:01 · Depois: 29/09/2026, 10:00:02', 'URL antes: https://gov/boards/1', 'URL depois: https://gov/list'])
      assert.ok(p1.includes(t), 'passo 1 sem: ' + t);
    const bloco = lista.content[0].content.find(n => n.type === 'codeBlock');
    assert.ok(bloco && bloco.content[0].text === '<a data-testid="tab" href="/list">Lista</a>', 'HTML do elemento fora do bloco de codigo');
    assert.ok(textos(lista.content[1]).includes('Digitou *negrito* [link|x] <script>'), 'texto da pagina tem de ir literal');
  });

  await caso('CRITERIO: HTML da evidencia vai anexado, com o cabecalho que o Jira exige', async () => {
    assert.strictEqual(recebido.anexos.length, 1);
    assert.deepStrictEqual(recebido.anexos[0], { chave: 'GOV-77', nomes: ['EVD.html'] });
  });

  await caso('CRITERIO: liga o bug a demanda e a execucao do Zephyr', async () => {
    assert.deepStrictEqual(recebido.links[0], { type: { name: 'Relates' }, inwardIssue: { key: 'GOV-77' }, outwardIssue: { key: 'GOV-12' } });
    assert.deepStrictEqual(recebido.zephyr[0], { execucao: 'GOV-E7', corpo: { issueId: 10050 } });
  });

  await caso('demanda que nao e chave de issue nao vira vinculo', async () => {
    zerar();
    const r = await jira.criarBug({ titulo: 't', ficha: Object.assign({}, FICHA, { demanda: 'historia do login' }), passos: [] });
    assert.strictEqual(recebido.links.length, 0);
    assert.strictEqual(r.demanda, null);
  });

  await caso('CRITERIO: falha no anexo nao perde o bug', async () => {
    zerar();
    falhaAnexo = true;
    try {
      const r = await jira.criarBug({ titulo: 't', ficha: FICHA, passos: PASSOS, anexos: [ANEXO] });
      assert.strictEqual(r.chave, 'GOV-77');
      assert.strictEqual(r.anexados, 0);
      assert.ok(r.avisos.some(a => /anexos não subiram/.test(a) && /grande demais/.test(a)), JSON.stringify(r.avisos));
    } finally { falhaAnexo = false; }
  });

  await caso('titulo vazio e recusado antes de chamar o Jira', async () => {
    zerar();
    await assert.rejects(() => jira.criarBug({ titulo: '   ', passos: PASSOS }), e => e.status === 400);
    assert.strictEqual(recebido.issues.length, 0);
  });

  await caso('gravacao enorme cabe na descricao e avisa o que ficou de fora', () => {
    const muitos = Array.from({ length: 300 }, (_, i) => ({ titulo: 'Passo ' + i + ' ' + 'x'.repeat(200), html: 'y'.repeat(900) }));
    const d = jira.descricao({ ficha: FICHA, passos: muitos });
    assert.ok(JSON.stringify(d).length <= jira.LIMITE_DESCRICAO + 2000, 'descricao grande demais: ' + JSON.stringify(d).length);
    assert.ok(textos(d).some(t => /^E mais \d+ passo\(s\)/.test(t)), 'cortou sem avisar');
  });

  await caso('anexos acima do limite ficam de fora, sem estourar o envio', () => {
    const grande = { nome: 'g.png', tipo: 'image/png', base64: Buffer.alloc(9 * 1024 * 1024).toString('base64') };
    const v = jira.arquivosValidos([ANEXO, grande, grande, grande]);
    assert.strictEqual(v.length, 2, 'devia caber o HTML e um print de 9 MB');
  });

  console.log('\njira: evidencia na demanda\n');

  await caso('CRITERIO: a historia recebe o HTML e os prints, um comentario e a execucao ligada', async () => {
    zerar();
    const print = { nome: 'EVD-passo-1-Depois.png', tipo: 'image/png', base64: Buffer.from('png').toString('base64') };
    const r = await jira.anexarNaDemanda({ demanda: 'gov-12', ficha: FICHA, passos: PASSOS, resultado: 'Reprovado',
      execucaoZephyr: 'GOV-E7', anexos: [ANEXO, print] });
    assert.strictEqual(r.chave, 'GOV-12');
    assert.strictEqual(r.titulo, 'História do login');
    assert.strictEqual(r.anexados, 2);
    assert.deepStrictEqual(recebido.anexos[0], { chave: 'GOV-12', nomes: ['EVD.html', 'EVD-passo-1-Depois.png'] });
    const c = textos(recebido.comentarios[0].corpo.body).join('\n');
    for (const t of ['Evidência de teste EVD-20260929-001 (Audi Print)', 'Reprovado', '3', 'Homologação', 'GOV-E7', 'EVD.html'])
      assert.ok(c.includes(t), 'comentario sem: ' + t);
    assert.deepStrictEqual(recebido.zephyr[0], { execucao: 'GOV-E7', corpo: { issueId: 10012 } });
    assert.ok(r.comentado && r.zephyr === 'GOV-E7');
  });

  await caso('CRITERIO: demanda que nao existe para antes de anexar qualquer coisa', async () => {
    zerar();
    await assert.rejects(() => jira.anexarNaDemanda({ demanda: 'GOV-404', ficha: FICHA, anexos: [ANEXO] }),
      e => e.status === 404 && /GOV-404 não existe/.test(e.message));
    assert.strictEqual(recebido.anexos.length, 0);
  });

  await caso('chave que nao e de issue e sem arquivo sao recusados antes de chamar', async () => {
    zerar();
    await assert.rejects(() => jira.anexarNaDemanda({ demanda: 'historia do login', anexos: [ANEXO] }), e => e.status === 400);
    await assert.rejects(() => jira.anexarNaDemanda({ demanda: 'GOV-12', anexos: [] }), e => e.status === 400);
    assert.strictEqual(recebido.anexos.length + recebido.comentarios.length, 0);
  });

  await caso('comentario recusado vira aviso: os anexos ja subiram', async () => {
    zerar();
    falhaComentario = true;
    try {
      const r = await jira.anexarNaDemanda({ demanda: 'GOV-12', ficha: FICHA, anexos: [ANEXO] });
      assert.strictEqual(r.anexados, 1);
      assert.strictEqual(r.comentado, false);
      assert.ok(r.avisos.some(a => /comentário não/.test(a)), JSON.stringify(r.avisos));
    } finally { falhaComentario = false; }
  });

  await pelaTela();
  servidor.close();
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (24 casos)\n');
  process.exit(falhas ? 1 : 0);
})();

/* ---------- o caminho inteiro: gravar, arquivar, abrir o bug pela tela ---------- */
async function pelaTela() {
  const puppeteer = require('puppeteer');
  const PORTA_COFRE = 8972;
  const COFRE = 'http://127.0.0.1:' + PORTA_COFRE;
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jira-')), 'c.db');
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(arq);
  const tenant = banco.criarTenant('Equipe do teste', 90);
  const u = banco.criarUsuario('qa@exemplo.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORTA_COFRE), HOST: '127.0.0.1', COFRE_BANCO: arq,
      COFRE_SEGREDO: 'segredo-jira', AGENTE_API_KEY: '', PONTE_TOKEN: '' }),
    stdio: 'ignore'
  });
  let nav;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(COFRE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o cofre nao subiu');
      await delay(250);
    }
    console.log('\npela rota e pela tela\n');

    await caso('rota: sem sessao nao abre bug', async () => {
      const r = await fetch(COFRE + '/api/jira/bug', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"titulo":"x"}' });
      assert.strictEqual(r.status, 401);
    });

    nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1280, height: 900 });
    const erros = [];
    pg.on('pageerror', e => erros.push(e.message));
    const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';
    const evid = { formato: 'audi-print-evidencia-v1', url: 'https://gov/boards/1', titulo: 'Governança',
      passos: PASSOS.map(p => Object.assign({}, p, { imagens: [{ dataUrl: PIXEL, legenda: 'Antes' }, { dataUrl: PIXEL, legenda: 'Depois' }] })) };
    await pg.evaluateOnNewDocument((ev) => {
      addEventListener('message', (e) => {
        const d = e.data;
        if (e.source !== window || !d || d.tipo !== 'AUDI_PRINT_PEDE') return;
        const corpo = d.deTab == null
          ? { evidencias: [{ tabId: 7, url: ev.url, titulo: ev.titulo, inicio: new Date().toISOString(), ativa: false, encerrada: new Date().toISOString(), importada: false, passos: ev.passos.length }] }
          : { evidencia: Object.assign({}, ev, { passos: ev.passos.map((p, i) => Object.assign({}, p, { id: 'j' + i + '-' + Date.now(), timestampDepois: new Date().toISOString() })) }) };
        postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
      });
    }, evid);

    await pg.goto(COFRE + '/cofre.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#email', { visible: true });
    await pg.type('#email', 'qa@exemplo.com');
    await pg.type('#senha', 'senha-bem-longa-9');
    await pg.click('#btnEntrar');
    await delay(1500);

    await caso('rota: com sessao diz que o Jira esta configurado, sem vazar o token', async () => {
      const r = await pg.evaluate(async () => { const x = await fetch('/api/jira'); return { s: x.status, t: await x.text() }; });
      assert.strictEqual(r.s, 200);
      assert.deepStrictEqual(JSON.parse(r.t), { configurado: true });
      assert.ok(!r.t.includes('token'), 'vazou o token');
    });

    await caso('CRITERIO: publicar no Zephyr com demanda ja liga a execucao a historia', async () => {
      zerar();
      const r = await pg.evaluate(async () => (await fetch('/api/zephyr/publicar', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caso: 'GOV-T1', resultado: 'Aprovado', demanda: 'GOV-12', passos: [{ titulo: 'a' }] }) })).json());
      assert.strictEqual(r.execucao, 'GOV-E8', JSON.stringify(r));
      assert.strictEqual(r.demanda, 'GOV-12', JSON.stringify(r));
      assert.deepStrictEqual(recebido.zephyr[0], { execucao: 'GOV-E8', corpo: { issueId: 10012 } });
    });

    await caso('...e demanda inexistente nao derruba a publicacao', async () => {
      const r = await pg.evaluate(async () => (await fetch('/api/zephyr/publicar', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caso: 'GOV-T1', resultado: 'Aprovado', demanda: 'GOV-404' }) })).json());
      assert.strictEqual(r.execucao, 'GOV-E8');
      assert.ok(/GOV-404/.test(r.avisoDemanda || ''), JSON.stringify(r));
    });

    await caso('CRITERIO: pela tela, o bug nasce com a ficha, os passos e os prints anexados', async () => {
      zerar();
      await pg.goto(COFRE + '/index.html', { waitUntil: 'networkidle0' });
      if (await pg.$eval('#abertura', a => !a.classList.contains('encerrada'))) await pg.click('#entrarSite');
      await pg.waitForSelector('#telaProjetos.ativa');
      await pg.click('[data-acao="novoProjeto"]');
      await pg.waitForSelector('#campoNome', { visible: true });
      await pg.type('#campoNome', 'Governança');
      await pg.click('#btnConfirmarModal');
      await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]');
      await delay(500);
      await pg.click('#gradeProjetos .cartao[data-projeto]');
      await pg.waitForSelector('[data-acao="novaGravacao"]');
      await pg.evaluate(() => { const c = document.getElementById('capturarPrintsPasso'); if (c) c.checked = true; });
      await pg.click('[data-acao="novaGravacao"]');
      await pg.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
      await pg.click('[data-acao="puxarExtensao"]');
      await pg.waitForSelector('.passo .imagens figure', { timeout: 15000 });
      await pg.click('[data-campo="demanda"]');
      await pg.keyboard.type('GOV-12');
      await pg.click('[data-acao="salvar"]');
      await pg.waitForSelector('[data-abrir]', { timeout: 15000 });
      await pg.click('[data-abrir]');
      await pg.waitForSelector('[data-acao="abrirBugJira"]:not([hidden])', { timeout: 8000 });
      /* O roteiro pode puxar a gravacao mais de uma vez; vale o que a evidencia tem. */
      const naEvidencia = await pg.$$eval('#conteudoRegistro .passo', els => els.length);
      await pg.click('[data-acao="abrirBugJira"]');
      await pg.waitForSelector('#camposConfirma [data-campo="titulo"]', { visible: true });

      const sugerido = await pg.$eval('#camposConfirma [data-campo="titulo"]', el => el.value);
      assert.ok(sugerido.length > 0, 'o titulo devia vir sugerido');
      await pg.click('#camposConfirma [data-campo="esperado"]');
      await pg.keyboard.type('A lista abre');
      await pg.keyboard.press('Enter');
      await pg.keyboard.type('sem erro');
      const aberto = await pg.$eval('#fundoConfirma', el => el.classList.contains('aberto'));
      assert.ok(aberto, 'Enter na caixa de texto fechou o modal em vez de quebrar a linha');
      await pg.click('#btnSim');

      await pg.waitForFunction(() => /Bug aberto no Jira/.test(document.getElementById('tituloConfirma').textContent), { timeout: 20000 });
      const sub = await pg.$eval('#subtituloConfirma', el => el.textContent);
      assert.ok(/GOV-77/.test(sub), 'nao mostrou a chave do bug: ' + sub);
      await pg.click('#btnNao');

      const f = recebido.issues[0].fields;
      assert.strictEqual(f.summary, sugerido, 'titulo: ' + JSON.stringify([f.summary, sugerido]));
      const tudo = textos(f.description).join('\n');
      assert.ok(tudo.includes('A lista abre\nsem erro') || tudo.includes('A lista abre') , 'esperado nao chegou');
      assert.ok(tudo.includes('GOV-12'), 'a demanda nao chegou na ficha do bug');
      assert.ok(naEvidencia >= 3, 'a evidencia devia ter os passos gravados: ' + naEvidencia);
      assert.strictEqual(f.description.content.find(n => n.type === 'orderedList').content.length, naEvidencia, 'passos no bug');
      const nomes = recebido.anexos[0].nomes;
      assert.ok(nomes.some(n => /\.html$/.test(n)), 'sem o HTML da evidencia: ' + nomes);
      assert.strictEqual(nomes.filter(n => /-passo-\d+-/.test(n)).length, naEvidencia * 2, 'esperava 2 prints por passo: ' + nomes);
      assert.deepStrictEqual(recebido.links[0].outwardIssue, { key: 'GOV-12' });
    });

    await caso('CRITERIO: pela tela, a evidencia vai inteira para a demanda', async () => {
      zerar();
      await pg.click('[data-acao="anexarDemandaJira"]');
      await pg.waitForFunction(() => document.getElementById('fundoConfirma').classList.contains('aberto')
        && /Anexar na demanda/.test(document.getElementById('tituloConfirma').textContent));
      assert.strictEqual(await pg.$eval('#subtituloConfirma', el => el.textContent), 'GOV-12');
      /* A janela conta os prints que a evidencia tem de verdade: gravacao
       * sem print dizia "os prints" e so o HTML chegava na historia. */
      const aviso = await pg.$eval('#textoConfirma', el => el.textContent);
      const temPrints = await pg.$$eval('#conteudoRegistro .passo img', els => els.length);
      assert.ok(temPrints ? /\d+ print\(s\)/.test(aviso) : /não tem prints/.test(aviso), 'janela: ' + aviso);
      await pg.click('#btnSim');
      await pg.waitForFunction(() => /Evidência anexada na demanda/.test(document.getElementById('tituloConfirma').textContent), { timeout: 20000 });
      assert.ok(/GOV-12 · História do login/.test(await pg.$eval('#subtituloConfirma', el => el.textContent)));
      await pg.click('#btnNao');
      const nomes = recebido.anexos[0].nomes;
      assert.strictEqual(recebido.anexos[0].chave, 'GOV-12');
      assert.ok(nomes.some(n => /\.html$/.test(n)) && nomes.filter(n => /-passo-\d+-/.test(n)).length >= 6, 'anexos: ' + nomes);
      assert.strictEqual(recebido.comentarios.length, 1);
    });

    await caso('CRITERIO: pela tela, caso novo nasce da gravacao e recebe a execucao', async () => {
      zerar();
      await pg.click('[data-acao="publicarZephyr"]');
      await pg.waitForFunction(() => document.getElementById('fundoConfirma').classList.contains('aberto')
        && !document.getElementById('campoEscolhaConfirma').hidden, { timeout: 10000 });
      const opcoes = await pg.$$eval('#escolhaConfirma option', os => os.map(o => o.textContent));
      assert.strictEqual(opcoes[0], 'GOV-T1 · Login com senha certa', 'o padrao tem de ser um caso que ja existe');
      assert.strictEqual(opcoes[opcoes.length - 1], '+ Criar caso novo a partir desta gravação');
      await pg.select('#escolhaConfirma', '__novo__');
      await pg.click('#btnSim');
      await pg.waitForFunction(() => /Criar caso de teste no Zephyr/.test(document.getElementById('tituloConfirma').textContent));
      const nome = await pg.$eval('#camposConfirma [data-campo="nome"]', el => el.value);
      assert.ok(nome.length > 0, 'o nome do caso devia vir sugerido');
      await pg.click('#btnSim');
      await pg.waitForFunction(() => /Caso GOV-T20 criado/.test(document.querySelector('.aviso-toast .aviso-texto')?.textContent || ''), { timeout: 20000 });

      const naEvidencia = await pg.$$eval('#conteudoRegistro .passo', els => els.length);
      assert.strictEqual(recebido.casos[0].name, nome);
      assert.strictEqual(recebido.roteiros[0].caso, 'GOV-T20');
      assert.strictEqual(recebido.roteiros[0].corpo.items.length, naEvidencia, 'o roteiro devia ter todos os passos gravados');
      assert.strictEqual(recebido.execucoes[0].testCaseKey, 'GOV-T20', 'a evidencia devia virar a execucao do caso novo');
      assert.strictEqual(recebido.execucoes[0].testScriptResults.length, naEvidencia, 'caso e gravacao casam passo a passo');
    });

    await caso('a evidencia lembra o bug aberto', async () => {
      const jiraSalvo = await pg.evaluate(() => new Promise(ok => {
        const req = indexedDB.open('auditeste_evidencias');
        req.onsuccess = () => {
          const t = req.result.transaction('registros', 'readonly').objectStore('registros').getAll();
          t.onsuccess = () => ok((t.result[0] || {}).jira || null);
        };
      }));
      assert.ok(jiraSalvo && jiraSalvo.chave === 'GOV-77', 'nao guardou: ' + JSON.stringify(jiraSalvo));
    });

    await caso('rota: o bug fica na auditoria da equipe, e nenhum erro de script', async () => {
      const r = await pg.evaluate(async () => (await fetch('/api/auditoria')).json());
      const eventos = (r.eventos || []).map(e => e.acao);
      assert.ok(eventos.includes('jira.bug') && eventos.includes('jira.demanda'), 'nao auditou: ' + eventos.join(','));
      assert.deepStrictEqual(erros, []);
    });
  } catch (e) {
    falhas++;
    console.log('  FALHOU (preparo) ' + e.message);
  } finally {
    if (nav) await nav.close().catch(() => {});
    proc.kill();
  }
}
