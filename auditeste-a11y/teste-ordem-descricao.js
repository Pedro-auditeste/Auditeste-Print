/* As descrições saem na ordem dos passos, uma de cada vez.
 *
 *   node teste-ordem-descricao.js
 *
 * O contador antigo (while + descricaoAtivas++) não era atômico: vários jobs
 * passavam no mesmo tick e acordavam fora de ordem, então o passo 5 saía
 * descrito antes do 1 e o excedente levava 429 da ponte. Aqui a primeira
 * resposta é a mais lenta de propósito: sem fila, ela chega por último.
 */
const assert = require('assert');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const TOKEN = process.env.PONTE_TOKEN || '';
const PASSOS = 5;
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

const EVIDENCIA = {
  formato: 'audi-print-evidencia-v1',
  url: 'https://exemplo.test/tela',
  titulo: 'Exemplo',
  passos: Array.from({ length: PASSOS }, (_, i) => ({
    titulo: 'Clicou em "Botão ' + (i + 1) + '"',
    obs: 'Descrição pendente.',
    acao: 'Clicar',
    elemento: '//*[@id="btn-' + (i + 1) + '"]',
    rotulo: 'Botão ' + (i + 1),
    html: '<button id="btn-' + (i + 1) + '">Botão ' + (i + 1) + '</button>',
    urlAntes: 'https://exemplo.test/tela',
    urlDepois: 'https://exemplo.test/tela',
    imagens: [
      { dataUrl: pixel, legenda: 'Antes' },
      { dataUrl: pixel, legenda: 'Depois' }
    ]
  }))
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: caminhoChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const pagina = await browser.newPage();
  pagina.on('pageerror', (e) => console.error('ERRO NA PÁGINA:', e.message));

  const chegada = [];      // ordem em que os pedidos entraram
  let simultaneos = 0;
  let picoSimultaneos = 0;

  await pagina.setRequestInterception(true);
  pagina.on('request', async (req) => {
    if (!req.url().endsWith('/descrever')) return req.continue();
    let corpo = {};
    try { corpo = JSON.parse(req.postData() || '{}'); } catch (_) { /* corpo ilegível */ }
    const n = Number(String(corpo.elemento || '').replace(/\D+/g, '')) || 0;
    chegada.push(n);
    simultaneos++;
    picoSimultaneos = Math.max(picoSimultaneos, simultaneos);
    // O primeiro demora mais: sem fila, ele termina por último e desordena.
    await esperar(chegada.length === 1 ? 900 : 150);
    simultaneos--;
    req.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        legenda_curta: 'Descrição do botão ' + n,
        descricao_detalhada: 'O cliente clicou no botão ' + n + ' e a tela respondeu.',
        titulo_cenario: 'Clicar no botão ' + n,
        gherkin: 'Cenário: Clicar no botão ' + n + '\n  Dado que estou na tela\n  Quando clico no botão ' + n + '\n  Então a tela responde'
      })
    });
  });

  try {
    if (TOKEN) await pagina.evaluateOnNewDocument((t) => localStorage.setItem('ponte_token', t), TOKEN);
    await pagina.evaluateOnNewDocument((evid) => {
      addEventListener('message', (ev) => {
        const d = ev.data;
        if (ev.source !== window || !d || d.tipo !== 'AUDI_PRINT_PEDE') return;
        const corpo = d.deTab == null
          ? { evidencias: [{ tabId: 7, url: evid.url, titulo: evid.titulo, inicio: '', ativa: false, passos: evid.passos.length }] }
          : { evidencia: evid };
        postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
      });
    }, EVIDENCIA);

    await pagina.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pagina.click('#entrarSite');
    await pagina.waitForSelector('#telaProjetos.ativa');
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.type('#campoNome', 'Ordem');
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await pagina.waitForSelector('[data-acao="novaGravacao"]');
    await pagina.click('[data-acao="novaGravacao"]');
    await pagina.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
    await pagina.click('[data-acao="puxarExtensao"]');

    await pagina.waitForFunction(
      (n) => document.querySelectorAll('.passo[data-descricao-estado="pronta"]').length === n,
      { timeout: 60000 }, PASSOS
    );

    const esperada = Array.from({ length: PASSOS }, (_, i) => i + 1);
    assert.deepStrictEqual(chegada, esperada,
      'os pedidos saíram fora de ordem: ' + chegada.join(','));
    console.log('  OK   pedidos na ordem dos passos: ' + chegada.join(' → '));

    assert.strictEqual(picoSimultaneos, 1,
      'houve ' + picoSimultaneos + ' descrições ao mesmo tempo; a ponte recusa com 429');
    console.log('  OK   nunca mais de uma descrição por vez');

    const titulos = await pagina.$$eval('.passo .titulo', (els) => els.map((e) => e.textContent.trim()));
    assert.deepStrictEqual(titulos, esperada.map((n) => 'Descrição do botão ' + n),
      'as descrições foram parar no passo errado: ' + titulos.join(' | '));
    console.log('  OK   cada descrição no seu passo');

    const pendentes = await pagina.$$eval('.passo .obs',
      (els) => els.filter((e) => /Gerando descrição/.test(e.textContent)).length);
    assert.strictEqual(pendentes, 0, pendentes + ' passo(s) travados em "Gerando descrição"');
    console.log('  OK   nenhum passo travado em "Gerando descrição"');

    console.log('\nRESULTADO: PASSOU');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
