/* Checa que o Gherkin sai das descricoes dos prints, sem rede.
 *
 *   node teste-cenarios-dos-textos.js
 */
const assert = require('assert');
const { montarCenariosDosPassos } = require('./agente-cenarios.js');

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

// Passos como o Print os manda depois de descrever cada par.
const passos = [
  {
    titulo: 'Clicou em "Entrar"',
    obs: 'Antes: tela inicial do site. Depois: formulário de acesso.',
    elemento: '#entrarSite',
    rotulo: 'Entrar'
  },
  {
    titulo: 'Preencheu o campo de login',
    obs: 'O usuário digitou o e-mail no campo.',
    elemento: '#email',
    valor: 'qa@auditeste.com'
  },
  {
    titulo: 'Entrou na tela "Painel"',
    obs: 'Depois: a tela mostra "Bem-vindo ao Painel" e os atalhos.',
    elemento: '#painel'
  }
];

const ficha = { modulo: 'Acesso' };

console.log('--- Gherkin montado das descricoes ---');

caso('usa as descrições e não fica vazio', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.ok(r.cenarios.length > 50, 'cenário curto demais: ' + r.cenarios);
  assert.ok(r.mapeamento.length > 30, 'mapeamento curto demais');
});

caso('sai em português com o cabeçalho da skill', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.match(r.cenarios, /^# language: pt/m);
  assert.match(r.cenarios, /Funcionalidade: Acesso/);
  assert.match(r.cenarios, /@smoke @regressivo/);
  assert.ok(!/\bGiven\b|\bWhen\b|\bThen\b/.test(r.cenarios), 'vazou Gherkin em inglês');
});

caso('infere a ação a partir do texto da descrição', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.match(r.mapeamento, /Ação: Clicar/, 'não inferiu Clicar de "Clicou em"');
  assert.match(r.mapeamento, /Ação: Preencher/, 'não inferiu Preencher de "Preencheu"');
  assert.match(r.mapeamento, /Ação: Acessar/, 'não inferiu Acessar de "Entrou na tela"');
});

caso('leva o seletor real para o mapeamento', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  for (const sel of ['#entrarSite', '#email', '#painel']) {
    assert.ok(r.mapeamento.includes(sel), 'perdeu o seletor ' + sel);
  }
});

caso('registra o Valor quando o passo preencheu algo', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.match(r.mapeamento, /Valor: qa@auditeste\.com/);
});

caso('fecha com um Então', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.match(r.cenarios, /Ent[aã]o/i, 'cenário sem Então: ' + r.cenarios);
});

caso('aproveita o texto entre aspas do último print', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.ok(/Bem-vindo ao Painel/.test(r.cenarios), 'ignorou o texto visível do último print');
});

caso('um passo só também gera cenário', () => {
  const r = montarCenariosDosPassos({ ficha, passos: [passos[0]] });
  assert.match(r.cenarios, /Funcionalidade:/);
  assert.match(r.cenarios, /Ent[aã]o/i);
});

caso('sem passos recusa como erro de pedido, não como falha da ponte', () => {
  assert.throws(
    () => montarCenariosDosPassos({ ficha, passos: [] }),
    (e) => e.pedidoInvalido === true,
    'deveria marcar pedidoInvalido para virar 400'
  );
});

caso('cenário usa o rótulo humano, não o seletor CSS', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.ok(!/eu clico em "#/.test(r.cenarios), 'seletor vazou no Gherkin: ' + r.cenarios);
  assert.match(r.cenarios, /eu clico em "Entrar"/, 'não usou o rótulo "Entrar"');
  assert.ok(!/Cenário:.*#entrarSite/.test(r.cenarios), 'seletor vazou no título do cenário');
});

caso('mapeamento continua com o seletor técnico', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  assert.match(r.mapeamento, /Elemento Web: #entrarSite/, 'o mapeamento perdeu o seletor');
});

caso('todos os passos ficam indentados igual', () => {
  const r = montarCenariosDosPassos({ ficha, passos });
  const steps = r.cenarios.split('\n').filter((l) => /^\s*(Dado|Quando|Então|Entao|E) /.test(l));
  assert.ok(steps.length >= 2, 'poucos passos para conferir: ' + steps.length);
  for (const l of steps) {
    assert.match(l, /^ {4}\S/, 'passo sem os 4 espaços: ' + JSON.stringify(l));
  }
});

caso('passo sem seletor não quebra e marca a confirmar', () => {
  const r = montarCenariosDosPassos({
    ficha,
    passos: [{ titulo: 'Clicou em "Comprar"', obs: 'abriu o carrinho' }]
  });
  assert.ok(r.mapeamento.includes('Comprar') || r.mapeamento.includes('(a confirmar)'), r.mapeamento);
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
