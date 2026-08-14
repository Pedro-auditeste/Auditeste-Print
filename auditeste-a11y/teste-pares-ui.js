/* Smoke do JSON da extensão + descrição assíncrona + responsividade 320/1200. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';
const arquivo = path.join(os.tmpdir(), 'audi-print-pares-teste.json');

function chromeLocal() {
  return [
    caminhoChrome(),
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find((p) => p && fs.existsSync(p));
}

fs.writeFileSync(arquivo, JSON.stringify({
  formato: 'audi-print-evidencia-v1',
  url: 'https://exemplo.test/login',
  titulo: 'Exemplo',
  passos: [{
    titulo: 'Clicou em "Entrar"',
    obs: 'Descrição pendente.',
    acao: 'Clicar',
    elemento: '#btn-entrar',
    rotulo: 'Entrar',
    html: '<button id="btn-entrar">Entrar</button>',
    timestampAntes: '2026-08-14T12:00:00.000Z',
    timestampDepois: '2026-08-14T12:00:01.000Z',
    urlAntes: 'https://exemplo.test/login',
    urlDepois: 'https://exemplo.test/dashboard',
    imagens: [
      { dataUrl: pixel, legenda: 'Antes' },
      { dataUrl: pixel, legenda: 'Depois' }
    ]
  }]
}));

const DESCRICAO_LONGA = 'Antes havia a tela de login com e-mail e senha. '
  + 'Depois apareceu o painel principal com o menu lateral, os cartões de resumo e o nome do usuário no topo. '.repeat(12)
  + 'Fim da descrição completa.';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromeLocal(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const pagina = await browser.newPage();
  pagina.on('pageerror', (erro) => console.error('ERRO NA PÁGINA:', erro.message));
  let corpoDescricao = null;
  await pagina.setRequestInterception(true);
  pagina.on('request', (req) => {
    if (req.url().endsWith('/descrever')) {
      try { corpoDescricao = JSON.parse(req.postData() || '{}'); } catch (_) { corpoDescricao = {}; }
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          legenda_curta: 'Clique em Entrar abriu o painel',
          descricao_detalhada: DESCRICAO_LONGA,
          titulo_cenario: 'Entrar redireciona para o painel',
          gherkin: 'Cenário: Entrar redireciona para o painel\n  Dado que estou no login\n  Quando clico em Entrar\n  Então vejo o painel\n  E vejo o menu',
          cenarios_alternativos: ['Entrar sem senha'],
          alerta_qa: 'Validar se o redirecionamento está correto.'
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
    await pagina.type('#campoNome', 'Teste Pares');
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await pagina.waitForSelector('[data-acao="novaGravacao"]');
    await pagina.click('[data-acao="novaGravacao"]');
    await pagina.waitForSelector('#arqA11y');
    const input = await pagina.$('#arqA11y');
    await input.uploadFile(arquivo);
    await pagina.waitForSelector('.passo .imagens.par-antes-depois figure:nth-child(2)');
    await pagina.waitForFunction(() => /abriu o painel/i.test(document.querySelector('.passo .titulo')?.textContent || ''));

    assert.strictEqual(await pagina.$eval('.passo .meta-qa code', (el) => el.textContent), '#btn-entrar');
    assert.ok(await pagina.$eval('.passo .meta-evento', (el) => /URL antes:.*login.*URL depois:.*dashboard/i.test(el.textContent)));
    assert.strictEqual(await pagina.$eval('.passo .legenda-ia', (el) => el.textContent), 'Clique em Entrar abriu o painel');
    assert.ok(await pagina.$eval('.passo .analise-qa pre', (el) => /Dado que[\s\S]*Quando[\s\S]*Então/.test(el.textContent)));
    assert.strictEqual(await pagina.$eval('.passo .obs', (el) => el.textContent), DESCRICAO_LONGA, 'descrição longa não pode ser cortada');
    assert.strictEqual(
      await pagina.$eval('.passo .analise-qa p', (el) => el.textContent),
      DESCRICAO_LONGA,
      'análise detalhada não pode ser cortada'
    );
    assert.ok(await pagina.$eval('.passo', (el) => el.classList.contains('alerta-qa')));
    assert.strictEqual(corpoDescricao.elemento, '#btn-entrar');
    assert.ok('modulo' in corpoDescricao && 'tipoTeste' in corpoDescricao);
    assert.ok(/^data:image\/jpeg;base64,/.test(corpoDescricao.par), 'par visual composto enviado');
    assert.strictEqual(await pagina.$eval('.passo', (el) => JSON.parse(el.dataset.analiseQa).cenarios_alternativos.length), 1);
    await pagina.$eval('.passo [data-acao="adicionarAlternativo"]', (el) => el.click());
    await pagina.waitForFunction(() => document.querySelectorAll('#lista > .passo').length === 2);
    assert.strictEqual(await pagina.$$eval('#lista > .passo', (els) => els.length), 2, 'cenário alternativo manual');

    await pagina.setViewport({ width: 320, height: 800 });
    const mobile = await pagina.evaluate(() => ({
      semScroll: document.documentElement.scrollWidth <= innerWidth + 1,
      colunas: getComputedStyle(document.querySelector('.par-antes-depois')).gridTemplateColumns.split(' ').length
    }));
    assert.ok(mobile.semScroll, 'sem scroll horizontal em 320px');
    assert.strictEqual(mobile.colunas, 1, 'par empilhado em mobile');

    await pagina.setViewport({ width: 768, height: 900 });
    const tablet = await pagina.evaluate(() => ({
      semScroll: document.documentElement.scrollWidth <= innerWidth + 1,
      colunas: getComputedStyle(document.querySelector('.par-antes-depois')).gridTemplateColumns.split(' ').length
    }));
    assert.ok(tablet.semScroll, 'sem scroll horizontal em 768px');
    assert.strictEqual(tablet.colunas, 1, 'par empilhado em tablet estreito');

    await pagina.setViewport({ width: 1920, height: 1080 });
    const desktop = await pagina.evaluate(() => ({
      semScroll: document.documentElement.scrollWidth <= innerWidth + 1,
      colunas: getComputedStyle(document.querySelector('.par-antes-depois')).gridTemplateColumns.split(' ').length
    }));
    assert.ok(desktop.semScroll, 'sem scroll horizontal em 1920px');
    assert.strictEqual(desktop.colunas, 2, 'par lado a lado em desktop');
    console.log('OK  JSON da extensão importado com #id e metadados');
    console.log('OK  JSON QA, Gherkin, alerta e cenário alternativo aplicados');
    console.log('OK  responsivo em 320px, 768px e 1920px');
    console.log('RESULTADO: PASSOU');
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(arquivo, { force: true });
  }
})().catch((erro) => {
  console.error('FALHOU:', erro.message);
  process.exitCode = 1;
});
