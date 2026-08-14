/* Checa a marca vermelha do print "antes", sem Chrome.
 *
 *   node teste-marca-vermelha.js
 *
 * Le a logica direto de audi-print-scanner/content.js para nao virar copia.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(
  path.join(__dirname, '..', 'audi-print-scanner', 'content.js'), 'utf8'
);

function trecho(re, nome) {
  const m = re.exec(fonte);
  assert.ok(m, 'não achei ' + nome + ' em content.js');
  return m[0];
}

const consts = trecho(/const MARCA_MAX_MS = \d+;/, 'MARCA_MAX_MS');
const fnDestacar = trecho(/function destacar\(el\) \{[\s\S]*?\n  \}/, 'destacar');
const fnSegurar = trecho(/function segurarAte\(tirar, promessa\) \{[\s\S]*?\n  \}/, 'segurarAte');

/** Monta as funcoes com timers controlados na mao. */
function montar() {
  const pendentes = new Map();
  let proximo = 1;
  const setTimeout = (fn, ms) => { const id = proximo++; pendentes.set(id, { fn, ms }); return id; };
  const clearTimeout = (id) => pendentes.delete(id);
  const api = new Function(
    'setTimeout', 'clearTimeout',
    consts + '\n' + fnDestacar + '\n' + fnSegurar + '\nreturn { destacar, segurarAte };'
  )(setTimeout, clearTimeout);
  return {
    ...api,
    prazoDe: () => [...pendentes.values()].map((t) => t.ms)[0],
    dispararRede: () => { const t = [...pendentes.values()][0]; if (t) t.fn(); },
    pendentes
  };
}

/** Elemento falso: so o style interessa. */
const elemento = (outlineInicial = '') => ({ style: { outline: outlineInicial, outlineOffset: '' } });

const espera = () => new Promise((r) => setImmediate(r));

let n = 0;
const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

caso('marca em vermelho na hora', () => {
  const t = montar();
  const el = elemento();
  t.destacar(el);
  assert.match(el.style.outline, /#e23c3c/, 'não ficou vermelho: ' + el.style.outline);
  assert.strictEqual(el.style.outlineOffset, '3px');
});

caso('a marca só sai quando o print termina', async () => {
  const t = montar();
  const el = elemento();
  let concluir;
  const print = new Promise((r) => { concluir = r; });
  t.segurarAte(t.destacar(el), print);

  await espera();
  assert.match(el.style.outline, /#e23c3c/, 'a marca saiu antes do print');

  concluir({ ok: true });
  await espera();
  assert.strictEqual(el.style.outline, '', 'a marca ficou presa depois do print');
});

caso('devolve o outline que já existia, não apaga o do site', async () => {
  const t = montar();
  const el = elemento('2px dashed blue');
  let concluir;
  t.segurarAte(t.destacar(el), new Promise((r) => { concluir = r; }));
  concluir();
  await espera();
  assert.strictEqual(el.style.outline, '2px dashed blue', 'perdeu o outline original');
});

caso('rede de segurança tira a marca se o print nunca vier', () => {
  const t = montar();
  const el = elemento();
  t.segurarAte(t.destacar(el), new Promise(() => {})); // nunca resolve
  assert.match(el.style.outline, /#e23c3c/);
  assert.strictEqual(t.prazoDe(), 4000, 'a rede não é de 4 s');
  t.dispararRede();
  assert.strictEqual(el.style.outline, '', 'a marca ficou presa na tela para sempre');
});

caso('print que falha também tira a marca', async () => {
  const t = montar();
  const el = elemento();
  t.segurarAte(t.destacar(el), Promise.reject(new Error('background dormiu')));
  await espera();
  assert.strictEqual(el.style.outline, '', 'a marca ficou presa após falha');
});

caso('não limpa duas vezes nem cancela o timer à toa', async () => {
  const t = montar();
  const el = elemento('1px solid red');
  const limpar = t.segurarAte(t.destacar(el), Promise.resolve());
  await espera();
  assert.strictEqual(el.style.outline, '1px solid red');
  el.style.outline = 'mexido depois';
  limpar();           // chamada extra não deve reverter de novo
  t.dispararRede();   // rede atrasada também não
  assert.strictEqual(el.style.outline, 'mexido depois', 'limpou duas vezes');
  assert.strictEqual(t.pendentes.size, 0, 'não cancelou a rede de segurança');
});

caso('elemento que saiu da página não derruba a extensão', async () => {
  const t = montar();
  const morto = { get style() { throw new Error('elemento removido'); } };
  t.segurarAte(() => { throw new Error('elemento removido'); }, Promise.resolve());
  await espera();
  void morto;
});

(async () => {
  for (const [nome, fn] of casos) { await fn(); n++; console.log('  OK   ' + nome); }
  console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
})().catch((e) => { console.error('  FALHA  ' + e.message); process.exit(1); });
