/* Manager: varredura dinamica (DAST). Ataca o servico em execucao.
 *
 *   node dast.js
 *
 * Enquanto teste-manager.js pergunta "o caminho certo funciona?", este
 * pergunta "o caminho errado e recusado?". Sobe o servidor de verdade e
 * dispara sondas com cabecalho forjado, id de outro cliente, injecao,
 * travessia de caminho e corpo malformado. Sai diferente de zero se achar algo.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-dast-'));
process.env.MANAGER_BANCO = path.join(dir, 'm.db');
process.env.MANAGER_CHAVE = 'a'.repeat(64);
process.env.MANAGER_SEGREDO = 'b'.repeat(64);

const banco = require('./banco.js');
const { criarServidor } = require('./servidor.js');
banco.abrir();
const srv = criarServidor().listen(0);
const PORTA = srv.address().port;

function pedir(metodo, rota, corpo, headers) {
  return new Promise((resolve, reject) => {
    const dados = corpo != null ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : null;
    const req = http.request({ host: '127.0.0.1', port: PORTA, method: metodo, path: rota,
      headers: Object.assign({ 'Content-Type': 'application/json' }, dados ? { 'Content-Length': Buffer.byteLength(dados) } : {}, headers || {}) },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: b })); });
    req.on('error', reject); if (dados) req.write(dados); req.end();
  });
}

const achados = [];
async function sonda(nome, fn) {
  try { const ok = await fn(); if (!ok) achados.push(nome); console.log((ok ? '  ok      ' : '  ACHADO  ') + nome); }
  catch (e) { achados.push(nome + ' (erro: ' + e.message + ')'); console.log('  ACHADO  ' + nome + ' (' + e.message + ')'); }
}

(async () => {
  console.log('\nvarredura dinamica - manager em 127.0.0.1:' + PORTA + '\n');

  // prepara uma conta e um recurso, e o id de "outro cliente"
  const A = await pedir('POST', '/api/cadastrar', { email: 'dast@a.com', senha: 'senhaforte1', equipe: 'DastA' });
  const cookieA = (A.headers['set-cookie'] || [])[0].split(';')[0];
  const rec = JSON.parse((await pedir('POST', '/api/recursos', { nome: 'x', conteudo: 'segredo' }, { Cookie: cookieA })).corpo).recurso.id;
  const B = await pedir('POST', '/api/cadastrar', { email: 'dast@b.com', senha: 'senhaforte2', equipe: 'DastB' });
  const cookieB = (B.headers['set-cookie'] || [])[0].split(';')[0];

  await sonda('rota protegida recusa anonimo', async () => (await pedir('GET', '/api/recursos')).status === 401);
  await sonda('anonimo em /api/eu nao recebe identidade', async () => (await pedir('GET', '/api/eu')).status === 401);
  await sonda('id de outro cliente nao devolve nada', async () => (await pedir('GET', '/api/recursos/' + rec, null, { Cookie: cookieB })).status === 404);
  await sonda('metodo inesperado nao passa', async () => [404, 405].includes((await pedir('PUT', '/api/recursos', {}, { Cookie: cookieA })).status));
  await sonda('travessia de caminho nao sai da area', async () => (await pedir('GET', '/api/../../etc/passwd')).status >= 400);
  await sonda('cabecalhos de seguranca na resposta', async () => { const r = await pedir('GET', '/ping'); return r.headers['x-content-type-options'] === 'nosniff' && /frame-ancestors/.test(r.headers['content-security-policy'] || ''); });
  await sonda('CORS nao abre para origem qualquer', async () => !(await pedir('GET', '/ping', null, { Origin: 'https://mau.example' })).headers['access-control-allow-origin']);
  await sonda('http forca redirecionamento? servidor nao vaza detalhe em /ping', async () => { const r = await pedir('GET', '/ping'); return !/(stack|node_modules|at Object)/i.test(r.corpo); });
  await sonda('corpo malformado nao vira 500', async () => (await pedir('POST', '/api/cadastrar', '{isso nao e json', { 'Content-Type': 'application/json' })).status === 400);
  await sonda('corpo gigante e cortado, servidor continua de pe', async () => {
    // o servidor pode responder 413/400 ou cortar a conexao (ECONNRESET). Os
    // dois sao defesa; o que nao pode e cair. Confere que segue respondendo.
    try { const r = await pedir('POST', '/api/cadastrar', 'x'.repeat(9_000_000)); if (![413, 400].includes(r.status)) return false; }
    catch (e) { if (!/ECONNRESET|socket hang up/i.test(e.message)) throw e; }
    return (await pedir('GET', '/ping')).status === 200;
  });
  await sonda('poluicao de prototipo no JSON nao pega', async () => { await pedir('POST', '/api/cadastrar', { email: 'p@p.com', senha: 'senhaforte3', equipe: 'P', __proto__: { admin: true } }); return ({}).admin === undefined; });
  await sonda('injecao de SQL no login nao muda a consulta', async () => (await pedir('POST', '/api/entrar', { email: "a@a.com' OR '1'='1", senha: 'x' })).status === 401);
  await sonda('link sem assinatura nao entrega objeto', async () => (await pedir('GET', '/api/objeto?t=' + A.headers && 'x', null)).status >= 400);
  await sonda('rota desconhecida devolve 404 limpo', async () => (await pedir('GET', '/api/nao-existe', null, { Cookie: cookieA })).status === 404);

  srv.close(); banco.fechar();
  console.log('\n----------------------------------------');
  console.log(achados.length + ' achado(s) em ' + 14 + ' sondas');
  console.log('----------------------------------------\n');
  if (achados.length) { for (const a of achados) console.log('  - ' + a); process.exit(1); }
})().catch(e => { console.error('FALHOU:', e); srv.close(); process.exit(1); });
