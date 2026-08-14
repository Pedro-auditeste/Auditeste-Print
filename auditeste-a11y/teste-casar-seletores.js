/* Checa o casamento entre o rótulo do print e os elementos da página, sem rede.
 *
 *   node teste-casar-seletores.js
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

const fnSemAcento = pegar(/  const semAcento = \(s\) =>[\s\S]*?\.toLowerCase\(\);/, 'semAcento');
const fnAchar = pegar(/  function acharElemento\(rotulo, elementos\)\{[\s\S]*?\n  \}/, 'acharElemento');
const fnRotulo = pegar(/  function rotuloDoPasso\(passo\)\{[\s\S]*?\n  \}/, 'rotuloDoPasso');

const api = new Function(
  fnSemAcento + '\n' + fnAchar + '\n' + fnRotulo
  + '\nreturn { acharElemento, rotuloDoPasso, semAcento };'
)();

const pagina = [
  { seletor: '#entrarSite', rotulo: 'Entrar', html: '<button id="entrarSite">Entrar</button>' },
  { seletor: '#buscaTopo', rotulo: 'Buscar produtos', html: '<input id="buscaTopo">' },
  { seletor: '[data-testid="cartao-tv"]', rotulo: 'Smart TV 50” 4K LG QNED', html: '<div>' },
  { seletor: '#cupom', rotulo: 'Cupom Saldão', html: '<a id="cupom">' },
  { seletor: '#semRotulo', rotulo: '', html: '<div id="semRotulo">' },
  { seletor: '/html[1]/body[1]/a[3]', rotulo: 'Frete Grátis', html: '<a>' }
];

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };
const sel = (rotulo) => { const e = api.acharElemento(rotulo, pagina); return e && e.seletor; };

console.log('--- casamento por rotulo ---');

caso('acerto exato', () => assert.strictEqual(sel('Entrar'), '#entrarSite'));
caso('ignora caixa alta', () => assert.strictEqual(sel('ENTRAR'), '#entrarSite'));
caso('ignora acento', () => assert.strictEqual(sel('Cupom Saldao'), '#cupom'));
caso('ignora espaço sobrando', () => assert.strictEqual(sel('  Entrar  '), '#entrarSite'));

caso('casa pelo começo quando o print encurtou', () => {
  assert.strictEqual(sel('Smart TV 50'), '[data-testid="cartao-tv"]');
});

caso('casa por trecho no meio', () => {
  assert.strictEqual(sel('Grátis'), '/html[1]/body[1]/a[3]');
});

caso('rótulo do print mais longo que o da página', () => {
  // A descrição costuma vir mais completa que o texto do botão.
  assert.strictEqual(sel('botão Entrar da tela inicial'), '#entrarSite');
});

caso('não casa com elemento sem rótulo', () => {
  assert.ok(!pagina.filter(e => !e.rotulo).some(e => e.seletor === sel('qualquer coisa aqui')));
});

caso('rótulo vazio ou curto demais não casa nada', () => {
  assert.strictEqual(api.acharElemento('', pagina), null);
  assert.strictEqual(api.acharElemento('a', pagina), null);
  assert.strictEqual(api.acharElemento('   ', pagina), null);
});

caso('rótulo que não existe devolve null', () => {
  assert.strictEqual(api.acharElemento('Finalizar compra', pagina), null);
});

console.log('--- rotulo tirado do passo ---');

/** Passo de mentira: só o que rotuloDoPasso usa. */
const passo = (titulo, rotulo) => ({
  dataset: rotulo ? { rotulo } : {},
  querySelector: (s) => s === '.titulo' ? { textContent: titulo } : null
});

caso('prefere o dataset.rotulo da extensão', () => {
  assert.strictEqual(api.rotuloDoPasso(passo('Clicou em "Outro"', 'Entrar')), 'Entrar');
});

caso('tira o texto entre aspas do título', () => {
  assert.strictEqual(api.rotuloDoPasso(passo('Clicou em "Entrar"')), 'Entrar');
});

caso('aceita aspas curvas da IA', () => {
  assert.strictEqual(api.rotuloDoPasso(passo('Clicou em “Buscar produtos”')), 'Buscar produtos');
});

caso('sem aspas, limpa o verbo do começo', () => {
  assert.strictEqual(api.rotuloDoPasso(passo('Clicou em Entrar')), 'Entrar');
  assert.strictEqual(api.rotuloDoPasso(passo('Entrou na tela Painel')), 'Painel');
});

caso('ponta a ponta: título do print acha o seletor', () => {
  assert.strictEqual(sel(api.rotuloDoPasso(passo('Clicou em "Cupom Saldao"'))), '#cupom');
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
