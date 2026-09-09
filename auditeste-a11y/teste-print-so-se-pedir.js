/* Trava o foco pedido pelo QA: xpath e id sempre, print antes/depois so
 * quando a pessoa marca a opcao.
 *
 * A guarda que este teste protege mora no Print (montarPassoDaExtensao), nao
 * so na extensao, de proposito: complemento antigo instalado continua
 * mandando imagem, e a escolha da tela tem de valer mesmo assim.
 *
 *   node teste-print-so-se-pedir.js
 */
const assert = require('assert');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

const passoCom = (id) => ({
  id, titulo: 'Clicou em "Entrar"', obs: 'Descrição pendente.',
  acao: 'Clicar', elemento: '//*[@id="entrar"]', elementoId: 'entrar',
  rotulo: 'Entrar', html: '<button id="entrar">Entrar</button>',
  urlAntes: 'https://exemplo.test/a', urlDepois: 'https://exemplo.test/b',
  imagens: [{ dataUrl: pixel, legenda: 'Antes' }, { dataUrl: pixel, legenda: 'Depois' }]
});

(async () => {
  const navegador = await puppeteer.launch({
    headless: true, executablePath: caminhoChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const p = await navegador.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.click('#entrarSite');
    await p.waitForSelector('#telaProjetos.ativa');
    await p.click('[data-acao="novoProjeto"]');
    await p.waitForSelector('#campoNome', { visible: true });
    await p.type('#campoNome', 'Foco em xpath e id');
    await p.click('#btnConfirmarModal');
    await p.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await p.click('#gradeProjetos .cartao[data-projeto]');
    await p.waitForSelector('[data-acao="novaGravacao"]');
    await p.click('[data-acao="novaGravacao"]');
    await p.waitForSelector('#telaGravador.ativa');

    const padrao = await p.$eval('#capturarPrintsPasso', (el) => el.checked);
    assert.strictEqual(padrao, false, 'o padrão da opção de print tem de ser desmarcado');
    console.log('  ok   CRITERIO: a opção de print nasce desmarcada');

    // Passo COM imagens, opcao desmarcada: o Print tem de descartar as imagens.
    await p.evaluate((passo) => {
      window.postMessage({ tipo: 'AUDI_PRINT_PASSO', passo, origem: { url: passo.urlAntes, titulo: 'x' } }, location.origin);
    }, passoCom('sem-print-1'));
    await p.waitForSelector('#lista > .passo', { timeout: 8000 });
    const imgs1 = await p.$$eval('#lista .passo figure', (f) => f.length);
    assert.strictEqual(imgs1, 0, 'desmarcado, o passo não pode ter imagem nenhuma: ' + imgs1);
    const sel1 = await p.$eval('#lista .passo .meta-qa code', (el) => el.textContent);
    assert.ok(/entrar/.test(sel1), 'o xpath tinha de continuar vindo: ' + sel1);
    console.log('  ok   CRITERIO: extensão mandou imagem, Print descartou, e o xpath ficou');

    const temId = await p.$eval('#lista .passo .meta-qa', (el) => el.textContent);
    assert.ok(/id:\s*entrar/.test(temId), 'o id devia aparecer no passo: ' + temId);
    console.log('  ok   CRITERIO: o id aparece no passo, separado do xpath');

    // Agora marcando a opcao: o print passa a entrar.
    /* Marca direto no elemento: clicar no input dentro do <label> alterna
     * duas vezes e volta a desmarcar. O que importa aqui e o estado. */
    await p.evaluate(() => { document.getElementById('capturarPrintsPasso').checked = true; });
    await p.evaluate((passo) => {
      window.postMessage({ tipo: 'AUDI_PRINT_PASSO', passo, origem: { url: passo.urlAntes, titulo: 'x' } }, location.origin);
    }, passoCom('com-print-1'));
    await p.waitForFunction(() => document.querySelectorAll('#lista > .passo').length === 2, { timeout: 8000 });
    await p.waitForFunction(() => document.querySelectorAll('#lista > .passo').length === 2, { timeout: 8000 });
    const imgs2 = await p.evaluate(() => {
      const ps = document.querySelectorAll('#lista > .passo');
      return ps[ps.length - 1].querySelectorAll('figure').length;
    });
    assert.strictEqual(imgs2, 2, 'marcado, o par antes/depois tinha de entrar: ' + imgs2);
    console.log('  ok   CRITERIO: marcando a opção, o print antes/depois volta a entrar');

    console.log('\n4 casos, tudo certo\n');
  } finally {
    await navegador.close().catch(() => {});
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
