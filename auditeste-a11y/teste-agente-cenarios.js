/* Smoke do agente: parse de blocos + ausência de chave. Sem chamada de rede. */
const assert = require('assert');
const { extrairBlocos, gerarCenarios, parseDescricaoTela, montarCenariosDosPassos, juntarPassoAPasso } = require('./agente-cenarios.js');

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

const desc = parseDescricaoTela('Título: Clicou em "Entrar" no centro do formulário\nObservação: Estava na tela de login da loja. Clicou no botão Entrar no centro. Entrou na home logada com o menu no topo.');
assert.ok(desc.titulo.includes('Entrar'));
assert.ok(/login|loja/i.test(desc.obs));
assert.ok(desc.obs.length <= 220);
const nike = parseDescricaoTela('Título: Clicou no card "Tênis Nike Jordan Luka 4"\nObservação: Estava na listagem NBA Nike e clicou no tênis Jordan Luka 4 para abrir a página do produto com botão Comprar e opções de tamanho.');
assert.ok(/Nike|Jordan|Luka|tênis|tenis/i.test(nike.titulo + nike.obs));
assert.ok(!/PlayStation|PS5/i.test(nike.titulo + nike.obs));
const passo = juntarPassoAPasso(
  { titulo: 'Clicou no card "Tênis Nike Jordan Luka 4"', obs: 'Listagem NBA Nike, clicou no card do Luka 4.' },
  { titulo: 'Entrou na PDP do Tênis Nike Jordan Luka 4', obs: 'Página do produto com botão Comprar.' }
);
assert.ok(/Imagem 1:/i.test(passo.obs) && /Imagem 2:/i.test(passo.obs));
assert.ok(/Nike|Luka/i.test(passo.obs));
assert.ok(!/PlayStation|PS5/i.test(passo.titulo + passo.obs));
assert.ok(!/\w{20}$/.test(nike.obs) || /[.!?]$/.test(nike.obs) || /[a-záéíóúãõç]$/i.test(nike.obs));
let recusou = false;
try { parseDescricaoTela('I cannot help with that.'); } catch (e) { recusou = /recusa/i.test(e.message); }
assert.ok(recusou, 'recusa do modelo deve falhar o parse');

const bagunca = `===GHERKIN===
e
===MAPEAMENTO===
===GHERKIN===
# language: pt
# Feature: features/compras/compras.feature

Funcionalidade: Compras
  Como cliente
  Quero abrir o produto
  Para comprar

  @smoke @regressivo
  Cenário: [Compras][Produto] Abrir PDP da Smart TV - sucesso
    Quando eu clico no card "Smart TV 43' Philco"
    Então eu vejo o botão "Comprar"

===MAPEAMENTO===
Passo: 1
Elemento Web: card "Smart TV 43' Philco"
Ação: Clicar
Step: Quando eu clico no card "Smart TV 43' Philco"
`;
const consertado = extrairBlocos(bagunca);
assert.ok(consertado.cenarios.includes('Funcionalidade: Compras'));
assert.ok(!/^e\b/i.test(consertado.cenarios.trim()));
assert.ok(!consertado.mapeamento.includes('===GHERKIN==='));
assert.ok(consertado.mapeamento.includes('Ação: Clicar'));

const local = montarCenariosDosPassos({
  ficha: { modulo: 'Compras' },
  passos: [
    { titulo: 'Clicou em "Smart TV 43\' Philco" na grade Indicados', obs: 'Entrou na página do produto. Preço "R$ 1.449,90". Botão Comprar.' }
  ]
});
assert.ok(local.cenarios.includes('# language: pt'));
assert.ok(local.cenarios.includes('Quando eu clico em'));
assert.ok(!/The image|Clicked|product listing/i.test(local.cenarios + local.mapeamento));
assert.ok(local.mapeamento.includes('Ação: Clicar'));
assert.ok(local.mapeamento.includes('Passo: 1'));

let falhouSemChave = false;
const prev = process.env.AGENTE_API_KEY;
delete process.env.AGENTE_API_KEY;
gerarCenarios({ ficha: {}, passos: [{ titulo: 'x' }] })
  .then(() => { throw new Error('deveria falhar sem chave'); })
  .catch(err => {
    falhouSemChave = !!(err && err.semChave);
    assert.ok(falhouSemChave, 'erro semChave esperado');
    console.log('OK  extrairBlocos');
    console.log('OK  descrição curta + recusa rejeitada');
    console.log('OK  Gherkin "e" recuperado do mapeamento');
    console.log('OK  montarCenariosDosPassos em PT');
    console.log('OK  sem AGENTE_API_KEY → semChave');
    console.log('RESULTADO: PASSOU');
  })
  .finally(() => {
    if (prev !== undefined) process.env.AGENTE_API_KEY = prev;
  });
