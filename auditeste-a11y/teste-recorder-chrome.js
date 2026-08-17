/* Importa a gravação do DevTools do Chrome, sem rede.
 *
 *   node teste-recorder-chrome.js
 *
 * Lê a lógica direto do index.html para o teste não virar cópia que envelhece.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
const pegar = (re, nome) => {
  const m = re.exec(html);
  assert.ok(m, 'não achei ' + nome + ' no index.html');
  return m[0];
};

const api = new Function(
  pegar(/  function ehRecorderChrome\(b\)\{[\s\S]*?\n  \}/, 'ehRecorderChrome') + '\n'
  + pegar(/  function seletoresPlanos\(lista\)\{[\s\S]*?\n  \}/, 'seletoresPlanos') + '\n'
  + pegar(/  function melhorSeletorRecorder\(lista\)\{[\s\S]*?\n  \}/, 'melhorSeletorRecorder') + '\n'
  + pegar(/  function rotuloRecorder\(lista\)\{[\s\S]*?\n  \}/, 'rotuloRecorder') + '\n'
  + pegar(/  const ACOES_RECORDER = \{[^}]*\};/, 'ACOES_RECORDER') + '\n'
  + pegar(/  function passosDoRecorder\(bruto\)\{[\s\S]*?\n  \}/, 'passosDoRecorder') + '\n'
  + 'return { ehRecorderChrome, melhorSeletorRecorder, rotuloRecorder, passosDoRecorder };'
)();

const exemplo = JSON.parse(fs.readFileSync(path.join(__dirname, 'exemplo-recorder.json'), 'utf8'));

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- reconhecimento do formato ---');

caso('reconhece a gravação do Chrome', () => {
  assert.strictEqual(api.ehRecorderChrome(exemplo), true);
});

caso('não confunde com o JSON da extensão', () => {
  assert.strictEqual(api.ehRecorderChrome({ formato: 'audi-print-evidencia-v1', passos: [] }), false);
  assert.strictEqual(api.ehRecorderChrome({ violations: [] }), false);
  assert.strictEqual(api.ehRecorderChrome(null), false);
});

console.log('--- escolha do seletor ---');

const sel = (l) => api.melhorSeletorRecorder(l);

caso('prefere #id a xpath', () => {
  assert.strictEqual(sel([['#entrar'], ['xpath///*[@id="entrar"]'], ['text/Entrar']]), '#entrar');
});

caso('prefere data-testid a xpath', () => {
  assert.strictEqual(sel([['[data-testid="card"]'], ['xpath///x'], ['text/Card']]), '[data-testid="card"]');
});

caso('usa css comum quando não há id nem data-*', () => {
  assert.strictEqual(sel([['button.btn-comprar'], ['xpath///x']]), 'button.btn-comprar');
});

caso('cai no xpath só quando não há css, e tira o prefixo', () => {
  assert.strictEqual(sel([['xpath///html/body/button'], ['text/Comprar']]), '//html/body/button');
});

caso('lista vazia não quebra', () => {
  assert.strictEqual(sel([]), '');
  assert.strictEqual(sel(null), '');
});

console.log('--- rótulo ---');

caso('tira o rótulo do text/', () => {
  assert.strictEqual(api.rotuloRecorder([['#x'], ['text/Comprar agora']]), 'Comprar agora');
});

caso('usa aria/ quando não há text/', () => {
  assert.strictEqual(api.rotuloRecorder([['#x'], ['aria/Pesquisar']]), 'Pesquisar');
});

console.log('--- conversão dos passos ---');

const passos = api.passosDoRecorder(exemplo);

caso('ignora setViewport, scroll e teclas', () => {
  // 9 steps no arquivo; viram 5 passos: navigate + 2 click + change + click.
  assert.strictEqual(passos.length, 5, 'passos: ' + passos.map((p) => p.acao).join(','));
});

caso('primeira navegação vira o passo de acesso', () => {
  assert.strictEqual(passos[0].acao, 'Acessar');
  assert.match(passos[0].elemento, /casasbahia\.com\.br/);
});

caso('clique traz seletor e rótulo', () => {
  const p = passos[1];
  assert.strictEqual(p.acao, 'Clicar');
  assert.strictEqual(p.elemento, '#search-input');
  assert.strictEqual(p.rotulo, 'Pesquisar');
});

caso('change vira Preencher com o valor', () => {
  const p = passos[2];
  assert.strictEqual(p.acao, 'Preencher');
  assert.strictEqual(p.valor, 'geladeira');
  assert.match(p.titulo, /geladeira/);
});

caso('navegação depois do clique preenche urlDepois', () => {
  const card = passos.find((p) => p.elemento.includes('card-produto-1'));
  assert.ok(card, 'não achei o passo do card');
  assert.match(card.urlDepois, /\/p\/55069668/, 'urlDepois: ' + card.urlDepois);
  assert.notStrictEqual(card.urlAntes, card.urlDepois, 'antes e depois iguais');
});

caso('passo seguinte herda a URL do destino', () => {
  const comprar = passos[passos.length - 1];
  assert.strictEqual(comprar.elemento, 'button.btn-comprar');
  assert.match(comprar.urlAntes, /\/p\/55069668/, 'urlAntes: ' + comprar.urlAntes);
});

caso('todo passo sai com os campos que o Print monta', () => {
  for (const p of passos) {
    for (const campo of ['titulo', 'obs', 'acao', 'elemento', 'urlAntes', 'urlDepois']) {
      assert.ok(campo in p, 'faltou ' + campo + ' em ' + p.titulo);
    }
    assert.ok(Array.isArray(p.imagens), 'imagens não é lista');
  }
});

caso('gravação sem clique devolve nada, em vez de passo vazio', () => {
  const so = { title: 'x', steps: [{ type: 'setViewport' }, { type: 'scroll', y: 10 }] };
  assert.strictEqual(api.passosDoRecorder(so).length, 0);
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
