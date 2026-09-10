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

    /* O caso real do QA em 09/09/2026: a extensao instalada e a 2.1.0, que
     * manda o xpath e NAO manda elementoId. Sem o fallback, o id ficava vazio
     * na tela e parecia que "o id nao vem", quando ele estava dentro do
     * proprio xpath o tempo todo. */
    const passoVelho = passoCom('extensao-antiga');
    delete passoVelho.elementoId;
    await p.evaluate((passo) => {
      window.postMessage({ tipo: 'AUDI_PRINT_PASSO', passo, origem: { url: passo.urlAntes, titulo: 'x' } }, location.origin);
    }, passoVelho);
    await p.waitForFunction(() => document.querySelectorAll('#lista > .passo').length === 3, { timeout: 8000 });
    const velho = await p.evaluate(() => {
      const ps = document.querySelectorAll('#lista > .passo');
      const el = ps[ps.length - 1];
      return { id: el.dataset.elementoId || '', texto: el.querySelector('.meta-qa').textContent };
    });
    assert.strictEqual(velho.id, 'entrar', 'o id tinha de sair do xpath quando a extensão não manda: ' + velho.id);
    assert.ok(/id:\s*entrar/.test(velho.texto), 'o id tinha de aparecer na tela também');
    console.log('  ok   CRITERIO: extensão antiga sem o campo, o id sai do próprio xpath');

    /* O passo gravado mostra o ELEMENTO, nada de narrativa (10/09/2026).
     * Titulo, observacao, carimbo e o bloco de datas continuam no DOM porque
     * salvar, exportar e os achados de acessibilidade dependem deles, mas
     * somem da tela do gravador. */
    const naTela = await p.evaluate(() => {
      const el = document.querySelector('#lista > .passo');
      const mostra = (s) => { const n = el.querySelector(s); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; };
      return { meta: mostra('.meta-qa'), titulo: mostra('.titulo'), obs: mostra('.obs'),
               carimbo: mostra('.carimbo'), datas: mostra('.meta-evento'), botaoDesc: mostra('.gerar-desc') };
    });
    assert.strictEqual(naTela.meta, true, 'a linha do elemento tem de aparecer');
    for (const parte of ['titulo', 'obs', 'carimbo', 'datas', 'botaoDesc']) {
      assert.strictEqual(naTela[parte], false, parte + ' voltou a aparecer no passo gravado');
    }
    console.log('  ok   CRITERIO: no passo gravado sobra só o elemento, sem narrativa');

    console.log('\n6 casos, tudo certo\n');
  } finally {
    await navegador.close().catch(() => {});
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
