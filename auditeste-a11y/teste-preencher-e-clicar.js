/* Digitar a senha e clicar direto em Entrar grava os três passos.
 *
 *   node teste-preencher-e-clicar.js
 *
 * O pointerdown do botão chega ANTES do change do campo. Antes de 09/11/2026
 * o Clicar virava o passo pendente e o change da senha, chegando logo depois,
 * era descartado: a sessão saía com "Preencher E-mail" e "Clicar Entrar", sem
 * a senha. Aqui não há pausa nenhuma entre digitar e clicar.
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA = 8963;
const SENHA = 'segredo123';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Login</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1 id="tit">Acesse sua conta</h1>
  <p><label for="email">E-mail</label> <input id="email" type="email"></p>
  <p><label for="senha">Senha</label> <input id="senha" type="password"></p>
  <button id="entrar" type="button" style="padding:14px 28px">Entrar</button>
  <script>
    entrar.addEventListener('click', () => { tit.textContent = 'Bem-vindo'; });
  </script>
</body></html>`;

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA, '127.0.0.1');

  const nav = await puppeteer.launch({
    headless: false, executablePath: caminhoChrome(), defaultViewport: null,
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1100,760']
  });

  try {
    let sw = null;
    for (let i = 0; i < 60 && !sw; i++) {
      sw = nav.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'o complemento não carregou');
    const idExt = new URL(sw.url()).host;

    const aba = await nav.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });

    const pop = await nav.newPage();
    await pop.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    await pop.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id, capturarPrints: true });
    });
    await pop.close();
    await aba.bringToFront();

    // Ritmo de digitação de gente, e o clique em Entrar colado no último caractere.
    await aba.click('#email');
    await aba.type('#email', 'qa@exemplo.com', { delay: 60 });
    await aba.click('#senha');
    await aba.type('#senha', SENHA, { delay: 60 });
    await aba.click('#entrar');
    await esperar(6000);

    const inspetor = await nav.newPage();
    await inspetor.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    const sessao = await inspetor.evaluate(async () => {
      const s = (await chrome.storage.local.get('sessoesAudiPrint')).sessoesAudiPrint || {};
      return Object.values(s).find((x) => (x.passos || []).length) || null;
    });
    assert.ok(sessao, 'nenhum passo gravado');

    const passos = sessao.passos.map((p) => ({ acao: p.acao, rotulo: p.rotulo, valor: p.valor, imagens: p.imagens.length }));
    passos.forEach((p, i) => console.log(`  passo ${i + 1}: ${p.acao} "${p.rotulo}" valor="${p.valor}" prints=${p.imagens}`));

    assert.deepStrictEqual(passos.map((p) => p.acao + ' ' + p.rotulo),
      ['Preencher E-mail', 'Preencher Senha', 'Clicar Entrar'],
      'passos fora do esperado');
    assert.strictEqual(passos[0].valor, 'qa@exemplo.com', 'valor do e-mail não veio');
    assert.strictEqual(passos[1].valor, '', 'a senha não pode ir para a evidência');
    for (const p of passos) assert.strictEqual(p.imagens, 2, 'faltou print em ' + p.acao + ' ' + p.rotulo);
    assert.ok(!JSON.stringify(sessao).includes(SENHA), 'a senha apareceu em algum lugar da sessão gravada');
    assert.ok(!sessao.pendente && !(sessao.fila || []).length, 'sobrou passo aberto ou na fila');

    console.log('\nRESULTADO: PASSOU');
  } finally {
    await nav.close().catch(() => {});
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
