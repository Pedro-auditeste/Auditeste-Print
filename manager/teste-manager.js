/* Trava o nucleo de seguranca do Manager, atacando o servidor de verdade.
 *
 *   node teste-manager.js
 *
 * Cada caso e um ataque que tem que ser recusado, nao um caminho feliz.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-'));
process.env.MANAGER_BANCO = path.join(dir, 'manager.db');
process.env.MANAGER_CHAVE = 'a'.repeat(64);            // liga a cifra para o teste dela
process.env.MANAGER_SESSAO_MS = '3600000';

const banco = require('./banco.js');
const { criarServidor } = require('./servidor.js');
banco.abrir();
const srv = criarServidor().listen(0);
const PORTA = srv.address().port;

function pedir(metodo, rota, corpo, cookie) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({ host: '127.0.0.1', port: PORTA, method: metodo, path: rota,
      headers: Object.assign({ 'Content-Type': 'application/json' }, dados ? { 'Content-Length': Buffer.byteLength(dados) } : {}, cookie ? { Cookie: cookie } : {}) },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: b ? JSON.parse(b) : null })); });
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}
const cookieDe = r => (r.headers['set-cookie'] || [])[0].split(';')[0];

let n = 0;
const caso = async (nome, fn) => { await fn(); n++; console.log('  ok   ' + nome); };

(async () => {
  console.log('\nmanager - identidade\n');

  let cookieA, cookieB, recA;

  await caso('anonimo em /api/eu leva 401', async () => {
    const r = await pedir('GET', '/api/eu');
    assert.strictEqual(r.status, 401);
  });

  await caso('cadastro cria conta e o cookie e HttpOnly', async () => {
    const r = await pedir('POST', '/api/cadastrar', { email: 'a@a.com', senha: 'senhaforte1', equipe: 'Alpha' });
    assert.strictEqual(r.status, 201);
    const sc = r.headers['set-cookie'][0];
    assert.ok(/HttpOnly/i.test(sc) && /SameSite/i.test(sc), 'cookie tem que ser HttpOnly + SameSite');
    cookieA = cookieDe(r);
  });

  await caso('senha errada nao entra, e nao revela se o e-mail existe', async () => {
    const r = await pedir('POST', '/api/entrar', { email: 'a@a.com', senha: 'errada' });
    assert.strictEqual(r.status, 401);
    const r2 = await pedir('POST', '/api/entrar', { email: 'naoexiste@x.com', senha: 'x' });
    assert.strictEqual(r2.status, 401);
    assert.strictEqual(r.corpo.erro, r2.corpo.erro, 'a mensagem tem que ser igual nos dois');
  });

  await caso('o token de sessao nao fica em texto no banco', async () => {
    const token = cookieA.split('=')[1];
    const bruto = fs.readFileSync(process.env.MANAGER_BANCO);
    // pode nao existir ainda no .db por WAL; consolida e confere
    const snap = path.join(dir, 'conf-token.db');
    banco.snapshot(snap);
    const consolidado = fs.readFileSync(snap);
    assert.ok(!consolidado.includes(token) && !bruto.includes(token), 'o token cru nao pode estar no arquivo');
  });

  console.log('\nmanager - isolamento entre clientes\n');

  await caso('cria um recurso na equipe A', async () => {
    const r = await pedir('POST', '/api/recursos', { nome: 'segredo A', conteudo: 'CONTEUDO-SECRETO-DE-A-123' }, cookieA);
    assert.strictEqual(r.status, 201);
    recA = r.corpo.recurso.id;
  });

  await caso('A le o proprio recurso e o conteudo volta inteiro', async () => {
    const r = await pedir('GET', '/api/recursos/' + recA, null, cookieA);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.recurso.conteudo, 'CONTEUDO-SECRETO-DE-A-123');
  });

  await caso('cria a equipe B (outra conta, isolada)', async () => {
    const r = await pedir('POST', '/api/cadastrar', { email: 'b@b.com', senha: 'senhaforte2', equipe: 'Beta' });
    cookieB = cookieDe(r);
  });

  await caso('CRITERIO: B nao le o recurso de A sabendo o id (404)', async () => {
    const r = await pedir('GET', '/api/recursos/' + recA, null, cookieB);
    assert.strictEqual(r.status, 404);
  });

  await caso('CRITERIO: a lista de B nao mostra o recurso de A', async () => {
    const r = await pedir('GET', '/api/recursos', null, cookieB);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.recursos.length, 0);
  });

  await caso('a auditoria de B nao mostra a de A', async () => {
    const r = await pedir('GET', '/api/auditoria', null, cookieB);
    assert.ok(r.corpo.auditoria.every(a => !String(a.recurso || '').includes(recA)));
  });

  console.log('\nmanager - cifra em repouso\n');

  await caso('CRITERIO: com a chave, o conteudo nao aparece no arquivo do banco', async () => {
    const snap = path.join(dir, 'conf-cifra.db');
    banco.snapshot(snap);
    const bytes = fs.readFileSync(snap);
    assert.ok(!bytes.includes('CONTEUDO-SECRETO-DE-A-123'), 'o conteudo em claro nao pode estar no arquivo');
    assert.ok(bytes.includes('AUDIENC1'), 'o marcador de cifrado tem que estar la');
  });

  console.log('\nmanager - cabecalhos\n');

  await caso('toda resposta leva nosniff, CSP e Referrer-Policy', async () => {
    const r = await pedir('GET', '/ping');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(/frame-ancestors/.test(r.headers['content-security-policy']));
    assert.strictEqual(r.headers['referrer-policy'], 'same-origin');
  });

  console.log('\nmanager - freio de forca bruta\n');

  await caso('CRITERIO: a conta trava depois de MAX tentativas erradas', async () => {
    let ultimo = 0;
    for (let i = 0; i < 10; i++) ultimo = (await pedir('POST', '/api/entrar', { email: 'a@a.com', senha: 'errada' })).status;
    assert.strictEqual(ultimo, 429, 'depois de martelar, tem que virar 429');
    // e a senha certa tambem nao entra enquanto travado
    const r = await pedir('POST', '/api/entrar', { email: 'a@a.com', senha: 'senhaforte1' });
    assert.strictEqual(r.status, 429);
  });

  console.log('\nmanager - backup e restauracao\n');

  await caso('CRITERIO: depois de perder o banco, os dados voltam pelo backup', async () => {
    const bk = path.join(dir, 'backup.db');
    banco.snapshot(bk);
    const conta = banco.conferirArquivo(bk);
    assert.ok(conta.recursos >= 1 && conta.usuarios >= 2, 'o backup tem que ter os dados');
    // destroi e restaura
    banco.fechar();
    fs.copyFileSync(bk, process.env.MANAGER_BANCO);
    banco.abrir();
    const A = banco.tenantPorNome('Alpha');
    const lista = banco.listarRecursos(A.id);
    assert.ok(lista.length >= 1, 'o recurso de A voltou');
    const r = banco.obterRecurso(A.id, lista[0].id);
    assert.strictEqual(r.corpo.toString('utf8'), 'CONTEUDO-SECRETO-DE-A-123', 'voltou com o conteudo dentro');
  });

  srv.close();
  banco.fechar();
  console.log('\n' + n + ' casos, tudo certo\n');
})().catch(e => { console.error('FALHOU:', e); srv.close(); process.exit(1); });
