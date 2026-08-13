/* Smoke do agente: parse de blocos + ausência de chave. Sem chamada de rede. */
const assert = require('assert');
const { extrairBlocos, gerarCenarios, parseDescricaoTela } = require('./agente-cenarios.js');

const amostra = `===GHERKIN===
# language: pt
# Feature: features/login/login.feature
# Steps: features/steps/login/login_steps.py
# Page: pages/login/login_page.py

Funcionalidade: Login
  @smoke @login
  Cenário: [Login][Autenticacao] Entrar com credenciais validas - sucesso
    Dado que eu acesso a URL "https://app.exemplo.com/login"
    Quando eu preencho o campo "E-mail" com "qa@teste.com"
    E eu clico em "Entrar"
    Então eu vejo o texto "Maria Santos"

===MAPEAMENTO===
Passo: 1
Elemento Web: https://app.exemplo.com/login
Ação: Acessar
Step: Dado que eu acesso a URL "https://app.exemplo.com/login"

Passo: 2
Elemento Web: #email
Ação: Preencher
Valor: qa@teste.com
Step: Quando eu preencho o campo "E-mail" com "qa@teste.com"
`;

const { cenarios, mapeamento } = extrairBlocos(amostra);
assert.ok(cenarios.includes('# language: pt'));
assert.ok(cenarios.includes('[Login][Autenticacao]'));
assert.ok(mapeamento.includes('Ação: Preencher'));
assert.ok(mapeamento.includes('Step: Quando eu preencho'));
assert.ok(!cenarios.includes('===MAPEAMENTO==='));

const desc = parseDescricaoTela('Título: Preencheu o campo E-mail\nObservação: Formulário de login visível.');
assert.ok(desc.titulo.includes('E-mail'));
assert.ok(desc.obs.includes('login'));

let falhouSemChave = false;
const prev = process.env.AGENTE_API_KEY;
delete process.env.AGENTE_API_KEY;
gerarCenarios({ ficha: {}, passos: [{ titulo: 'x' }] })
  .then(() => { throw new Error('deveria falhar sem chave'); })
  .catch(err => {
    falhouSemChave = !!(err && err.semChave);
    assert.ok(falhouSemChave, 'erro semChave esperado');
    console.log('OK  extrairBlocos');
    console.log('OK  sem AGENTE_API_KEY → semChave');
    console.log('RESULTADO: PASSOU');
  })
  .finally(() => {
    if (prev !== undefined) process.env.AGENTE_API_KEY = prev;
  });
