/* Trava o nucleo de seguranca do Trace, atacando o servidor de verdade.
 *
 *   node teste-trace.js
 *
 * Cada caso e um ataque que tem que ser recusado, nao um caminho feliz.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
process.env.TRACE_BANCO = path.join(dir, 'trace.db');
process.env.TRACE_CHAVE = 'a'.repeat(64);
process.env.TRACE_SEGREDO = 'b'.repeat(64);
process.env.TRACE_SESSAO_MS = '3600000';
process.env.TRACE_ORIGINS = 'https://ok.example';

const banco = require('./banco.js');
const contas = require('./contas.js');
const sso = require('./sso.js');
const { criarServidor } = require('./servidor.js');
banco.abrir();
const srv = criarServidor().listen(0);
const PORTA = srv.address().port;

function pedir(metodo, rota, corpo, headers) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({ host: '127.0.0.1', port: PORTA, method: metodo, path: rota,
      headers: Object.assign({ 'Content-Type': 'application/json' }, dados ? { 'Content-Length': Buffer.byteLength(dados) } : {}, headers || {}) },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: b && res.headers['content-type'] && res.headers['content-type'].includes('json') ? JSON.parse(b) : b })); });
    req.on('error', reject); if (dados) req.write(dados); req.end();
  });
}
const cookieDe = r => (r.headers['set-cookie'] || [])[0].split(';')[0];
const comCookie = c => ({ Cookie: c });

// login por senha, criando a conta com papel dado direto no banco
function contaComPapel(email, papel, tenantId) {
  const u = banco.usuarioPorEmail(email) || banco.criarUsuario(email, contas.hashSenha('senhaforte9'));
  banco.vincular(tenantId, u.id, papel);
  return u;
}

let n = 0;
const caso = async (nome, fn) => { await fn(); n++; console.log('  ok   ' + nome); };

(async () => {
  console.log('\ntrace - identidade\n');
  let cookieA, cookieB, recA, tenantA;

  await caso('anonimo em /api/eu leva 401', async () => assert.strictEqual((await pedir('GET', '/api/eu')).status, 401));

  await caso('cadastro cria conta e o cookie e HttpOnly', async () => {
    const r = await pedir('POST', '/api/cadastrar', { email: 'a@a.com', senha: 'senhaforte1', equipe: 'Alpha' });
    assert.strictEqual(r.status, 201);
    assert.ok(/HttpOnly/i.test(r.headers['set-cookie'][0]) && /SameSite/i.test(r.headers['set-cookie'][0]));
    cookieA = cookieDe(r); tenantA = r.corpo.tenantId;
  });

  await caso('senha errada nao entra, e nao revela se o e-mail existe', async () => {
    const r = await pedir('POST', '/api/entrar', { email: 'a@a.com', senha: 'errada' });
    const r2 = await pedir('POST', '/api/entrar', { email: 'naoexiste@x.com', senha: 'x' });
    assert.strictEqual(r.status, 401); assert.strictEqual(r2.status, 401);
    assert.strictEqual(r.corpo.erro, r2.corpo.erro);
  });

  await caso('o token de sessao nao fica em texto no banco', async () => {
    const token = cookieA.split('=')[1];
    const snap = path.join(dir, 'conf-token.db'); banco.snapshot(snap);
    assert.ok(!fs.readFileSync(snap).includes(token));
  });

  console.log('\ntrace - isolamento entre clientes\n');

  await caso('cria um recurso na equipe A', async () => {
    const r = await pedir('POST', '/api/recursos', { nome: 'segredo A', conteudo: 'CONTEUDO-SECRETO-DE-A-123' }, comCookie(cookieA));
    assert.strictEqual(r.status, 201); recA = r.corpo.recurso.id;
  });
  await caso('A le o proprio recurso e o conteudo volta inteiro', async () => {
    const r = await pedir('GET', '/api/recursos/' + recA, null, comCookie(cookieA));
    assert.strictEqual(r.corpo.recurso.conteudo, 'CONTEUDO-SECRETO-DE-A-123');
  });
  await caso('cria a equipe B (outra conta, isolada)', async () => { cookieB = cookieDe(await pedir('POST', '/api/cadastrar', { email: 'b@b.com', senha: 'senhaforte2', equipe: 'Beta' })); });
  await caso('CRITERIO: B nao le o recurso de A sabendo o id (404)', async () => assert.strictEqual((await pedir('GET', '/api/recursos/' + recA, null, comCookie(cookieB))).status, 404));
  await caso('CRITERIO: a lista de B nao mostra o recurso de A', async () => assert.strictEqual((await pedir('GET', '/api/recursos', null, comCookie(cookieB))).corpo.recursos.length, 0));
  await caso('B nao exclui o recurso de A (404, nem confirma que existe)', async () => assert.strictEqual((await pedir('DELETE', '/api/recursos/' + recA, null, comCookie(cookieB))).status, 404));

  console.log('\ntrace - papeis (RBAC)\n');

  await caso('leitor nao cria (403)', async () => {
    contaComPapel('leitor@a.com', 'leitor', tenantA);
    const c = cookieDe(await pedir('POST', '/api/entrar', { email: 'leitor@a.com', senha: 'senhaforte9' }));
    assert.strictEqual((await pedir('POST', '/api/recursos', { nome: 'x', conteudo: 'y' }, comCookie(c))).status, 403);
  });
  await caso('consultor cria mas nao exclui (403)', async () => {
    contaComPapel('cons@a.com', 'consultor', tenantA);
    const c = cookieDe(await pedir('POST', '/api/entrar', { email: 'cons@a.com', senha: 'senhaforte9' }));
    assert.strictEqual((await pedir('POST', '/api/recursos', { nome: 'ok', conteudo: 'z' }, comCookie(c))).status, 201);
    assert.strictEqual((await pedir('DELETE', '/api/recursos/' + recA, null, comCookie(c))).status, 403);
  });
  await caso('gestor exclui (200) e o recurso some', async () => {
    contaComPapel('gestor@a.com', 'gestor', tenantA);
    const c = cookieDe(await pedir('POST', '/api/entrar', { email: 'gestor@a.com', senha: 'senhaforte9' }));
    assert.strictEqual((await pedir('DELETE', '/api/recursos/' + recA, null, comCookie(c))).status, 200);
    assert.strictEqual((await pedir('GET', '/api/recursos/' + recA, null, comCookie(cookieA))).status, 404);
  });

  console.log('\ntrace - link assinado\n');
  let novo;
  await caso('cria recurso e gera link assinado', async () => {
    novo = (await pedir('POST', '/api/recursos', { nome: 'com link', conteudo: 'CORPO-VIA-LINK' }, comCookie(cookieA))).corpo.recurso.id;
    const r = await pedir('POST', '/api/recursos/' + novo + '/link', {}, comCookie(cookieA));
    assert.ok(r.corpo.url.includes('/api/objeto?')); global.__link = r.corpo.url;
  });
  await caso('o link entrega o corpo sem sessao', async () => {
    const r = await pedir('GET', global.__link);
    assert.strictEqual(r.corpo, 'CORPO-VIA-LINK');
  });
  await caso('CRITERIO: remendar a assinatura invalida o link (403)', async () => {
    const adulterado = global.__link.replace(/sig=([0-9a-f])/, (m, d) => 'sig=' + (d === 'a' ? 'b' : 'a'));
    assert.strictEqual((await pedir('GET', adulterado)).status, 403);
  });
  await caso('CRITERIO: trocar o tenant no endereco invalida o link (403)', async () => {
    const trocado = global.__link.replace(/t=[\w-]+/, 't=' + banco.tenantPorNome('Beta').id);
    assert.strictEqual((await pedir('GET', trocado)).status, 403);
  });

  console.log('\ntrace - tipo e cifra em repouso\n');
  await caso('CRITERIO: tipo fora da lista e recusado (415)', async () => assert.strictEqual((await pedir('POST', '/api/recursos', { nome: 'x', conteudo: 'y', tipo: 'application/x-evil' }, comCookie(cookieA))).status, 415));
  await caso('CRITERIO: com a chave, o conteudo nao aparece no arquivo do banco', async () => {
    const snap = path.join(dir, 'conf-cifra.db'); banco.snapshot(snap);
    const bytes = fs.readFileSync(snap);
    assert.ok(!bytes.includes('CORPO-VIA-LINK') && bytes.includes('AUDIENC1'));
  });

  console.log('\ntrace - retencao e exclusao (banco)\n');
  await caso('CRITERIO: recurso vencido some na poda, com o corpo junto', async () => {
    const t = banco.criarTenant('Curto', 0);   // retencao 0 dia: nasce ja vencido
    const u = banco.criarUsuario('curto@x.com', 'h'); banco.vincular(t.id, u.id, 'admin');
    banco.criarRecurso(t.id, u.id, 'efemero', 'some logo');
    const r = banco.podarVencidos();
    assert.ok(r.removidos >= 1);
    assert.strictEqual(banco.listarRecursos(t.id).length, 0);
  });

  console.log('\ntrace - cabecalhos e CORS\n');
  await caso('toda resposta leva nosniff, CSP e Referrer-Policy', async () => {
    const r = await pedir('GET', '/ping');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(/frame-ancestors/.test(r.headers['content-security-policy']));
    assert.strictEqual(r.headers['referrer-policy'], 'same-origin');
  });
  await caso('CRITERIO: CORS nao libera origem fora da allowlist', async () => {
    const r = await pedir('GET', '/ping', null, { Origin: 'https://mau.example' });
    assert.ok(!r.headers['access-control-allow-origin']);
  });
  await caso('CORS libera a origem que esta na allowlist', async () => {
    const r = await pedir('GET', '/ping', null, { Origin: 'https://ok.example' });
    assert.strictEqual(r.headers['access-control-allow-origin'], 'https://ok.example');
  });

  console.log('\ntrace - freio de forca bruta\n');
  await caso('CRITERIO: a conta trava depois de MAX tentativas erradas', async () => {
    let ultimo = 0;
    for (let i = 0; i < 10; i++) ultimo = (await pedir('POST', '/api/entrar', { email: 'b@b.com', senha: 'errada' })).status;
    assert.strictEqual(ultimo, 429);
    assert.strictEqual((await pedir('POST', '/api/entrar', { email: 'b@b.com', senha: 'senhaforte2' })).status, 429);
  });

  console.log('\ntrace - SSO (OIDC) contra provedor de mentira\n');
  await caso('CRITERIO: volta valida cria a sessao com o e-mail do provedor; token adulterado e recusado', async () => {
    // provedor de mentira: discovery + JWKS + assinatura RS256
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'k1'; jwk.alg = 'RS256'; jwk.use = 'sig';
    let issuer;
    const idp = http.createServer((rq, rs) => {
      if (rq.url.startsWith('/.well-known/openid-configuration')) { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify({ issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' })); }
      if (rq.url.startsWith('/jwks')) { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify({ keys: [jwk] })); }
      if (rq.url.startsWith('/token')) { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify({ id_token: global.__idtoken })); }
      rs.end('{}');
    }).listen(0);
    issuer = 'http://127.0.0.1:' + idp.address().port;

    const t = banco.criarTenant('EmpresaSSO', 90);
    banco.ssoConfigurar(t.id, { issuer, clientId: 'cli-123', clientSecret: 'segredo', dominio: 'empresa.com', papelPadrao: 'consultor' });

    // monta um id_token valido, assinado pela chave do provedor
    const assinar = (payload) => {
      const cab = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
      const cor = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.sign('RSA-SHA256', Buffer.from(cab + '.' + cor), privateKey).toString('base64url');
      return cab + '.' + cor + '.' + sig;
    };
    const ini = await sso.iniciar('joao@empresa.com', issuer + '/cb');   // gera state+nonce no banco
    const estado = banco.exigir().prepare('SELECT * FROM sso_estados LIMIT 1').get();
    const agoraS = Math.floor(Date.now() / 1000);
    const base = { iss: issuer, aud: 'cli-123', exp: agoraS + 300, iat: agoraS, email: 'joao@empresa.com', email_verified: true, name: 'Joao', nonce: estado.nonce };

    global.__idtoken = assinar(base);
    const dados = await sso.concluir('code-xyz', estado.state, issuer + '/cb');
    assert.strictEqual(dados.email, 'joao@empresa.com');
    assert.strictEqual(dados.tenantId, t.id);

    // token com assinatura de outra chave e recusado
    const { privateKey: outra } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cab = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
    const cor = Buffer.from(JSON.stringify(base)).toString('base64url');
    const falso = cab + '.' + cor + '.' + crypto.sign('RSA-SHA256', Buffer.from(cab + '.' + cor), outra).toString('base64url');
    let recusou = false;
    try { await sso.verificarIdToken(falso, { issuer, clientId: 'cli-123', jwksUri: issuer + '/jwks' }); } catch (e) { recusou = e.status === 401; }
    assert.ok(recusou, 'assinatura de outra chave tem que ser recusada');

    idp.close();
  });

  console.log('\ntrace - backup e restauracao\n');
  await caso('CRITERIO: depois de perder o banco, os dados voltam pelo backup', async () => {
    const bk = path.join(dir, 'backup.db'); banco.snapshot(bk);
    const conta = banco.conferirArquivo(bk);
    assert.ok(conta.recursos >= 1 && conta.usuarios >= 2);
    banco.fechar();
    fs.copyFileSync(bk, process.env.TRACE_BANCO);
    banco.abrir();
    const A = banco.tenantPorNome('Alpha');
    const lista = banco.listarRecursos(A.id);
    assert.ok(lista.length >= 1);
    assert.strictEqual(banco.obterRecurso(A.id, lista[0].id).corpo.toString('utf8'), 'CORPO-VIA-LINK');
  });

  srv.close(); banco.fechar();
  console.log('\n' + n + ' casos, tudo certo\n');
})().catch(e => { console.error('FALHOU:', e); srv.close(); process.exit(1); });
