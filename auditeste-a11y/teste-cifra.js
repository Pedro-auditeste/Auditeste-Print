/* Cifra do conteúdo da evidência em repouso.
 *
 * O que importa aqui não é "a função roda". É: abrindo o arquivo do banco
 * com um editor, o print aparece? A primeira versão deste teste procurava o
 * texto só no .db e dizia que estava tudo cifrado quando na verdade o dado
 * ainda estava no -wal, em claro. Por isso todo caso aqui faz checkpoint e
 * varre os três arquivos.
 *
 *   node teste-cifra.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const banco = require('./cofre/banco.js');

let falhas = 0, feitos = 0;

function caso(nome, fn) {
  try {
    fn();
    feitos++;
    console.log('  ok     ' + nome);
  } catch (err) {
    falhas++;
    console.log('  FALHOU ' + nome);
    console.log('           ' + String(err && err.message).split('\n')[0]);
  }
}

const SEGREDO = Buffer.from('CPF 529.982.247-25 do cliente, no print da tela');

/* Varre .db, -wal e -shm. Procurar so no .db foi como a primeira versao
 * deste teste passou sem provar nada. */
function apareceEmDisco(arquivo, agulha) {
  banco.abrir(arquivo).exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const sufixo of ['', '-wal', '-shm']) {
    const alvo = arquivo + sufixo;
    if (!fs.existsSync(alvo)) continue;
    if (fs.readFileSync(alvo).includes(agulha)) return true;
  }
  return false;
}

function semear(arquivo) {
  banco.abrir(arquivo);
  const t = banco.criarTenant('Cliente', 90);
  const u = banco.criarUsuario('qa-' + crypto.randomUUID() + '@teste.com', 'x');
  const p = banco.criarProjeto(t.id, u.id, 'Projeto');
  const x = banco.criarExecucao(t.id, u.id, p.id, 'Execucao');
  const e = banco.criarEvidencia(t.id, u.id, x.id, {}, 90);
  return { t, e };
}

console.log('\ncifra do conteudo em repouso\n');

/* ---------- sem chave ---------- */
const pastaA = fs.mkdtempSync(path.join(os.tmpdir(), 'cifra-a-'));
const semChave = path.join(pastaA, 'cofre.db');
delete process.env.COFRE_CHAVE;

let semanteA;
caso('sem COFRE_CHAVE o cofre funciona, e grava em claro', () => {
  semanteA = semear(semChave);
  banco.anexar(semanteA.t.id, semanteA.e.id, 'depois', 'image/png', SEGREDO);
  assert.strictEqual(banco.cifraLigada(), false);
  assert.strictEqual(apareceEmDisco(semChave, SEGREDO), true,
    'o teste precisa conseguir ACHAR o texto em claro, senão ele não prova nada depois');
});
banco.fechar();

/* ---------- com chave ---------- */
const pastaB = fs.mkdtempSync(path.join(os.tmpdir(), 'cifra-b-'));
const comChave = path.join(pastaB, 'cofre.db');
process.env.COFRE_CHAVE = crypto.randomBytes(32).toString('hex');

let semanteB, objeto;
caso('CRITERIO: com a chave, o print nao aparece no arquivo do banco', () => {
  semanteB = semear(comChave);
  objeto = banco.anexar(semanteB.t.id, semanteB.e.id, 'depois', 'image/png', SEGREDO);
  assert.strictEqual(banco.cifraLigada(), true);
  assert.strictEqual(apareceEmDisco(comChave, SEGREDO), false,
    'o conteúdo do print está legível dentro do arquivo');
});

caso('CRITERIO: e volta byte a byte pela aplicacao', () => {
  const lido = banco.obterObjeto(semanteB.t.id, objeto.id);
  assert.ok(Buffer.from(lido.dados).equals(SEGREDO), 'voltou diferente do que entrou');
});

caso('o sha256 guardado e o do conteudo original, nao o do cifrado', () => {
  const esperado = crypto.createHash('sha256').update(SEGREDO).digest('hex');
  const meta = banco.objetosDe(semanteB.t.id, semanteB.e.id).find(o => o.id === objeto.id);
  assert.strictEqual(meta.sha256, esperado,
    'sem isso não dá para conferir que o print voltou igual depois de um restore');
  assert.strictEqual(meta.bytes, SEGREDO.length);
});

caso('CRITERIO: conteudo adulterado no arquivo nao passa por bom', () => {
  const db = banco.abrir(comChave);
  const bruto = Buffer.from(db.prepare('SELECT dados FROM objetos WHERE id = ?').get(objeto.id).dados);
  /* Vira um byte no meio do corpo cifrado. Sem autenticação isso devolveria
   * lixo silenciosamente, e um print alterado é pior que um print perdido. */
  bruto[bruto.length - 3] = bruto[bruto.length - 3] ^ 0xff;
  db.prepare('UPDATE objetos SET dados = ? WHERE id = ?').run(bruto, objeto.id);
  assert.throws(() => banco.obterObjeto(semanteB.t.id, objeto.id),
    /unable to authenticate|auth/i,
    'aceitou conteúdo adulterado');
});

caso('sem a chave, o que esta cifrado recusa em vez de devolver lixo', () => {
  const bom = banco.anexar(semanteB.t.id, semanteB.e.id, 'antes', 'image/png', SEGREDO);
  const guardada = process.env.COFRE_CHAVE;
  delete process.env.COFRE_CHAVE;
  try {
    assert.throws(() => banco.obterObjeto(semanteB.t.id, bom.id), /COFRE_CHAVE/,
      'sem a chave deveria dizer que falta a chave');
  } finally {
    process.env.COFRE_CHAVE = guardada;
  }
});

caso('ligar a chave depois nao cega o que ja estava gravado em claro', () => {
  /* Cenário real: o cofre rodou um tempo sem chave, e alguém liga agora.
   * Se o antigo parasse de abrir, ligar a cifra apagaria o passado. */
  const guardada = process.env.COFRE_CHAVE;
  delete process.env.COFRE_CHAVE;
  banco.fechar();
  banco.abrir(semChave);
  const claro = banco.anexar(semanteA.t.id, semanteA.e.id, 'antes', 'image/png', SEGREDO);
  banco.fechar();

  process.env.COFRE_CHAVE = guardada;
  banco.abrir(semChave);
  const lido = banco.obterObjeto(semanteA.t.id, claro.id);
  assert.ok(Buffer.from(lido.dados).equals(SEGREDO),
    'o que foi gravado antes da chave parou de abrir depois dela');
});

caso('chave em formato livre tambem serve, por derivacao', () => {
  const pastaC = fs.mkdtempSync(path.join(os.tmpdir(), 'cifra-c-'));
  const arq = path.join(pastaC, 'cofre.db');
  banco.fechar();
  process.env.COFRE_CHAVE = 'uma frase que alguem colou sem ler o formato';
  const sem = semear(arq);
  const o = banco.anexar(sem.t.id, sem.e.id, 'depois', 'image/png', SEGREDO);
  assert.strictEqual(banco.cifraLigada(), true);
  assert.strictEqual(apareceEmDisco(arq, SEGREDO), false);
  assert.ok(Buffer.from(banco.obterObjeto(sem.t.id, o.id).dados).equals(SEGREDO));
});

try { banco.fechar(); } catch (e) {}
console.log('\n' + feitos + ' passaram, ' + falhas + ' falharam\n');
process.exit(falhas ? 1 : 0);
