/* Confere que todo COPY do Dockerfile acha o alvo no contexto de build.
 *
 *   node teste-docker.js
 *
 * Um COPY apontando para caminho bloqueado pelo .dockerignore quebra o build
 * calado: a Railway falha e continua servindo a versao velha, entao parece que
 * o commit "nao fez efeito". Foi exatamente o que aconteceu com a pasta da
 * extensao, que estava no .dockerignore.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function regras() {
  const arq = path.join(RAIZ, '.dockerignore');
  if (!fs.existsSync(arq)) return { bloqueia: [], nega: [] };
  const linhas = fs.readFileSync(arq, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return {
    bloqueia: linhas.filter((l) => !l.startsWith('!')),
    nega: linhas.filter((l) => l.startsWith('!')).map((l) => l.slice(1))
  };
}

function ignorado(caminho, { bloqueia, nega }) {
  const bate = (padrao) => caminho === padrao
    || caminho.startsWith(padrao + '/')
    || (padrao.startsWith('*.') && caminho.endsWith(padrao.slice(1)));
  if (nega.some(bate)) return false;
  return bloqueia.some(bate);
}

/** Origens de cada COPY, ignorando o destino. */
function origensDosCopy(dockerfile) {
  return [...fs.readFileSync(dockerfile, 'utf8').matchAll(/^COPY\s+(.+)$/gm)]
    .map((m) => m[1].trim().split(/\s+/).slice(0, -1))
    .flat()
    .filter((o) => !o.startsWith('--'));
}

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

console.log('--- Dockerfile da raiz ---');

const r = regras();
const origens = origensDosCopy(path.join(RAIZ, 'Dockerfile'));

caso('a pasta da extensão entra na imagem', () => {
  // Sem ela, /extensao.zip existe e o arquivo não.
  assert.ok(origens.includes('audi-print-scanner'), 'a extensão não é copiada');
  assert.ok(!ignorado('audi-print-scanner', r), '.dockerignore bloqueia a extensão');
  assert.ok(fs.existsSync(path.join(RAIZ, 'audi-print-scanner', 'manifest.json')), 'sem manifest.json');
});

caso('há COPY para conferir', () => {
  assert.ok(origens.length >= 3, 'poucos COPY encontrados: ' + origens.length);
});

caso('todo COPY aponta para caminho existente', () => {
  const faltando = origens.filter((o) => !fs.existsSync(path.join(RAIZ, o)));
  assert.deepStrictEqual(faltando, [], 'COPY sem alvo: ' + faltando.join(', '));
});

caso('nenhum COPY é bloqueado pelo .dockerignore', () => {
  const bloqueados = origens.filter((o) => ignorado(o, r));
  assert.deepStrictEqual(bloqueados, [],
    'o .dockerignore bloqueia: ' + bloqueados.join(', ') + ' — o build vai falhar');
});

caso('o que servidor.js requer está entre os COPY', () => {
  const copiados = new Set(origens.map((o) => path.basename(o)));
  const src = fs.readFileSync(path.join(__dirname, 'servidor.js'), 'utf8');
  const locais = [...src.matchAll(/require\('\.\/([^']+)'\)/g)].map((m) => m[1]);
  const fora = locais.filter((f) => !copiados.has(f));
  assert.deepStrictEqual(fora, [], 'servidor.js requer, mas o Dockerfile não copia: ' + fora.join(', '));
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
