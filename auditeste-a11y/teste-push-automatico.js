/* Prova o que motivou o conserto das origens da extensao (background.js e
 * content.js), E o conserto do "atire e esqueca" no push (mesmo arquivo):
 * com a extensao corrigida, o passo tem de chegar SOZINHO na aba do Print ao
 * terminar a interacao -- sem clicar em "Trazer captura", sem abrir o popup.
 * Era esse "nao vem" que o usuario reportou.
 *
 *   node teste-push-automatico.js
 *
 * Local, por http://127.0.0.1 -- nao reproduz o dominio Railway em si (isso
 * ja esta travado por conteudo em teste-extensao-origens.js), mas roda o
 * MESMO codigo com o MESMO formato de lista (duas entradas em vez de uma)
 * que o conserto das origens mudou, e o MESMO caminho de push que o conserto
 * do await mudou, numa gravacao de ponta a ponta com Chrome de verdade: arma
 * por comando explicito, grava numa aba separada, e confere que o Print
 * recebeu sem nenhum clique -- sem nenhuma outra chamada a extensao no meio
 * do caminho, que era o que mascarava o bug do push sem await.
 *
 * AVISO HONESTO: mesmo depois do await e da conexao de manter-vivo
 * (audi-keepalive em content.js/background.js), este teste continua
 * FALHANDO de forma reproduzivel no Chrome headless deste ambiente de
 * automacao -- o service worker parece ser encerrado mais agressivamente
 * aqui do que num Chrome de usuario de verdade. Com um depurador (CDP)
 * conectado ao service worker, ou com o DevTools aberto nele, o push
 * acontece sempre; sem observador nenhum, falha sempre neste ambiente. Os
 * dois consertos (await + keepalive) sao corretos e recomendados pelo
 * proprio Chrome para este problema, mas a confirmacao final de que
 * resolvem em uso real precisa vir de um Chrome de usuario, nao headless.
 * Se um dia isto passar a passar de forma confiavel tambem aqui, e sinal de
 * que o Chrome do CI mudou de comportamento -- nao mexer neste aviso sem
 * checar antes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA = 8934;
const BASE = 'http://127.0.0.1:' + PORTA;
const PORTA_SITE = 8935;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>Loja de teste</h1>
  <button id="entrarSite" style="padding:14px 28px;font-size:16px">Entrar</button>
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

  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(2500);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeLocal(),
    args: ['--no-sandbox', '--disable-setuid-sandbox',
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const encerrar = async () => { await browser.close().catch(() => {}); ponte.kill(); site.close(); };

  try {
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'a extensão não carregou');
    console.log('  ok   extensão carregada');
    const idExt = new URL(sw.url()).host;

    const print = await browser.newPage();
    await print.bringToFront();
    await print.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await print.click('#entrarSite');
    await print.waitForSelector('#telaProjetos.ativa');
    await print.click('[data-acao="novoProjeto"]');
    await print.waitForSelector('#campoNome', { visible: true });
    await print.type('#campoNome', 'Push Automático');
    await print.click('#btnConfirmarModal');
    await print.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await print.click('#gradeProjetos .cartao[data-projeto]');
    await print.waitForSelector('[data-acao="novaGravacao"]');
    await print.click('[data-acao="novaGravacao"]');
    await print.waitForSelector('#telaGravador.ativa');
    console.log('  ok   Print na tela de gravação, pronto para receber');

    const aba = await browser.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' });

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popup.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:8935/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id });
    });
    await popup.close();
    console.log('  ok   gravação iniciada na aba do site');

    // A interação. Daqui em diante, NENHUM comando é mandado à extensão,
    // NENHUMA outra página da extensão é aberta: ela tem que registrar o
    // passo e empurrar para o Print inteiramente por conta própria.
    await aba.bringToFront();
    await aba.click('#entrarSite');
    console.log('  ok   interação feita (clique em "Entrar")');

    // NAO clica em nada na aba do Print, NAO abre mais nada da extensão,
    // NENHUM observador conectado ao service worker.
    await print.bringToFront();
    await print.waitForSelector('#lista > .passo', { timeout: 10000 });
    console.log('  ok   CRITERIO: o passo chegou sozinho na aba do Print, sem clique nenhum');

    const titulo = await print.$eval('.passo .titulo', (el) => el.textContent);
    assert.ok(/Entrar/.test(titulo), 'passo chegou sem o título esperado: ' + titulo);
    const xpath = await print.$eval('.passo .meta-qa code', (el) => el.textContent);
    assert.strictEqual(xpath, '//*[@id="entrarSite"]', 'xpath do elemento não veio junto');
    console.log('  ok   CRITERIO: xpath do elemento veio junto (' + xpath + ')');

    console.log('\n3 casos, tudo certo\n');
  } finally {
    await encerrar();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
