/* Manager: entrada pelo provedor de identidade do cliente (OIDC).
 *
 * Portado do Print. Com SSO, quem desliga uma pessoa na empresa desliga o
 * acesso dela aqui no mesmo ato. OIDC e nao SAML (SAML e XML assinado, uma
 * superficie de ataque inteira). Sem biblioteca: o Node assina, verifica e
 * importa JWK sozinho.
 *
 * O que e verificado no token que volta, cada item ja foi um CVE em alguma
 * implementacao que pulou: assinatura (JWKS), alg (so RS256), iss, aud,
 * exp/iat, nonce (uso unico), state (uso unico), email (verificado e no
 * dominio configurado).
 */
const crypto = require('crypto');
const banco = require('./banco.js');

const FOLGA_RELOGIO_S = 60;
const ESTADO_VALE_MS = 10 * 60 * 1000;
const TEMPO_LIMITE_MS = 8000;

const lerParte = parte => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
function erro(msg, status) { const e = new Error(msg); e.status = status || 400; return e; }

async function buscarJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || TEMPO_LIMITE_MS) });
  if (!r.ok) throw erro('provedor respondeu ' + r.status + ' em ' + url, 502);
  return r.json();
}

const cacheDescoberta = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function descobrir(issuer) {
  const guardado = cacheDescoberta.get(issuer);
  if (guardado && Date.now() < guardado.ate) return guardado.doc;
  const base = String(issuer).replace(/\/+$/, '');
  const doc = await buscarJson(base + '/.well-known/openid-configuration');
  if (String(doc.issuer || '').replace(/\/+$/, '') !== base) throw erro('o provedor devolveu configuracao de outro emissor', 502);
  for (const campo of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!doc[campo]) throw erro('configuracao do provedor sem ' + campo, 502);
  cacheDescoberta.set(issuer, { doc, ate: Date.now() + CACHE_MS });
  return doc;
}

async function chavePara(jwksUri, kid) {
  const jwks = await buscarJson(jwksUri);
  const chaves = (jwks && jwks.keys) || [];
  const achada = kid ? chaves.find(k => k.kid === kid) : chaves[0];
  if (!achada) throw erro('o provedor nao publica a chave que assinou o token', 502);
  if (achada.kty !== 'RSA') throw erro('chave do provedor nao e RSA', 502);
  return crypto.createPublicKey({ key: achada, format: 'jwk' });
}

async function verificarIdToken(idToken, { issuer, clientId, jwksUri, nonce }) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw erro('token de identidade malformado', 400);
  let cabecalho, corpo;
  try { cabecalho = lerParte(partes[0]); corpo = lerParte(partes[1]); } catch (e) { throw erro('token de identidade ilegivel', 400); }
  if (cabecalho.alg !== 'RS256') throw erro('algoritmo nao aceito: ' + cabecalho.alg, 400);   // 'none'/HS256 sao os furos classicos
  const chave = await chavePara(jwksUri, cabecalho.kid);
  const assinado = Buffer.from(partes[0] + '.' + partes[1]);
  const assinatura = Buffer.from(partes[2], 'base64url');
  if (!crypto.verify('RSA-SHA256', assinado, chave, assinatura)) throw erro('assinatura do token nao confere', 401);
  const agoraS = Math.floor(Date.now() / 1000);
  if (String(corpo.iss || '').replace(/\/+$/, '') !== String(issuer).replace(/\/+$/, '')) throw erro('token emitido por outro provedor', 401);
  const audiencia = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!audiencia.includes(clientId)) throw erro('token emitido para outro aplicativo', 401);
  if (!corpo.exp || corpo.exp + FOLGA_RELOGIO_S < agoraS) throw erro('token expirado', 401);
  if (corpo.iat && corpo.iat - FOLGA_RELOGIO_S > agoraS) throw erro('token emitido no futuro', 401);
  if (nonce && corpo.nonce !== nonce) throw erro('nonce nao confere', 401);
  return corpo;
}

function guardarEstado(tenantId, state, nonce, destino) {
  const db = banco.abrir();
  db.prepare('INSERT INTO sso_estados (state, tenant_id, nonce, destino, criado_em, expira_em) VALUES (?,?,?,?,?,?)')
    .run(state, tenantId, nonce, destino || '/', Date.now(), Date.now() + ESTADO_VALE_MS);
}

function consumirEstado(state) {
  const db = banco.abrir();
  const linha = db.prepare('SELECT * FROM sso_estados WHERE state = ?').get(state);
  db.prepare('DELETE FROM sso_estados WHERE state = ?').run(state);   // some sempre: reaproveitar state e o que o uso unico impede
  db.prepare('DELETE FROM sso_estados WHERE expira_em < ?').run(Date.now());
  if (!linha || linha.expira_em < Date.now()) return null;
  return linha;
}

async function iniciar(email, urlDeRetorno, destino) {
  const dominio = String(email || '').split('@')[1];
  if (!dominio) throw erro('informe o e-mail da empresa', 400);
  const cfg = banco.ssoPorDominio(dominio.toLowerCase());
  if (!cfg) return null;   // dominio sem SSO: segue pelo caminho de senha
  const doc = await descobrir(cfg.issuer);
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  guardarEstado(cfg.tenant_id, state, nonce, destino);
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.client_id);
  u.searchParams.set('redirect_uri', urlDeRetorno);
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('login_hint', String(email));
  return { url: u.toString(), tenantId: cfg.tenant_id };
}

async function concluir(code, state, urlDeRetorno) {
  if (!code || !state) throw erro('retorno do provedor incompleto', 400);
  const guardado = consumirEstado(state);
  if (!guardado) throw erro('esta entrada expirou ou ja foi usada. Tente de novo.', 400);
  const cfg = banco.ssoDoTenant(guardado.tenant_id);
  if (!cfg) throw erro('esta equipe nao tem entrada por provedor configurada', 400);
  const doc = await descobrir(cfg.issuer);
  const corpo = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: urlDeRetorno, client_id: cfg.client_id, client_secret: banco.ssoSegredo(cfg) });
  const r = await fetch(doc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: corpo, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || !dados.id_token) throw erro('o provedor recusou a troca do codigo', 401);
  const claims = await verificarIdToken(dados.id_token, { issuer: cfg.issuer, clientId: cfg.client_id, jwksUri: doc.jwks_uri, nonce: guardado.nonce });
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw erro('o provedor nao informou o e-mail', 401);
  if (claims.email_verified !== true) throw erro('o provedor nao confirmou este e-mail', 401);   // ausente = nao verificado
  const dominio = email.split('@')[1] || '';
  if (dominio !== String(cfg.dominio).toLowerCase()) throw erro('este e-mail nao pertence ao dominio desta equipe', 403);
  return { email, nome: String(claims.name || '').slice(0, 120), tenantId: guardado.tenant_id, papel: cfg.papel_padrao || 'consultor', destino: guardado.destino || '/' };
}

module.exports = { iniciar, concluir, descobrir, verificarIdToken, guardarEstado, consumirEstado, ESTADO_VALE_MS };
