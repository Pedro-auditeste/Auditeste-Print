const assert = require('assert');
const { montarSeletor, ePerigoso, montarCenariosDosPassos } = (() => {
  const ia = require('./teste-ia.js');
  const ag = require('./agente-cenarios.js');
  return { ...ia, montarCenariosDosPassos: ag.montarCenariosDosPassos };
})();

assert.strictEqual(montarSeletor({ id: 'entrar', tag: 'a' }), '#entrar');
assert.strictEqual(montarSeletor({ id: 'user-email' }), '#user-email');
assert.ok(montarSeletor({ name: 'q', tag: 'input' }).includes('name="q"'));
assert.ok(montarSeletor({ testid: 'cta-home' }).includes('data-testid'));
assert.ok(ePerigoso('Sair da conta'));
assert.ok(ePerigoso('Finalizar compra'));
assert.ok(!ePerigoso('Entrar'));
assert.ok(!ePerigoso('Ver produtos'));

const local = montarCenariosDosPassos({
  ficha: { modulo: 'Home' },
  passos: [
    { titulo: 'Acessou loja.exemplo', acao: 'Acessar', elemento: 'https://loja.exemplo', obs: 'Home' },
    { titulo: 'Clicou em "Entrar"', acao: 'Clicar', elemento: '#entrar', html: '<a id="entrar" href="/login">Entrar</a>', obs: 'Abriu login' }
  ]
});
assert.ok(local.mapeamento.includes('Elemento Web: #entrar'));
assert.ok(local.mapeamento.includes('Ação: Clicar'));
assert.ok(local.mapeamento.includes('Ação: Acessar'));
assert.ok(!/PlayStation|The image/i.test(local.cenarios + local.mapeamento));

console.log('OK  montarSeletor #id / name / testid');
console.log('OK  ePerigoso ignora logout/compra');
console.log('OK  mapeamento usa id inspecionado');
console.log('RESULTADO: PASSOU');
