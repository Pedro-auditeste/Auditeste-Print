/* Checa os defeitos de texto da descricao do Print, sem rede.
 *
 *   node teste-texto-descricao.js
 */
const assert = require('assert');
const {
  juntarPassoAPasso,
  parseAnaliseQa,
  frase,
  semFraseIncompleta
} = require('./agente-cenarios.js');

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- frases nao emendam ao concatenar ---');

caso('põe ponto entre Antes e Depois', () => {
  const r = juntarPassoAPasso(
    { titulo: 'Tela "Home"', obs: 'Tela inicial do produto' },
    { titulo: 'Entrou em "Login"', obs: 'Formulário de acesso' },
    {}
  );
  assert.ok(!/produto Depois:/.test(r.obs), 'emendou sem ponto: ' + r.obs);
  assert.ok(/produto\. Depois:/.test(r.obs), 'faltou o ponto: ' + r.obs);
});

caso('não duplica ponto quando já existe', () => {
  const r = juntarPassoAPasso(
    { titulo: 'x', obs: 'Tela inicial do produto.' },
    { titulo: 'y', obs: 'Formulário de acesso.' },
    {}
  );
  assert.ok(!/\.\./.test(r.obs), 'ponto duplicado: ' + r.obs);
});

caso('separa a Ação dos dois lados', () => {
  const r = juntarPassoAPasso(
    { titulo: 'x', obs: 'Tela inicial' },
    { titulo: 'y', obs: 'Tela de login' },
    { rotulo: 'Entrar' }
  );
  assert.ok(/inicial\. Ação: clique em "Entrar"\. Depois:/.test(r.obs), r.obs);
});

console.log('--- Gherkin nao some calado ---');

const comGherkin = (g) => parseAnaliseQa(JSON.stringify({
  legenda_curta: 'x', descricao_detalhada: 'y', gherkin: g
})).gherkin;

caso('aceita a forma canônica', () => {
  assert.ok(comGherkin('Cenário: A\n  Dado que estou na home\n  Quando clico\n  Então vejo'));
});

caso('aceita "Dado" sem "que"', () => {
  assert.ok(comGherkin('Cenário: A\n  Dado o usuário logado\n  Quando clico\n  Então vejo'),
    'Gherkin foi descartado por falta do "que"');
});

caso('aceita "Entao" sem acento', () => {
  assert.ok(comGherkin('Cenário: A\n  Dado que estou na home\n  Quando clico\n  Entao vejo'),
    'Gherkin foi descartado por falta do acento');
});

caso('ainda recusa texto que não é Gherkin', () => {
  assert.strictEqual(comGherkin('Só uma frase solta sem passos.'), '');
});

console.log('--- corte de frase incompleta ---');

caso('corta a frase que parou no meio', () => {
  const r = semFraseIncompleta('O cliente abriu o menu. Em seguida o sistema most');
  assert.strictEqual(r, 'O cliente abriu o menu.');
});

caso('mantém texto que já termina certo', () => {
  const t = 'O cliente abriu o menu lateral.';
  assert.strictEqual(semFraseIncompleta(t), t);
});

caso('não apaga tudo quando não há frase fechada', () => {
  const t = 'O cliente abriu o menu lateral e most';
  assert.strictEqual(semFraseIncompleta(t), t);
});

caso('frase() fecha e não duplica', () => {
  assert.strictEqual(frase('abc'), 'abc.');
  assert.strictEqual(frase('abc.'), 'abc.');
  assert.strictEqual(frase(''), '');
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
