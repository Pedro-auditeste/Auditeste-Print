/* O id real precisa aparecer no lugar do localizador sugerido.
 *
 *   node teste-mostra-id-real.js
 *
 * Foi o defeito relatado: o DOM era lido, o id vinha, e a tela continuava
 * mostrando só getByRole. Lê a lógica do index.html para não virar cópia.
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
  pegar(/  const esc = t => .*/, 'esc') + '\n'
  + pegar(/  function normalizarAnaliseQa\(dados\)\{[\s\S]*?\n  \}/, 'normalizarAnaliseQa') + '\n'
  + pegar(/  function htmlAnaliseQa\(a, indiceRegistro\)\{[\s\S]*?\n  \}/, 'htmlAnaliseQa') + '\n'
  + 'return { normalizarAnaliseQa, htmlAnaliseQa };'
)();

const render = (dados) => api.htmlAnaliseQa(api.normalizarAnaliseQa(dados));

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- elemento clicado ---');

caso('com id real, mostra o id do site', () => {
  const saida = render({
    legenda_curta: 'Clicou em Comprar',
    localizador: "getByRole('button', { name: 'Comprar' })",
    elemento: '#btn-comprar-agora',
    html: '<button id="btn-comprar-agora">Comprar</button>'
  });
  assert.match(saida, /Elemento no site/, 'não anunciou o elemento real');
  assert.match(saida, /#btn-comprar-agora/, 'o id do site não apareceu');
  assert.match(saida, /lido do HTML da página/, 'faltou dizer de onde veio');
});

caso('com id real, o localizador vira alternativo', () => {
  const saida = render({
    legenda_curta: 'x',
    localizador: "getByRole('button', { name: 'Comprar' })",
    elemento: '#btn-comprar-agora'
  });
  assert.match(saida, /Localizador alternativo/, 'continuou chamando de sugerido');
  assert.match(saida, /getByRole/, 'perdeu o localizador por texto');
});

caso('sem id real, segue como sugestão', () => {
  const saida = render({
    legenda_curta: 'x',
    localizador: "getByRole('button', { name: 'Comprar' })"
  });
  assert.match(saida, /Localizador sugerido/, 'deveria continuar sugerido');
  assert.ok(!/Elemento no site/.test(saida), 'inventou elemento real sem ter');
});

console.log('--- tabela de controles ---');

caso('mostra o id do site quando o controle tem', () => {
  const saida = render({
    legenda_curta: 'x',
    controles: [
      { rotulo: 'Comprar', tipo: 'botao', localizador: "getByRole('button', { name: 'Comprar' })",
        elemento: '#btn-comprar-agora' },
      { rotulo: 'Ver mais', tipo: 'link', localizador: "getByRole('link', { name: 'Ver mais' })" }
    ]
  });
  assert.match(saida, /#btn-comprar-agora/, 'id do controle não apareceu');
  assert.match(saida, /id do site/, 'faltou marcar qual é real');
  // O que não tem id real continua mostrando o localizador por texto.
  assert.match(saida, /getByRole\('link'/, 'perdeu o controle sem id');
});

caso('sem id, a tabela usa o localizador por texto', () => {
  const saida = render({
    legenda_curta: 'x',
    controles: [{ rotulo: 'Buscar', tipo: 'campo', localizador: "getByPlaceholder('Buscar')" }]
  });
  assert.match(saida, /getByPlaceholder/, 'não mostrou o localizador');
  assert.ok(!/id do site/.test(saida), 'marcou como real sem ser');
});

console.log('--- escape ---');

caso('HTML do site não vira marcação na tela', () => {
  const saida = render({
    legenda_curta: 'x',
    elemento: '#btn',
    controles: [{ rotulo: '<img src=x onerror=alert(1)>', tipo: 'botao',
      localizador: "getByText('x')", elemento: '#y' }]
  });
  assert.ok(!/<img src=x/.test(saida), 'rótulo entrou como marcação: escape falhou');
  assert.match(saida, /&lt;img/, 'não escapou o rótulo');
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
