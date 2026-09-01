/* Manager: o servidor.
 *
 * http puro do Node, sem framework, igual ao Print. Cada resposta leva os
 * cabecalhos de seguranca. O portao exige sessao para tudo em /api, menos
 * cadastrar, entrar e o healthcheck. O tenant vem SEMPRE da sessao, nunca do
 * corpo do pedido: e o que impede um cliente pedir dado de outro.
 */
const http = require('http');
const banco = require('./banco.js');
const contas = require('./contas.js');

const PORTA = Number(process.env.PORT) || 4000;

function cabecalhoSeguro(req) {
  const cab = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  };
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https') cab['Strict-Transport-Security'] = 'max-age=31536000';
  return cab;
}

function mensagemSegura(err, status) {
  if (status < 500 || status === 503) return err.message;
  return 'Falha interna ao processar. Tente de novo, e se persistir avise o suporte.';
}

function responder(res, req, status, corpo, extra) {
  const cab = Object.assign(cabecalhoSeguro(req), extra || {});
  res.writeHead(status, cab);
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '', tamanho = 0;
    req.on('data', d => {
      tamanho += d.length;
      if (tamanho > 1_000_000) { req.destroy(); reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); return; }
      bruto += d;
    });
    req.on('end', () => {
      if (!bruto) return resolve({});
      try { resolve(JSON.parse(bruto)); } catch (e) { reject(Object.assign(new Error('json invalido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function roteador(req, res) {
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  const metodo = req.method;

  try {
    // ---- aberto ----
    if (rota === '/ping') {
      return responder(res, req, 200, {
        ok: true, servico: 'manager',
        banco: banco.ligado() ? 'ligado' : 'desligado',
        motivo: banco.porque() || undefined,
        cifra: banco.cifraLigada() ? 'ligada' : 'em claro',
        efemero: banco.efemero() || undefined,
      });
    }
    if (rota === '/api/cadastrar' && metodo === 'POST') {
      const r = contas.cadastrar(req, await lerCorpo(req));
      return responder(res, req, 201, { usuario: r.usuario, tenantId: r.tenantId }, { 'Set-Cookie': r.cookie });
    }
    if (rota === '/api/entrar' && metodo === 'POST') {
      const r = contas.entrar(req, await lerCorpo(req));
      return responder(res, req, 200, { usuario: r.usuario, tenantId: r.tenantId }, { 'Set-Cookie': r.cookie });
    }

    // ---- portao: daqui pra baixo exige sessao ----
    const sessao = contas.sessaoDe(req);
    if (!rota.startsWith('/api/')) return responder(res, req, 404, { erro: 'nao encontrado' });
    if (rota === '/api/sair' && metodo === 'POST') {
      const r = contas.sair(req);
      return responder(res, req, 200, { ok: true }, { 'Set-Cookie': r.cookie });
    }
    if (!sessao) return responder(res, req, 401, { erro: 'entre para continuar' });

    if (rota === '/api/eu') {
      return responder(res, req, 200, { usuario: { id: sessao.usuarioId, email: sessao.email }, tenantId: sessao.tenantId, papel: sessao.papel });
    }

    if (rota === '/api/recursos' && metodo === 'GET') {
      return responder(res, req, 200, { recursos: banco.listarRecursos(sessao.tenantId) });
    }
    if (rota === '/api/recursos' && metodo === 'POST') {
      const corpo = await lerCorpo(req);
      const r = banco.criarRecurso(sessao.tenantId, sessao.usuarioId, corpo.nome, corpo.conteudo);
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'criar-recurso', 'recurso:' + r.id, sessao.ip);
      return responder(res, req, 201, { recurso: { id: r.id, nome: r.nome, bytes: r.bytes, sha256: r.sha256 } });
    }
    const m = rota.match(/^\/api\/recursos\/([\w-]+)$/);
    if (m && metodo === 'GET') {
      const r = banco.obterRecurso(sessao.tenantId, m[1]);
      if (!r) return responder(res, req, 404, { erro: 'recurso nao encontrado' });   // 404 tambem para id de outro tenant: nao confirma existencia
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'ver-recurso', 'recurso:' + r.id, sessao.ip);
      return responder(res, req, 200, { recurso: { id: r.id, nome: r.nome, bytes: r.bytes, sha256: r.sha256, conteudo: r.corpo.toString('utf8') } });
    }
    if (rota === '/api/auditoria' && metodo === 'GET') {
      return responder(res, req, 200, { auditoria: banco.listarAuditoria(sessao.tenantId) });
    }

    return responder(res, req, 404, { erro: 'nao encontrado' });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return responder(res, req, status, { erro: mensagemSegura(err, status) });
  }
}

function criarServidor() { return http.createServer(roteador); }

if (require.main === module) {
  banco.abrir();
  criarServidor().listen(PORTA, () => {
    console.log('Manager no ar em http://127.0.0.1:' + PORTA);
    console.log('  banco:', banco.ligado() ? banco.onde() : 'desligado (' + banco.porque() + ')');
    console.log('  cifra:', banco.cifraLigada() ? 'ligada' : 'em claro (defina MANAGER_CHAVE)');
    if (banco.efemero()) console.log('  ATENCAO: banco em disco efemero, o proximo deploy apaga. Monte um volume.');
  });
}

module.exports = { criarServidor, roteador };
