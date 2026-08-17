/* Checa os defeitos de texto da descricao do Print, sem rede.
 *
 *   node teste-texto-descricao.js
 */
const assert = require('assert');
const {
  juntarPassoAPasso,
  parseAnaliseQa,
  frase,
  semFraseIncompleta,
  alertaDeLados,
  localizadorValido
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

caso('troca "\\n" literal por quebra de verdade', () => {
  // Foi o que a NVIDIA devolveu de fato: o QA copiava o Gherkin com \n no meio.
  const g = comGherkin('Cenário: Entrar\\n Dado que estou no login\\n Quando clico\\n Então entro');
  assert.ok(g, 'o Gherkin com \\n literal foi descartado');
  assert.ok(!/\\n/.test(g), 'sobrou \\n literal: ' + g);
  assert.strictEqual(g.split('\n').length, 4, 'não virou 4 linhas: ' + JSON.stringify(g));
});

caso('legenda também não carrega "\\n" literal', () => {
  const r = parseAnaliseQa(JSON.stringify({
    legenda_curta: 'Entrou no login\\ne viu o formulário',
    descricao_detalhada: 'x'
  }));
  assert.ok(!/\\n/.test(r.legenda_curta), r.legenda_curta);
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

console.log('--- deteccao de print trocado ---');

caso('faixa lida certo não gera alerta', () => {
  assert.strictEqual(alertaDeLados({ rotulo_lido: '1 ANTES — onde clicou' }), '');
  assert.strictEqual(alertaDeLados({ rotulo_lido: 'ANTES' }), '');
});

caso('faixa ilegível avisa que a ordem não foi confirmada', () => {
  const a = alertaDeLados({ rotulo_lido: 'ilegível' });
  assert.match(a, /não deu para ler/i, a);
});

caso('leu o lado DEPOIS na esquerda: alerta de telas trocadas', () => {
  const a = alertaDeLados({ rotulo_lido: '2 DEPOIS — para onde entrou' });
  assert.match(a, /trocadas/i, a);
});

caso('campo ausente não inventa alerta', () => {
  assert.strictEqual(alertaDeLados({}), '');
  assert.strictEqual(alertaDeLados({ rotulo_lido: '   ' }), '');
});

caso('parseAnaliseQa carrega o rotulo_lido', () => {
  const r = parseAnaliseQa(JSON.stringify({
    legenda_curta: 'x', descricao_detalhada: 'y', rotulo_lido: '1 ANTES'
  }));
  assert.strictEqual(r.rotulo_lido, '1 ANTES');
});

console.log('--- localizador sugerido pela IA ---');

caso('aceita localizador por papel e texto', () => {
  assert.ok(localizadorValido("getByRole('button', { name: 'Comprar' })"));
  assert.ok(localizadorValido('getByLabel("E-mail")'));
  assert.ok(localizadorValido("getByPlaceholder('Buscar')"));
  assert.ok(localizadorValido("getByText('Ver mais')"));
});

caso('recusa seletor inventado, que a IA não pode saber', () => {
  // O id não está na imagem: se veio, foi invenção e quebraria o script do QA.
  const inventados = ['#btnComprar', '.btn-primary', '[data-testid="x"]',
    '//html/body/button', "document.querySelector('#x')", "getByRole('css=#btn')"];
  for (const mau of inventados) {
    assert.strictEqual(localizadorValido(mau), '', 'deixou passar: ' + mau);
  }
});

caso('texto com # continua valendo', () => {
  // "#1 mais vendido" é texto de tela, não seletor — recusar isso perderia
  // localizador bom.
  assert.ok(localizadorValido("getByRole('link', { name: '#1 mais vendido' })"));
});

caso('vazio não vira localizador', () => {
  assert.strictEqual(localizadorValido(''), '');
  assert.strictEqual(localizadorValido(null), '');
});

caso('parseAnaliseQa filtra o localizador inválido', () => {
  const bom = parseAnaliseQa(JSON.stringify({
    legenda_curta: 'x', descricao_detalhada: 'y',
    localizador: "getByRole('button', { name: 'Salvar' })"
  }));
  assert.match(bom.localizador, /getByRole/);

  const mau = parseAnaliseQa(JSON.stringify({
    legenda_curta: 'x', descricao_detalhada: 'y', localizador: '#salvar'
  }));
  assert.strictEqual(mau.localizador, '', 'deixou passar seletor inventado');
});

console.log('--- controles da tela ---');

const controles = (lista) => parseAnaliseQa(JSON.stringify({
  legenda_curta: 'x', descricao_detalhada: 'y', controles: lista
})).controles;

caso('lista os controles com localizador válido', () => {
  const r = controles([
    { rotulo: 'Continuar', tipo: 'botao', localizador: "getByRole('button', { name: 'Continuar' })" },
    { rotulo: 'Agora não', tipo: 'botao', localizador: "getByRole('button', { name: 'Agora não' })" },
    { rotulo: '+ 36 meses', tipo: 'opcao', localizador: "getByRole('radio', { name: '+ 36 meses' })" }
  ]);
  assert.strictEqual(r.length, 3, 'veio ' + r.length);
  assert.strictEqual(r[0].rotulo, 'Continuar');
  assert.strictEqual(r[2].tipo, 'opcao');
});

caso('descarta controle com seletor inventado', () => {
  const r = controles([
    { rotulo: 'Bom', tipo: 'botao', localizador: "getByRole('button', { name: 'Bom' })" },
    { rotulo: 'Ruim', tipo: 'botao', localizador: '#btn-ruim' },
    { rotulo: 'Pior', tipo: 'botao', localizador: '//html/body/button' }
  ]);
  assert.strictEqual(r.length, 1, 'passou seletor inventado: ' + JSON.stringify(r));
  assert.strictEqual(r[0].rotulo, 'Bom');
});

caso('não repete o mesmo rótulo', () => {
  // A tela tem itens parecidos e o modelo repete; duplicata só polui a lista.
  const um = "getByRole('button', { name: 'Continuar' })";
  const r = controles([
    { rotulo: 'Continuar', tipo: 'botao', localizador: um },
    { rotulo: 'continuar', tipo: 'botao', localizador: um },
    { rotulo: 'CONTINUAR', tipo: 'botao', localizador: um }
  ]);
  assert.strictEqual(r.length, 1, 'repetiu: ' + r.length);
});

caso('tipo desconhecido cai para botao', () => {
  const r = controles([
    { rotulo: 'X', tipo: 'coisa-estranha', localizador: "getByText('X')" }
  ]);
  assert.strictEqual(r[0].tipo, 'botao');
});

caso('corta em 12 para não virar lista infinita', () => {
  const muitos = Array.from({ length: 30 }, (_, i) => ({
    rotulo: 'Item ' + i, tipo: 'botao', localizador: "getByText('Item " + i + "')"
  }));
  assert.strictEqual(controles(muitos).length, 12);
});

caso('campo ausente ou inválido devolve lista vazia', () => {
  assert.deepStrictEqual(controles(undefined), []);
  assert.deepStrictEqual(controles('nao e lista'), []);
  assert.deepStrictEqual(controles([null, {}, { rotulo: 'só rótulo' }]), []);
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
