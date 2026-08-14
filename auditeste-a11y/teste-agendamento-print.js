/* Checa o agendamento do print "depois" da extensao, sem Chrome.
 *
 *   node teste-agendamento-print.js
 *
 * Le a logica direto de audi-print-scanner/background.js para o teste nao
 * virar uma copia que envelhece sozinha.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(
  path.join(__dirname, '..', 'audi-print-scanner', 'background.js'), 'utf8'
);

function trecho(re, nome) {
  const m = re.exec(fonte);
  assert.ok(m, 'não achei ' + nome + ' em background.js');
  return m[0];
}

const consts = trecho(/const ESPERA_DEPOIS_MS[\s\S]*?const INTERVALO_PRINT_MS = \d+;/, 'as constantes');
const fnAgendar = trecho(/function agendarFinalizacao\(tabId\) \{[\s\S]*?\n\}/, 'agendarFinalizacao');

/** Monta o agendador com relógio e timers falsos. */
function montar() {
  let agora = 0;
  let agendado = null;
  const timers = new Map();
  const prazos = new Map();
  const limparTimer = (id) => { timers.delete(id); agendado = null; };
  const setTimeout = (fn, ms) => { agendado = ms; return { fn, ms }; };
  const Date = { now: () => agora };
  const finalizar = () => {};
  const agendar = new Function(
    'timers', 'prazos', 'limparTimer', 'setTimeout', 'Date', 'finalizar',
    consts + '\n' + fnAgendar + '\nreturn agendarFinalizacao;'
  )(timers, prazos, limparTimer, setTimeout, Date, finalizar);
  return {
    agendar,
    prazos,
    avancar: (ms) => { agora += ms; },
    espera: () => agendado
  };
}

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- agendamento do print "depois" ---');

caso('primeiro evento espera os 900 ms', () => {
  const t = montar();
  t.agendar(1);
  assert.strictEqual(t.espera(), 900);
});

caso('cada evento novo adia de novo em 900 ms', () => {
  const t = montar();
  t.agendar(1);
  t.avancar(800);
  t.agendar(1);
  assert.strictEqual(t.espera(), 900, 'deveria reiniciar a espera');
});

caso('o teto de 8 s corta a espera perto do fim', () => {
  const t = montar();
  t.agendar(1);
  t.avancar(7500);
  t.agendar(1);
  assert.strictEqual(t.espera(), 500, 'deveria sobrar só o resto do prazo');
});

caso('passado o teto, dispara na hora e nunca negativo', () => {
  const t = montar();
  t.agendar(1);
  t.avancar(9000);
  t.agendar(1);
  assert.strictEqual(t.espera(), 0);
});

caso('página que nunca para não adia para sempre', () => {
  const t = montar();
  t.agendar(1);
  let total = 0;
  for (let i = 0; i < 60; i++) { t.avancar(300); total += 300; t.agendar(1); }
  assert.ok(total >= 8000, 'o teste precisa passar do teto');
  assert.strictEqual(t.espera(), 0, 'ficou adiando além do teto');
});

caso('prazo é por aba, não global', () => {
  const t = montar();
  t.agendar(1);
  t.avancar(7900);
  t.agendar(2);
  assert.strictEqual(t.espera(), 900, 'a aba 2 herdou o prazo da aba 1');
});

caso('limpar o prazo reinicia o teto do próximo passo', () => {
  const t = montar();
  t.agendar(1);
  t.avancar(7900);
  t.prazos.delete(1); // é o que finalizar() faz ao fechar o passo
  t.agendar(1);
  assert.strictEqual(t.espera(), 900);
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
