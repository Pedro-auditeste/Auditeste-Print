/* Prova o que o QA pediu: projeto criado NO PRINT tem de aparecer no cofre,
 * e a pessoa escolhe em qual equipe/segmento ele nasce.
 *
 * Antes disto, projeto criado no Print era so' local (IndexedDB). O cofre so
 * ficava sabendo dele quando alguem clicava "Enviar ao cofre" numa evidencia,
 * entao a lista do cofre vivia vazia mesmo com projeto criado no Print.
 *
 *   node teste-projeto-nasce-no-cofre.js
 *   node teste-projeto-nasce-no-cofre.js --visivel
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');
const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const VISIVEL = process.argv.includes('--visivel');
const PORTA = 8996;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nasce-cofre-')), 'c.db');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let feitos = 0;
const ok = (t) => { feitos++; console.log('  ok   ' + t); };

(async () => {
  banco.abrir(ARQUIVO);
  const tenant = banco.criarTenant('Cliente QA', 90);
  const u = banco.criarUsuario('qa@local.teste', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  // Um segmento, para existir escolha de verdade nas abas.
  const seg = banco.criarTenant('Cliente QA · Regressao', 90);
  banco.vincular(seg.id, u.id, 'admin');
  banco.fechar();

  const servidor = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1',
      COFRE_BANCO: ARQUIVO, COFRE_SEGREDO: 'segredo-do-teste',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: 'ignore'
  });
  await esperar(2500);

  const navegador = await puppeteer.launch({
    headless: !VISIVEL,
    executablePath: caminhoChrome(),
    defaultViewport: VISIVEL ? null : { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const p = await navegador.newPage();
    p.on('pageerror', (e) => console.error('  erro na pagina:', e.message));

    // Entra no cofre para ter sessao (mesma origem do Print).
    await p.goto(BASE + '/cofre.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForSelector('#email', { visible: true, timeout: 15000 });
    await p.type('#email', 'qa@local.teste');
    await p.type('#senha', 'senha-bem-longa-9');
    await p.click('#btnEntrar');
    await p.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    ok('entrou no cofre');

    // Vai para o Print e abre o formulario de projeto novo.
    await p.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await p.click('#entrarSite');
    await p.waitForSelector('#telaProjetos.ativa');
    await p.click('[data-acao="novoProjeto"]');
    await p.waitForSelector('#campoNome', { visible: true });
    await p.waitForFunction(() => !document.getElementById('blocoCofre').hidden, { timeout: 10000 });
    ok('CRITERIO: com sessao do cofre, o Print oferece onde criar');

    const abas = await p.$$eval('#ondeCofre button', (bs) => bs.map((b) => b.textContent));
    assert.strictEqual(abas.length, 2, 'deveria ter equipe base + 1 segmento: ' + JSON.stringify(abas));
    assert.ok(/equipe base/.test(abas[0]), 'primeira aba e a equipe base: ' + abas[0]);
    assert.ok(/segmento/.test(abas[1]), 'segunda aba e o segmento: ' + abas[1]);
    /* A regra de rotulo fixo: nenhuma aba pode depender so' do nome escolhido
     * pela pessoa, senao base e segmento homonimos ficam identicos na tela. */
    ok('CRITERIO: as abas trazem equipe base e segmento, com rotulo fixo');

    // Escolhe o SEGMENTO e cria.
    await p.click('#ondeCofre button:nth-of-type(2)');
    await p.type('#campoNome', 'Nasce no Cofre');
    await p.click('#btnConfirmarModal');
    await p.waitForSelector('#gradeProjetos .cartao[data-projeto]', { timeout: 15000 });
    ok('projeto criado no Print');

    // CRITERIO principal: o cofre TEM esse projeto, e no segmento escolhido.
    const noCofre = await p.evaluate(async () => {
      const r = await fetch('/api/projetos');
      return r.json();
    });
    const achado = (noCofre.projetos || []).find((x) => x.nome === 'Nasce no Cofre');
    assert.ok(!achado,
      'na equipe BASE ele nao deve aparecer: foi criado dentro do segmento');
    ok('CRITERIO: criado no segmento, nao vaza para a lista da equipe base');

    // Troca para o segmento e confirma que esta la.
    const segs = await p.evaluate(async () => (await (await fetch('/api/segmentos')).json()));
    const alvo = segs.segmentos[0];
    await p.evaluate(async (id) => {
      await fetch('/api/trocar-equipe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: id })
      });
    }, alvo.id);
    const noSegmento = await p.evaluate(async () => (await (await fetch('/api/projetos')).json()));
    const dentro = (noSegmento.projetos || []).find((x) => x.nome === 'Nasce no Cofre');
    assert.ok(dentro, 'o projeto tinha de estar no segmento escolhido: '
      + JSON.stringify((noSegmento.projetos || []).map((x) => x.nome)));
    ok('CRITERIO: o projeto aparece no cofre, dentro do segmento escolhido');

    console.log('\n' + feitos + ' casos, tudo certo\n');
  } finally {
    await navegador.close().catch(() => {});
    servidor.kill();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
