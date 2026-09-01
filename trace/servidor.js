/* Trace: o servidor.
 *
 * http puro do Node, sem framework. Cada resposta leva os cabecalhos de
 * seguranca. O portao exige sessao para tudo em /api, menos cadastrar, entrar,
 * SSO, o objeto por link assinado e o healthcheck. O tenant vem SEMPRE da
 * sessao, nunca do corpo: e o que impede um cliente pedir dado de outro.
 */
const http = require('http');
const banco = require('./banco.js');
const contas = require('./contas.js');
const sso = require('./sso.js');

const PORTA = Number(process.env.PORT) || 4100;
const ORIGENS = String(process.env.TRACE_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function cabecalhoSeguro(req, origem) {
  const cab = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  };
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https') cab['Strict-Transport-Security'] = 'max-age=31536000';
  // CORS restritivo: so devolve a liberacao para origem que esta na allowlist.
  const o = req.headers.origin;
  if (o && ORIGENS.includes(o)) {
    cab['Access-Control-Allow-Origin'] = o;
    cab['Access-Control-Allow-Credentials'] = 'true';
    cab['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS';
    cab['Access-Control-Allow-Headers'] = 'content-type';
    cab['Vary'] = 'Origin';
  }
  return cab;
}

function mensagemSegura(err, status) {
  if (status < 500 || status === 503) return err.message;
  return 'Falha interna ao processar. Tente de novo, e se persistir avise o suporte.';
}

function responder(res, req, status, corpo, extra) {
  res.writeHead(status, Object.assign(cabecalhoSeguro(req), extra || {}));
  res.end(corpo === null ? '' : JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '', tamanho = 0;
    req.on('data', d => { tamanho += d.length; if (tamanho > 8_000_000) { req.destroy(); reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); return; } bruto += d; });
    req.on('end', () => { if (!bruto) return resolve({}); try { resolve(JSON.parse(bruto)); } catch (e) { reject(Object.assign(new Error('json invalido'), { status: 400 })); } });
    req.on('error', reject);
  });
}

async function roteador(req, res) {
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  const metodo = req.method;

  try {
    if (metodo === 'OPTIONS') return responder(res, req, 204, null);   // preflight: cabecalhos ja tratam a allowlist

    // ---- aberto ----
    if (rota === '/ping') {
      return responder(res, req, 200, { ok: true, servico: 'trace', banco: banco.ligado() ? 'ligado' : 'desligado', motivo: banco.porque() || undefined, cifra: banco.cifraLigada() ? 'ligada' : 'em claro', link: banco.linkLigado() ? 'ligado' : 'desligado', efemero: banco.efemero() || undefined });
    }
    if (rota === '/api/cadastrar' && metodo === 'POST') {
      const r = contas.cadastrar(req, await lerCorpo(req));
      return responder(res, req, 201, { usuario: r.usuario, tenantId: r.tenantId }, { 'Set-Cookie': r.cookie });
    }
    if (rota === '/api/entrar' && metodo === 'POST') {
      const r = contas.entrar(req, await lerCorpo(req));
      return responder(res, req, 200, { usuario: r.usuario, tenantId: r.tenantId }, { 'Set-Cookie': r.cookie });
    }
    if (rota === '/api/sso/iniciar' && metodo === 'POST') {
      const corpo = await lerCorpo(req);
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      const retorno = proto + '://' + (req.headers.host || ('127.0.0.1:' + PORTA)) + '/api/sso/retorno';
      const r = await sso.iniciar(corpo.email, retorno);
      if (!r) return responder(res, req, 200, { sso: false });   // dominio sem SSO: siga por senha
      return responder(res, req, 200, { sso: true, url: r.url });
    }
    if (rota === '/api/sso/retorno' && metodo === 'GET') {
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      const retorno = proto + '://' + (req.headers.host || ('127.0.0.1:' + PORTA)) + '/api/sso/retorno';
      const dados = await sso.concluir(url.searchParams.get('code'), url.searchParams.get('state'), retorno);
      const r = contas.entrarPorProvedor(req, dados);
      return responder(res, req, 200, { usuario: r.usuario, tenantId: r.tenantId }, { 'Set-Cookie': r.cookie });
    }
    // objeto por link assinado: sem sessao, mas so com assinatura valida
    if (rota === '/api/objeto' && metodo === 'GET') {
      const ok = banco.validarLink({ t: url.searchParams.get('t'), r: url.searchParams.get('r'), exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig') });
      if (!ok) return responder(res, req, 403, { erro: 'link invalido ou expirado' });
      const rec = banco.obterRecurso(ok.tenantId, ok.recursoId);
      if (!rec) return responder(res, req, 404, { erro: 'recurso nao encontrado' });
      res.writeHead(200, Object.assign(cabecalhoSeguro(req), { 'Content-Type': rec.tipo }));
      return res.end(rec.corpo);
    }

    // ---- portao: daqui pra baixo exige sessao ----
    if (!rota.startsWith('/api/')) return responder(res, req, 404, { erro: 'nao encontrado' });
    if (rota === '/api/sair' && metodo === 'POST') {
      const r = contas.sair(req);
      return responder(res, req, 200, { ok: true }, { 'Set-Cookie': r.cookie });
    }
    const sessao = contas.sessaoDe(req);
    if (!sessao) return responder(res, req, 401, { erro: 'entre para continuar' });

    if (rota === '/api/eu') return responder(res, req, 200, { usuario: { id: sessao.usuarioId, email: sessao.email }, tenantId: sessao.tenantId, papel: sessao.papel });

    if (rota === '/api/recursos' && metodo === 'GET') return responder(res, req, 200, { recursos: banco.listarRecursos(sessao.tenantId) });

    if (rota === '/api/recursos' && metodo === 'POST') {
      if (!banco.podeGravar(sessao.papel)) return responder(res, req, 403, { erro: 'seu papel nao pode criar' });
      const corpo = await lerCorpo(req);
      const r = banco.criarRecurso(sessao.tenantId, sessao.usuarioId, corpo.nome, corpo.conteudo, corpo.tipo);
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'criar-recurso', 'recurso:' + r.id, sessao.ip);
      return responder(res, req, 201, { recurso: { id: r.id, nome: r.nome, tipo: r.tipo, bytes: r.bytes, sha256: r.sha256, expira_em: r.expira_em } });
    }

    let m = rota.match(/^\/api\/recursos\/([\w-]+)$/);
    if (m && metodo === 'GET') {
      const r = banco.obterRecurso(sessao.tenantId, m[1]);
      if (!r) return responder(res, req, 404, { erro: 'recurso nao encontrado' });   // 404 tambem para id de outro tenant
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'ver-recurso', 'recurso:' + r.id, sessao.ip);
      return responder(res, req, 200, { recurso: { id: r.id, nome: r.nome, tipo: r.tipo, bytes: r.bytes, sha256: r.sha256, conteudo: r.corpo.toString('utf8') } });
    }
    if (m && metodo === 'DELETE') {
      if (!banco.podeExcluir(sessao.papel)) return responder(res, req, 403, { erro: 'seu papel nao pode excluir' });
      if (!banco.obterRecurso(sessao.tenantId, m[1])) return responder(res, req, 404, { erro: 'recurso nao encontrado' });
      banco.excluirRecurso(sessao.tenantId, m[1]);
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'excluir-recurso', 'recurso:' + m[1], sessao.ip);
      return responder(res, req, 200, { ok: true });
    }
    m = rota.match(/^\/api\/recursos\/([\w-]+)\/link$/);
    if (m && metodo === 'POST') {
      if (!banco.obterRecurso(sessao.tenantId, m[1])) return responder(res, req, 404, { erro: 'recurso nao encontrado' });
      const link = banco.assinarLink(sessao.tenantId, m[1]);
      banco.registrar(sessao.tenantId, sessao.usuarioId, 'gerar-link', 'recurso:' + m[1], sessao.ip);
      const qs = new URLSearchParams({ t: link.t, r: link.r, exp: String(link.exp), sig: link.sig });
      return responder(res, req, 200, { url: '/api/objeto?' + qs.toString(), expira_em: link.exp });
    }

    if (rota === '/api/auditoria' && metodo === 'GET') return responder(res, req, 200, { auditoria: banco.listarAuditoria(sessao.tenantId) });

    if (rota === '/api/retencao' && metodo === 'POST') {
      if (!banco.podeAdministrar(sessao.papel)) return responder(res, req, 403, { erro: 'so admin roda a poda' });
      return responder(res, req, 200, banco.podarVencidos());
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
    console.log('Trace no ar em http://127.0.0.1:' + PORTA);
    console.log('  banco:', banco.ligado() ? banco.onde() : 'desligado (' + banco.porque() + ')');
    console.log('  cifra:', banco.cifraLigada() ? 'ligada' : 'em claro (defina TRACE_CHAVE)');
    console.log('  link :', banco.linkLigado() ? 'ligado' : 'desligado (defina TRACE_SEGREDO)');
    if (banco.efemero()) console.log('  ATENCAO: banco em disco efemero, o proximo deploy apaga. Monte um volume.');
  });
}

module.exports = { criarServidor, roteador };
