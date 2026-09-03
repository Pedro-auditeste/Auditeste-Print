/* Trava as tres listas de "onde o Print pode estar" na extensao ficando
 * sincronizadas: background.js (duas listas) e content.js (uma).
 *
 *   node teste-extensao-origens.js
 *
 * O bug real que isto evita: alguem hospeda o Print num dominio novo (um
 * espelho, uma troca de Railway) e esquece de acrescentar aqui. A extensao
 * continua gravando normal, so nunca acha a aba do Print para empurrar o
 * passo -- a gravacao "some" sem erro nenhum na tela, e parece bug de
 * gravacao quando e so uma lista desatualizada.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname.endsWith('auditeste-a11y')
  ? path.join(__dirname, '..', 'audi-print-scanner')
  : path.join(__dirname, 'audi-print-scanner');

const bg = fs.readFileSync(path.join(RAIZ, 'background.js'), 'utf8');
const ct = fs.readFileSync(path.join(RAIZ, 'content.js'), 'utf8');

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  ok   ' + nome); };

console.log('\norigens do Print na extensao\n');

// As URLs que TEM de estar presentes nas tres listas: a do usuario e a do
// espelho ativo hoje. Se o Print mudar de novo de endereco, acrescente aqui
// tambem -- e' o mesmo teste que vai lembrar da proxima vez.
const OBRIGATORIAS = [
  'https://audiprint.up.railway.app',
  'https://audi-print-production.up.railway.app',
];

caso('CRITERIO: background.js > ABAS_PRINT tem as duas URLs do Print', () => {
  const bloco = bg.match(/const ABAS_PRINT = \[([\s\S]*?)\];/);
  assert.ok(bloco, 'ABAS_PRINT nao encontrado em background.js');
  for (const url of OBRIGATORIAS) {
    assert.ok(bloco[1].includes(url), 'falta ' + url + ' em ABAS_PRINT');
  }
});

caso('CRITERIO: background.js > ORIGENS_PRINT_URL tem as duas URLs do Print', () => {
  const bloco = bg.match(/const ORIGENS_PRINT_URL = \[([\s\S]*?)\];/);
  assert.ok(bloco, 'ORIGENS_PRINT_URL nao encontrado em background.js');
  for (const url of OBRIGATORIAS) {
    assert.ok(bloco[1].includes(url), 'falta ' + url + ' em ORIGENS_PRINT_URL');
  }
});

caso('CRITERIO: content.js > ORIGENS_PRINT tem as duas URLs do Print', () => {
  const bloco = ct.match(/const ORIGENS_PRINT = \[([\s\S]*?)\];/);
  assert.ok(bloco, 'ORIGENS_PRINT nao encontrado em content.js');
  for (const url of OBRIGATORIAS) {
    assert.ok(bloco[1].includes(url), 'falta ' + url + ' em ORIGENS_PRINT');
  }
});

caso('as tres listas concordam entre si (mesmo numero de dominios Railway/http)', () => {
  const contarRailway = (txt, re) => (txt.match(re) || []).length;
  const nBg1 = contarRailway(bg.match(/const ABAS_PRINT = \[([\s\S]*?)\];/)[1], /railway\.app/g);
  const nBg2 = contarRailway(bg.match(/const ORIGENS_PRINT_URL = \[([\s\S]*?)\];/)[1], /railway\.app/g);
  const nCt = contarRailway(ct.match(/const ORIGENS_PRINT = \[([\s\S]*?)\];/)[1], /railway\.app/g);
  assert.strictEqual(nBg1, nBg2, 'ABAS_PRINT e ORIGENS_PRINT_URL divergem em quantidade de dominios');
  assert.strictEqual(nBg2, nCt, 'background.js e content.js divergem em quantidade de dominios');
});

console.log('\n' + n + ' casos, tudo certo\n');
