/* Fumaca: o Print abre sem erro de JS e com as pecas essenciais.
 *
 *   node teste-print-abre.js
 *
 * Pega regressao de remocao — foi assim que descobri que um corte largo demais
 * tinha levado a busca de projetos junto.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ESSENCIAIS = [
  'campoBusca', 'gradeProjetos', 'listaRegistros', 'blocoRecentes', 'recentes',
  'semResultado', 'btnIniciar', 'btnCapturar', 'btnPausar', 'btnParar',
  'telaGravador', 'statusIA', 'gravarVideo'
];

(async () => {
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await nav.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await p.goto(pathToFileURL(path.join(__dirname, 'publico', 'index.html')).href,
    { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  const r = await p.evaluate((ids) => ({
    faltando: ids.filter((id) => !document.getElementById(id)),
    telas: document.querySelectorAll('.tela').length,
    rotuloIniciar: (document.getElementById('btnIniciar') || {}).textContent,
    sobrouTesteAutomatico: !!document.querySelector(
      '#urlTesteIa, #urlTesteIaHome, #urlTesteIaProjeto, .caixa-link, #estadoTesteIa'
    )
  }), ESSENCIAIS);

  await nav.close();
  console.log(JSON.stringify(r, null, 2));
  console.log('erros de JS: ' + (erros.length ? erros.join(' | ') : 'nenhum'));

  assert.deepStrictEqual(r.faltando, [], 'sumiram elementos essenciais');
  assert.ok(r.telas >= 3, 'faltam telas: ' + r.telas);
  assert.match(r.rotuloIniciar, /gravação/i, 'botão ainda fala em teste');
  assert.strictEqual(r.sobrouTesteAutomatico, false, 'sobrou peça do teste automático');
  assert.strictEqual(erros.length, 0, 'a página deu erro de JS');
  console.log('\nRESULTADO: PASSOU');
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
