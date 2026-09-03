/* Fecha o ciclo do caminho manual: a extensao exporta um .json (botao
 * "Exportar JSON" no popup), e o Print tem de saber importa-lo de volta.
 *
 * Antes desta funcao existir, o botao de exportar baixava um arquivo que
 * nao ia para lugar nenhum -- o formato nunca era lido por nada no Print.
 * Servia so como caminho de emergencia quando a ponte automatica
 * (postMessage entre as abas) nao funciona, e sem o importador esse caminho
 * de emergencia nao existia de verdade.
 *
 *   node teste-importar-extensao.js
 *
 * Sobe a ponte local (sem extensao real, sem cofre) e simula so o lado do
 * arquivo: escreve um .json no formato que popup.js produz, seleciona ele
 * no input de arquivo e confere que o passo entra na tela, com o xpath.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const PORTA = 8933;
const BASE = 'http://127.0.0.1:' + PORTA;

function chromeLocal() {
  return [
    caminhoChrome(),
    process.env.CHROME_PATH,
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  ].find((p) => p && fs.existsSync(p));
}

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

// O mesmo formato que popup.js escreve no botao "Exportar JSON".
const EXPORTADO = {
  formato: 'audi-print-evidencia-v1',
  url: 'https://exemplo.test/checkout',
  titulo: 'Checkout',
  inicio: new Date().toISOString(),
  passos: [{
    titulo: 'Clicou em "Finalizar compra"',
    obs: '',
    acao: 'Clicar',
    elemento: '//*[@id="btn-finalizar"]',
    rotulo: 'Finalizar compra',
    html: '<button id="btn-finalizar">Finalizar compra</button>',
    timestampAntes: new Date().toISOString(),
    timestampDepois: new Date().toISOString(),
    urlAntes: 'https://exemplo.test/checkout',
    urlDepois: 'https://exemplo.test/obrigado',
    imagens: [{ dataUrl: pixel, legenda: 'Antes' }, { dataUrl: pixel, legenda: 'Depois' }]
  }]
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const arqJson = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'imp-ext-')), 'exportado.json');
  fs.writeFileSync(arqJson, JSON.stringify(EXPORTADO));

  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(2500);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeLocal(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const encerrar = async () => { await browser.close().catch(() => {}); ponte.kill(); };

  try {
    const pagina = await browser.newPage();
    pagina.on('pageerror', (erro) => console.error('ERRO NA PÁGINA:', erro.message));

    await pagina.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pagina.click('#entrarSite');
    await pagina.waitForSelector('#telaProjetos.ativa');
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.type('#campoNome', 'Teste Importar Extensão');
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await pagina.waitForSelector('[data-acao="novaGravacao"]');
    await pagina.click('[data-acao="novaGravacao"]');

    console.log('  ok   chegou na tela de gravação');

    // CRITERIO: o botão de importar existe e está visível, sem depender de
    // a extensão estar instalada ou de a ponte automática estar viva.
    const botaoVisivel = await pagina.$eval('[data-acao="importarExtensao"]', (b) => !b.hidden);
    assert.ok(botaoVisivel, 'o botão de importar arquivo não está visível');
    console.log('  ok   CRITERIO: botão de importar visível independente da extensão');

    const input = await pagina.$('#arqExtensao');
    assert.ok(input, 'o input de arquivo não existe na página');
    await input.uploadFile(arqJson);

    await pagina.waitForSelector('.passo', { timeout: 10000 });
    console.log('  ok   CRITERIO: o passo do arquivo entrou na tela');

    const xpath = await pagina.$eval('.passo .meta-qa code', (el) => el.textContent);
    assert.strictEqual(xpath, '//*[@id="btn-finalizar"]', 'o xpath do arquivo importado não chegou certo');
    console.log('  ok   CRITERIO: o xpath do elemento veio junto');

    const titulo = await pagina.$eval('.passo .titulo', (el) => el.textContent);
    assert.ok(/Finalizar compra/.test(titulo), 'o título do passo não veio');

    // Reimportar o MESMO arquivo não duplica: chaveDoPasso() usa o id do
    // passo, e o mesmo arquivo tem o mesmo id.
    const antes = await pagina.$$eval('#lista > .passo', (els) => els.length);
    await input.uploadFile(arqJson);
    await esperar(800);
    const depois = await pagina.$$eval('#lista > .passo', (els) => els.length);
    assert.strictEqual(depois, antes, 'reimportar o mesmo arquivo duplicou o passo');
    console.log('  ok   CRITERIO: reimportar o mesmo arquivo não duplica');

    // arquivo que nao e do formato certo: recusa, sem quebrar a tela.
    const arqRuim = path.join(path.dirname(arqJson), 'nao-e-isso.json');
    fs.writeFileSync(arqRuim, JSON.stringify({ formato: 'outra-coisa' }));
    await input.uploadFile(arqRuim);
    await esperar(500);
    const depoisRuim = await pagina.$$eval('#lista > .passo', (els) => els.length);
    assert.strictEqual(depoisRuim, depois, 'arquivo de formato errado não pode virar passo');
    console.log('  ok   CRITERIO: arquivo de outro formato é recusado, sem quebrar a tela');

    console.log('\n6 casos, tudo certo\n');
  } finally {
    await encerrar();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
