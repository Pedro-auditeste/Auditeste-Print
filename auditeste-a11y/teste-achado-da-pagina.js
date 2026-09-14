/* O achado tem de falar DESTA página, não só da regra.
 *
 *   node teste-achado-da-pagina.js
 *
 * Os três motores devolvem, por elemento: o seletor cru, o HTML do elemento e
 * o motivo específico da falha. O render descartava os três e montava título e
 * observação a partir do texto genérico da regra, igual em qualquer site. O
 * resultado era um laudo que servia para qualquer página, que é o mesmo que
 * não servir para nenhuma.
 *
 * As amostras abaixo são recortes REAIS, capturados da ponte local rodando
 * contra https://audi-print-production.up.railway.app/cofre.html. Inventar o
 * formato aqui seria testar a minha suposição, não o que o motor devolve.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PAGINA = path.join(__dirname, 'publico', 'index.html');
const fonte = fs.readFileSync(PAGINA, 'utf8');

let falhas = 0;
function caso(nome, fn) {
  try {
    fn();
    console.log('  ok   ' + nome);
  } catch (err) {
    falhas++;
    console.log('  FALHOU ' + nome + '\n         ' + err.message);
  }
}

/* Recorta do HTML as constantes e funções de verdade e roda o código real,
 * sem navegador. Stub aqui testaria o stub. Mesma ideia do extrair() de
 * teste-privacidade.js: fecho frouxo no fim porque o corpo tem chaves. */
function recortar() {
  const partes = [];
  for (const nome of ['GRAVIDADE', 'REGRAS_AXE_PT', 'REGRAS_LH_PT', 'REGRAS_PA11Y_PT']) {
    const re = new RegExp('\\n  const ' + nome + ' = \\{[\\s\\S]*?\\n  \\};');
    const m = re.exec(fonte);
    assert.ok(m, 'não achei a constante ' + nome);
    partes.push(m[0]);
  }
  for (const nome of ['limparHtml', 'pareceIngles', 'codigoSniffPa11y', 'traduzirPa11yMsg',
    'traduzirRegra', 'simplificarCodigoPa11y', 'simplificarSeletor', 'motivoLimpo',
    'humanizarAxe', 'humanizarPa11y', 'humanizarLighthouse']) {
    const re = new RegExp('\\n  function ' + nome + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}');
    const m = re.exec(fonte);
    assert.ok(m, 'não achei a função ' + nome);
    partes.push(m[0]);
  }
  return new Function(partes.join('\n')
    + '\nreturn { humanizarAxe, humanizarPa11y, humanizarLighthouse, motivoLimpo };')();
}

const P = recortar();

console.log('\nachado fala da pagina escaneada\n');

/* ---------- amostras reais ---------- */

const AXE_REGRA = {
  id: 'aria-allowed-role',
  impact: 'serious',
  help: 'A função ARIA deve ser apropriada para o elemento',
  description: "Certifique-se de que o atributo 'role' tem um valor apropriado para o elemento"
};
const AXE_NO = {
  target: ['#painelEntrar'],
  html: '<form id="painelEntrar" role="tabpanel">',
  failureSummary: "Corrija qualquer um dos itens a seguir:\n  O ARIA 'role' tabpanel não é permitido para o elemento dado"
};

const PA11Y_ISSUE = {
  code: 'WCAG2AA.Principle1.Guideline1_3.1_3_5.H98',
  type: 'error',
  message: 'Invalid autocomplete value: username. Element does not belong to Text control group.',
  selector: '#email',
  context: '<input type="email" id="email" autocomplete="username" required="">'
};

const LH_AUDIT = {
  id: 'html-has-lang',
  title: 'O elemento `<html>` não tem um atributo `[lang]`',
  description: 'Se uma página não especifica um atributo `lang`, o leitor de tela presume o idioma padrão.'
};
const LH_ITEM = {
  node: {
    selector: 'html',
    snippet: '<html>',
    explanation: 'Fix any of the following:\n  The <html> element does not have a lang attribute'
  }
};

/* ---------- o dado da pagina chega ---------- */

caso('axe: o seletor, o elemento e o motivo reais chegam no achado', () => {
  const a = P.humanizarAxe(AXE_REGRA, AXE_NO);
  assert.strictEqual(a.alvo, '#painelEntrar', 'seletor cru: ' + a.alvo);
  assert.ok(/painelEntrar/.test(a.html), 'o HTML do elemento nao veio: ' + a.html);
  assert.ok(/tabpanel/.test(a.porque), 'o motivo especifico nao veio: ' + a.porque);
});

caso('pa11y: context e a mensagem especifica sobrevivem ao mapa de regras', () => {
  const a = P.humanizarPa11y(PA11Y_ISSUE);
  assert.strictEqual(a.alvo, '#email', 'seletor: ' + a.alvo);
  assert.ok(/autocomplete="username"/.test(a.html), 'o elemento nao veio: ' + a.html);
  /* O mapa REGRAS_PA11Y_PT troca a mensagem por texto generico. Ela so
   * sobrevive porque passou a ser guardada em porque. */
  assert.ok(/Invalid autocomplete value/i.test(a.porque), 'a mensagem especifica sumiu: ' + a.porque);
});

caso('lighthouse: snippet e explanation chegam no achado', () => {
  const a = P.humanizarLighthouse(LH_AUDIT, LH_ITEM);
  assert.strictEqual(a.alvo, 'html', 'seletor: ' + a.alvo);
  assert.strictEqual(a.html, '<html>', 'snippet: ' + a.html);
  assert.ok(/does not have a lang attribute/i.test(a.porque), 'explanation sumiu: ' + a.porque);
});

/* ---------- o preambulo de lista e ruido, nao informacao ---------- */

caso('o preambulo "Corrija qualquer um dos itens" sai do motivo', () => {
  const a = P.humanizarAxe(AXE_REGRA, AXE_NO);
  assert.ok(!/Corrija qualquer um/i.test(a.porque), 'o preambulo ficou: ' + a.porque);
});

caso('o preambulo "Fix any of the following" sai do motivo', () => {
  const a = P.humanizarLighthouse(LH_AUDIT, LH_ITEM);
  assert.ok(!/Fix any of the following/i.test(a.porque), 'o preambulo ficou: ' + a.porque);
});

caso('motivo vazio ou ausente nao vira lixo', () => {
  assert.strictEqual(P.motivoLimpo(''), '');
  assert.strictEqual(P.motivoLimpo(null), '');
  assert.strictEqual(P.motivoLimpo(undefined), '');
  assert.strictEqual(P.motivoLimpo('Corrija qualquer um dos itens a seguir:'), '',
    'so o preambulo deveria sobrar vazio');
});

/* ---------- o defeito que originou tudo ---------- */

caso('CRITERIO: dois elementos da MESMA regra nao geram achado identico', () => {
  /* Este era o sintoma: "texto automatico". A mesma regra em dois elementos
   * produzia exatamente o mesmo par titulo/observacao, porque so o texto da
   * regra era usado. Se este caso voltar a falhar, o laudo voltou a servir
   * para qualquer pagina. */
  const um = P.humanizarAxe(AXE_REGRA, AXE_NO);
  const outro = P.humanizarAxe(AXE_REGRA, {
    target: ['#linkEsqueci'],
    html: '<a id="linkEsqueci" role="button">Esqueci</a>',
    failureSummary: "Corrija qualquer um dos itens a seguir:\n  O ARIA 'role' button nao e permitido para o elemento dado"
  });
  assert.notStrictEqual(um.alvo, outro.alvo, 'o seletor nao distingue os dois');
  assert.notStrictEqual(um.html, outro.html, 'o elemento nao distingue os dois');
  assert.notStrictEqual(JSON.stringify(um), JSON.stringify(outro),
    'dois elementos diferentes geraram o mesmo achado, palavra por palavra');
});

/* ---------- o achado tem de sobreviver ao salvar ---------- */

caso('CRITERIO: o achado usa os campos que o serializador grava', () => {
  /* Um <div> novo na tela sumiria ao salvar: o serializador grava uma lista
   * fixa de campos. Por isso o achado escreve em dataset.elemento e
   * dataset.html, que ja sao gravados, exportados e enviados ao cofre. */
  const ini = fonte.indexOf('achados.forEach(a => {');
  assert.ok(ini > 0, 'nao achei o render dos achados');
  const render = fonte.slice(ini, fonte.indexOf('});', ini));
  assert.ok(/dataset\.elemento/.test(render), 'o achado nao grava dataset.elemento: some ao salvar');
  assert.ok(/dataset\.html/.test(render), 'o achado nao grava dataset.html: some ao salvar');

  const s = fonte.indexOf('const dados = passos.map(p => ({');
  assert.ok(s > 0, 'nao achei o serializador');
  const bloco = fonte.slice(s, fonte.indexOf('}));', s));
  assert.ok(/elemento:/.test(bloco), 'o serializador parou de gravar elemento');
  assert.ok(/html:/.test(bloco), 'o serializador parou de gravar html');
});

console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (8 casos)\n');
process.exit(falhas ? 1 : 0);
