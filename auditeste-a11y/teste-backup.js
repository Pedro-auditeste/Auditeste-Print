/* "Temos backup" não é o controle. O controle é "conseguimos recuperar".
 *
 * Este teste faz o caminho inteiro: grava evidência, tira backup, destrói o
 * banco, restaura, e confere que a evidência voltou COM o arquivo dentro.
 * Sem a última parte um backup pode passar e ainda assim ter perdido os
 * prints, que é a única coisa que a evidência realmente é.
 *
 *   node teste-backup.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
const ARQUIVO = path.join(PASTA, 'cofre.db');
const COPIA = path.join(PASTA, 'copia.db');

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

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const admin = (...args) => execFileSync(process.execPath,
  [path.join(__dirname, 'cofre', 'admin.js'), ...args],
  { env: Object.assign({}, process.env, { COFRE_BANCO: ARQUIVO }), encoding: 'utf8' });

console.log('\nbackup e restauracao\n');

/* ---------- semeia ---------- */
banco.abrir(ARQUIVO);
const tenant = banco.criarTenant('Ailos', 90);
const u = banco.criarUsuario('qa@auditeste.com', contas.hashSenha('senha-bem-longa-1'));
banco.vincular(tenant.id, u.id, 'admin');
const projeto = banco.criarProjeto(tenant.id, u.id, 'Portal', 'Ailos');
const execucao = banco.criarExecucao(tenant.id, u.id, projeto.id, 'Regressivo');
const evidencia = banco.criarEvidencia(tenant.id, u.id, execucao.id, { titulo: 'Entrar' }, 90);
const objeto = banco.anexar(tenant.id, evidencia.id, 'depois', 'image/png', PIXEL);
const shaOriginal = objeto.sha256;

caso('backup roda com o banco em uso e ja sai conferido', () => {
  const saida = admin('backup', COPIA);
  assert.ok(fs.existsSync(COPIA), 'não criou o arquivo');
  assert.ok(/conferido/.test(saida), 'não conferiu o que acabou de escrever');
  assert.ok(/evidencias\s+1/.test(saida), 'a contagem não bate: ' + saida);
});

caso('o backup e um banco inteiro, nao um arquivo pela metade', () => {
  const conta = banco.conferirArquivo(COPIA);
  assert.strictEqual(conta.evidencias, 1);
  assert.strictEqual(conta.objetos, 1);
  assert.strictEqual(conta.usuarios, 1);
});

caso('nao sobrescreve backup existente sem querer', () => {
  assert.throws(() => banco.snapshot(COPIA), /já existe/);
});

caso('arquivo que nao e cofre e recusado antes de encostar no original', () => {
  const lixo = path.join(PASTA, 'lixo.db');
  fs.writeFileSync(lixo, 'isto nao e um banco');
  assert.throws(() => banco.conferirArquivo(lixo), /corrompido|não parece|not a database|file is not/i);

  /* Banco de verdade, mas de outro sistema: abre, passa na integridade, e
   * mesmo assim não pode ser aceito como cofre. */
  const alheio = path.join(PASTA, 'alheio.db');
  banco.fechar();
  const outro = new (require('node:sqlite').DatabaseSync)(alheio);
  outro.exec('CREATE TABLE qualquer(a TEXT)');
  outro.close();
  assert.throws(() => banco.conferirArquivo(alheio), /não parece um cofre/);
  banco.abrir(ARQUIVO);
});

/* ---------- destrói ---------- */

caso('CRITERIO: depois de perder o banco, a evidencia volta inteira', () => {
  banco.fechar();
  for (const sufixo of ['', '-wal', '-shm']) {
    if (fs.existsSync(ARQUIVO + sufixo)) fs.rmSync(ARQUIVO + sufixo);
  }
  assert.ok(!fs.existsSync(ARQUIVO), 'o banco não foi destruído, o teste não provaria nada');

  const saida = admin('restaurar', COPIA);
  assert.ok(/restaurado/.test(saida), saida);
  assert.ok(/REINICIE/.test(saida), 'não avisou que o servidor no ar segue no arquivo antigo');

  banco.abrir(ARQUIVO);
  const projetos = banco.listarProjetos(tenant.id);
  assert.strictEqual(projetos.length, 1, 'o projeto não voltou');

  const evidencias = banco.listarEvidencias(tenant.id, execucao.id);
  assert.strictEqual(evidencias.length, 1, 'a evidência não voltou');

  const objetos = banco.objetosDe(tenant.id, evidencias[0].id);
  assert.strictEqual(objetos.length, 1, 'a evidência voltou sem o print');
  assert.strictEqual(objetos[0].sha256, shaOriginal,
    'o print voltou diferente do que entrou');

  const bytes = banco.obterObjeto(tenant.id, objetos[0].id);
  assert.ok(Buffer.from(bytes.dados).equals(PIXEL), 'o conteúdo do print não confere byte a byte');
});

caso('quem entrava antes continua entrando depois de restaurar', () => {
  const achado = banco.usuarioPorEmail('qa@auditeste.com');
  assert.ok(achado, 'o usuário não voltou');
  assert.ok(contas.conferirSenha('senha-bem-longa-1', achado.senha_hash),
    'a senha parou de valer depois da restauração');
});

caso('restaurar guarda o banco anterior em vez de apagar', () => {
  // Segunda restauração: agora existe um banco atual para ser preservado.
  // Fecha antes: no Windows não se renomeia arquivo aberto, e é o próprio
  // teste que o mantém aberto, não o sistema.
  banco.fechar();
  const saida = admin('restaurar', COPIA);
  const m = /anterior ficou em (.+)/.exec(saida);
  assert.ok(m, 'não disse onde guardou o anterior: ' + saida);
  assert.ok(fs.existsSync(m[1].trim()), 'o arquivo guardado não existe: ' + m[1]);
});

caso('restaurar com o banco em uso recusa e nao mexe em nada', () => {
  banco.abrir(ARQUIVO);
  const antes = require('fs').statSync(ARQUIVO).size;
  let recusou = false;
  try {
    admin('restaurar', COPIA);
  } catch (err) {
    const saida = String(err.stdout || '') + String(err.stderr || '');
    recusou = /aberto por outro processo/.test(saida);
  }
  if (process.platform === 'win32') {
    assert.ok(recusou, 'deveria recusar com mensagem clara em vez de estourar EBUSY cru');
    assert.strictEqual(require('fs').statSync(ARQUIVO).size, antes, 'mexeu no banco mesmo recusando');
  }
  banco.fechar();
});

caso('a auditoria sobrevive a restauracao', () => {
  banco.abrir(ARQUIVO);
  banco.auditar(tenant.id, u.id, 'teste.pos_restauracao', 'ok', '127.0.0.1');
  const eventos = banco.listarAuditoria(tenant.id, 10);
  assert.ok(eventos.some(e => e.acao === 'teste.pos_restauracao'),
    'o banco restaurado não aceita escrita nova');
});

try { banco.fechar(); } catch (e) {}
console.log('\n' + feitos + ' passaram, ' + falhas + ' falharam\n');
process.exit(falhas ? 1 : 0);
