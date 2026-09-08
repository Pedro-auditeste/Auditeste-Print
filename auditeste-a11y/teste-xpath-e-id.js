/* Prova o refino pedido: xpath ancorado no id mais proximo (nao so o
 * absoluto desde a raiz), o campo elementoId separado, e a captura de
 * print virando opcional pelo checkbox do popup.
 *
 *   node teste-xpath-e-id.js
 *
 * AVISO: escrito e nao rodado neste ambiente -- o Chrome do puppeteer nao
 * abre neste sandbox agora (mesmo erro em testes antigos que ja passavam,
 * ver teste-push-automatico.js). Rodar localmente antes de confiar cego.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA_SITE = 8995;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Página de teste</title></head>
<body style="font-family:system-ui;padding:40px">
  <div id="painel">
    <div><button id="comId">Tem id próprio</button></div>
    <div><button>Sem id, mas dentro de #painel</button></div>
  </div>
  <div><div><button>Sem id em lugar nenhum da ancestralidade</button></div></div>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeLocal() {
  return [
    caminhoChrome(),
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find((p) => p && fs.existsSync(p));
}

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeLocal(),
    args: ['--no-sandbox', '--disable-setuid-sandbox',
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const encerrar = async () => { await browser.close().catch(() => {}); site.close(); };

  try {
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'a extensão não carregou');
    const idExt = new URL(sw.url()).host;

    const aba = await browser.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' });

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });

    // CRITERIO 1: sem print -- desmarca o checkbox antes de iniciar.
    await popup.$eval('#capturarPrints', (el) => { el.checked = false; });
    await popup.click('#iniciar');
    await esperar(300);
    console.log('  ok   gravação iniciada com "Capturar prints" desmarcado');

    await aba.bringToFront();
    await aba.click('#comId');
    await aba.click('body > div:nth-of-type(1) > div:nth-of-type(2) > button');
    await aba.click('body > div:nth-of-type(2) button');
    await esperar(4000); // ESPERA_DEPOIS_MS + folga para os 3 passos fecharem

    const status = await popup.evaluate(async () => {
      const [aba] = await chrome.tabs.query({ url: 'http://127.0.0.1:8995/*' });
      return chrome.runtime.sendMessage({ tipo: 'AUDI_STATUS', tabId: aba.id });
    });
    const passos = status.sessao.passos;
    assert.strictEqual(passos.length, 3, 'deveria ter fechado os 3 passos: ' + passos.length);

    // CRITERIO 2: elemento com id proprio -- xpath usa o id direto.
    assert.strictEqual(passos[0].elementoId, 'comId', 'elementoId não veio: ' + passos[0].elementoId);
    assert.strictEqual(passos[0].elemento, '//*[@id="comId"]', 'xpath do elemento com id: ' + passos[0].elemento);
    console.log('  ok   CRITERIO: elemento com id próprio usa o id direto, e elementoId veio separado');

    // CRITERIO 3: sem id proprio, mas com ancestral #painel -- ancorado, nao absoluto.
    assert.strictEqual(passos[1].elementoId, '', 'não deveria ter id próprio: ' + passos[1].elementoId);
    assert.ok(passos[1].elemento.startsWith('//*[@id="painel"]'),
      'deveria ancorar em #painel, veio: ' + passos[1].elemento);
    assert.ok(!passos[1].elemento.startsWith('/html'), 'não deveria cair no absoluto: ' + passos[1].elemento);
    console.log('  ok   CRITERIO: sem id próprio, ancora no ancestral mais próximo (#painel), não no absoluto');

    // CRITERIO 4: sem id em lugar nenhum -- cai no posicional absoluto mesmo.
    assert.ok(passos[2].elemento.startsWith('/html'), 'deveria ser absoluto: ' + passos[2].elemento);
    console.log('  ok   CRITERIO: sem id em nenhum ancestral, cai no posicional absoluto de sempre');

    // CRITERIO 5: nenhum passo tem imagem -- o checkbox desligou o print de verdade.
    for (const p of passos) assert.strictEqual((p.imagens || []).length, 0, 'não deveria ter imagem: ' + JSON.stringify(p.imagens));
    console.log('  ok   CRITERIO: "Capturar prints" desmarcado, nenhum dos 3 passos tem imagem');

    console.log('\n5 casos, tudo certo\n');
  } finally {
    await encerrar();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
