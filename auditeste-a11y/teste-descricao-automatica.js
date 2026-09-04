/* Trava o bug: passo chegando pelo caminho AO VIVO (window.postMessage
 * AUDI_PRINT_PASSO, o mesmo que a extensao usa para empurrar sem o usuario
 * clicar em nada) tinha de disparar a descricao automatica sozinho, igual
 * os outros dois caminhos (Trazer captura, Importar arquivo) ja faziam.
 * Antes deste conserto, so esses dois chamavam gerarDescricoesPendentes();
 * o caminho automatico entrava o passo e ficava parado em "Descricao
 * pendente." ate alguem notar e clicar no botao manual.
 *
 *   node teste-descricao-automatica.js
 *
 * Nao precisa da extensao real: simula so a mensagem que ela manda.
 */
const assert = require('assert');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';

function chromeLocal() {
  return [
    caminhoChrome(),
    process.env.CHROME_PATH,
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  ].find((p) => p && fs.existsSync(p));
}

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

const PASSO = {
  id: 'p-auto-1',
  titulo: 'Clicou em "Finalizar compra"',
  obs: 'Descrição pendente.',
  acao: 'Clicar',
  elemento: '//*[@id="btn-finalizar"]',
  rotulo: 'Finalizar compra',
  html: '<button id="btn-finalizar">Finalizar compra</button>',
  timestampAntes: new Date().toISOString(),
  timestampDepois: new Date().toISOString(),
  urlAntes: 'https://exemplo.test/checkout',
  urlDepois: 'https://exemplo.test/obrigado',
  imagens: [{ dataUrl: pixel, legenda: 'Antes' }, { dataUrl: pixel, legenda: 'Depois' }]
};

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeLocal(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const pagina = await browser.newPage();
  pagina.on('pageerror', (erro) => console.error('ERRO NA PÁGINA:', erro.message));

  // Mocka a /descrever, igual teste-pares-ui.js: sem chave de IA nenhuma.
  await pagina.setRequestInterception(true);
  pagina.on('request', (req) => {
    if (req.url().endsWith('/descrever')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          legenda_curta: 'Clique em Finalizar compra concluiu o pedido',
          descricao_detalhada: 'Descrição de teste.',
          titulo_cenario: 'Finalizar compra conclui o pedido',
          gherkin: 'Cenário: x\n  Dado y\n  Quando z\n  Então w',
          cenarios_alternativos: [],
          alerta_qa: ''
        })
      });
    } else req.continue();
  });

  try {
    await pagina.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pagina.click('#entrarSite');
    await pagina.waitForSelector('#telaProjetos.ativa');
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.type('#campoNome', 'Teste Descrição Automática');
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await pagina.waitForSelector('[data-acao="novaGravacao"]');
    await pagina.click('[data-acao="novaGravacao"]');
    await pagina.waitForSelector('#telaGravador.ativa');

    // Espera passar da janela dos 3s que abrirGravador() usa para o UNICO
    // pull automatico de abertura (pedirAoNavegador(null,3000) dentro de
    // completarComONavegador). Depois dela, SO o conserto desta funcao
    // garante que um passo chegando ao vivo gera a propria descricao --
    // sem esperar, o teste passaria por acidente, pego por aquele pull de
    // abertura em vez de provar o caminho que estamos consertando.
    await new Promise((r) => setTimeout(r, 4000));

    // O caminho AO VIVO: so a mensagem que a extensao manda, sem clicar em
    // nenhum botao de trazer/importar.
    await pagina.evaluate((passo) => {
      window.postMessage({ tipo: 'AUDI_PRINT_PASSO', passo, origem: { url: passo.urlAntes, titulo: 'Checkout' } }, location.origin);
    }, PASSO);

    await pagina.waitForSelector('.passo', { timeout: 5000 });
    console.log('  ok   o passo chegou pelo caminho ao vivo');

    // CRITERIO: sem clicar em nada, a descricao chega sozinha.
    await pagina.waitForFunction(
      () => /Finalizar compra concluiu o pedido/i.test(document.querySelector('.passo .legenda-ia')?.textContent || ''),
      { timeout: 8000 }
    );
    console.log('  ok   CRITERIO: a descrição foi gerada sozinha, sem clicar em "Gerar descrição"');

    const obs = await pagina.$eval('.passo .obs', (el) => el.textContent);
    assert.strictEqual(obs, 'Descrição de teste.', 'a observação detalhada não veio da descrição automática');
    console.log('  ok   CRITERIO: a descrição detalhada substituiu "Descrição pendente."');

    console.log('\n3 casos, tudo certo\n');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
