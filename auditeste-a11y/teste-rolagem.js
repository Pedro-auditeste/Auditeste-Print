/* Checa que rolagem não vira print, e que tela nova continua virando.
 *
 *   node teste-rolagem.js
 *
 * Lê a lógica direto do index.html para não virar cópia que envelhece.
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
  pegar(/  const MINI_L = 160, MINI_A = 90;/, 'as constantes') + '\n'
  + pegar(/  function diffDeslocado\(a, b, dy\)\{[\s\S]*?\n  \}/, 'diffDeslocado') + '\n'
  + pegar(/  function pareceRolagem\(atual, base\)\{[\s\S]*?\n  \}/, 'pareceRolagem') + '\n'
  + 'return { diffDeslocado, pareceRolagem, MINI_L, MINI_A };'
)();

const { MINI_L, MINI_A } = api;

/** Tela de mentira: faixas horizontais com cor derivada da linha do conteúdo. */
function tela(deslocamento, semente) {
  const px = new Uint8ClampedArray(MINI_L * MINI_A * 4);
  for (let y = 0; y < MINI_A; y++) {
    const linhaConteudo = y + deslocamento;
    // Faixas de 6 px bem distintas: é o que dá textura para o diff enxergar.
    const faixa = Math.floor(linhaConteudo / 6);
    const base = ((faixa * 53 + semente * 97) % 200) + 30;
    for (let x = 0; x < MINI_L; x++) {
      const i = (y * MINI_L + x) * 4;
      px[i] = base;
      px[i + 1] = (base * 2 + x) % 255;
      px[i + 2] = (base * 3 + faixa * 11) % 255;
      px[i + 3] = 255;
    }
  }
  return px;
}

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- rolagem nao vira print ---');

caso('rolou 12 linhas: reconhece como rolagem', () => {
  assert.strictEqual(api.pareceRolagem(tela(12, 1), tela(0, 1)), true);
});

caso('rolou para cima também', () => {
  assert.strictEqual(api.pareceRolagem(tela(-16, 1), tela(0, 1)), true);
});

caso('rolagem longa, perto do limite', () => {
  assert.strictEqual(api.pareceRolagem(tela(40, 1), tela(0, 1)), true);
});

console.log('--- tela nova continua virando print ---');

caso('conteúdo totalmente diferente não é rolagem', () => {
  assert.strictEqual(api.pareceRolagem(tela(0, 7), tela(0, 1)), false);
});

caso('tela parada não é rolagem', () => {
  assert.strictEqual(api.pareceRolagem(tela(0, 1), tela(0, 1)), false);
});

caso('mudança pequena não é rolagem', () => {
  const a = tela(0, 1);
  const b = tela(0, 1);
  // Mexe num cantinho: menos que o piso de 12%.
  for (let i = 0; i < 200 * 4; i += 4) { b[i] = 255; b[i + 1] = 0; b[i + 2] = 0; }
  assert.strictEqual(api.pareceRolagem(a, b), false);
});

console.log('--- diffDeslocado ---');

caso('deslocamento certo zera a diferença', () => {
  // compara a[y] com b[y+dy]: casar tela(12) com tela(0) pede dy = +12.
  assert.strictEqual(api.diffDeslocado(tela(12, 1), tela(0, 1), 12), 0);
});

caso('sem deslocar, a diferença é grande', () => {
  assert.ok(api.diffDeslocado(tela(12, 1), tela(0, 1), 0) > 30);
});

caso('entrada inválida devolve o pior caso', () => {
  assert.strictEqual(api.diffDeslocado(null, tela(0, 1), 0), 100);
  assert.strictEqual(api.diffDeslocado(tela(0, 1), null, 0), 100);
});

caso('não estoura o array em deslocamento grande', () => {
  const d = api.diffDeslocado(tela(0, 1), tela(0, 1), 89);
  assert.ok(Number.isFinite(d), 'devolveu ' + d);
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
