/* Entrada pelo provedor de identidade do cliente (OIDC).
 *
 * POR QUE O CLIENTE PEDE ISSO, e nao e comodidade: com SSO, quem desliga uma
 * pessoa na empresa desliga o acesso dela aqui no mesmo ato. Sem SSO, a conta
 * continua valendo depois do desligamento até alguém lembrar de removê-la, e
 * "até alguém lembrar" é o intervalo em que os incidentes acontecem.
 *
 * OIDC e nao SAML: é o que Entra ID, Google Workspace e Okta oferecem hoje,
 * e SAML exige processar XML assinado, que é uma superfície de ataque inteira
 * por conta própria. Se um cliente exigir SAML, é trabalho separado.
 *
 * Sem biblioteca: o Node assina, verifica e importa JWK sozinho. Uma
 * dependência aqui teria acesso ao fluxo de autenticação inteiro, e este
 * projeto já carrega 22 vulnerabilidades herdadas.
 *
 * O QUE É VERIFICADO no token que volta, e cada item já foi um CVE em
 * alguma implementação que pulou ele:
 *
 *   assinatura   contra a chave publicada pelo provedor (JWKS)
 *   alg          RS256 apenas. Aceitar "none" ou HS256 com a chave pública
 *                é o furo clássico de biblioteca de JWT
 *   iss          exatamente o emissor configurado
 *   aud          exatamente o nosso client_id
 *   exp / iat    dentro da validade, com folga pequena de relógio
 *   nonce        o que geramos, uso único: sem isso, token capturado se
 *                reaproveita
 *   state        o que geramos, uso único: sem isso, o retorno aceita ida
 *                que não começou aqui
 *   email        verificado pelo provedor, e no domínio configurado. Sem
 *                isso, um provedor mal configurado afirma qualquer e-mail
 */
const crypto = require('crypto');
const banco = require('./banco.js');

const FOLGA_RELOGIO_S = 60;
const ESTADO_VALE_MS = 10 * 60 * 1000;
const TEMPO_LIMITE_MS = 8000;

/* ---------- utilidades ---------- */

const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

function lerParte(parte) {
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

async function buscarJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || TEMPO_LIMITE_MS) });
  if (!r.ok) throw erro('provedor respondeu ' + r.status + ' em ' + url, 502);
  return r.json();
}

function erro(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  return e;
}

/* ---------- descoberta ---------- */

/* O provedor publica onde ficam as coisas. Guardamos por pouco tempo: girar
 * chave é operação normal do lado do cliente, e cache longo transforma isso
 * numa queda de login que ninguém entende. */
const cacheDescoberta = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function descobrir(issuer) {
  const agora = Date.now();
  const guardado = cacheDescoberta.get(issuer);
  if (guardado && agora < guardado.ate) return guardado.doc;

  const base = String(issuer).replace(/\/+$/, '');
  const doc = await buscarJson(base + '/.well-known/openid-configuration');

  /* O emissor do documento tem que ser o que pedimos. Sem esta checagem, um
   * redirecionamento levaria a descoberta para outro provedor. */
  if (String(doc.issuer || '').replace(/\/+$/, '') !== base) {
    throw erro('o provedor devolveu configuração de outro emissor', 502);
  }
  for (const campo of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!doc[campo]) throw erro('configuração do provedor sem ' + campo, 502);
  }

  cacheDescoberta.set(issuer, { doc, ate: agora + CACHE_MS });
  return doc;
}

async function chavePara(jwksUri, kid) {
  const jwks = await buscarJson(jwksUri);
  const chaves = (jwks && jwks.keys) || [];
  const achada = kid ? chaves.find(k => k.kid === kid) : chaves[0];
  if (!achada) throw erro('o provedor não publica a chave que assinou o token', 502);
  if (achada.kty !== 'RSA') throw erro('chave do provedor não é RSA', 502);
  return crypto.createPublicKey({ key: achada, format: 'jwk' });
}

/* ---------- verificação do token ---------- */

async function verificarIdToken(idToken, { issuer, clientId, jwksUri, nonce }) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw erro('token de identidade malformado', 400);

  let cabecalho, corpo;
  try {
    cabecalho = lerParte(partes[0]);
    corpo = lerParte(partes[1]);
  } catch (e) {
    throw erro('token de identidade ilegível', 400);
  }

  /* Só RS256. "none" e HS256-com-a-chave-pública são os dois furos que
   * derrubaram meia dúzia de bibliotecas de JWT, e os dois passam quando o
   * algoritmo vem do próprio token sem ser conferido. */
  if (cabecalho.alg !== 'RS256') {
    throw erro('algoritmo não aceito: ' + cabecalho.alg, 400);
  }

  const chave = await chavePara(jwksUri, cabecalho.kid);
  const assinado = Buffer.from(partes[0] + '.' + partes[1]);
  const assinatura = Buffer.from(partes[2], 'base64url');
  if (!crypto.verify('RSA-SHA256', assinado, chave, assinatura)) {
    throw erro('assinatura do token não confere', 401);
  }

  const agoraS = Math.floor(Date.now() / 1000);
  const emissor = String(corpo.iss || '').replace(/\/+$/, '');
  if (emissor !== String(issuer).replace(/\/+$/, '')) {
    throw erro('token emitido por outro provedor', 401);
  }
  const audiencia = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!audiencia.includes(clientId)) throw erro('token emitido para outro aplicativo', 401);
  if (!corpo.exp || corpo.exp + FOLGA_RELOGIO_S < agoraS) throw erro('token expirado', 401);
  if (corpo.iat && corpo.iat - FOLGA_RELOGIO_S > agoraS) throw erro('token emitido no futuro', 401);
  if (nonce && corpo.nonce !== nonce) throw erro('nonce não confere', 401);

  return corpo;
}

/* ---------- estado da ida e volta ---------- */

/* state e nonce vivem no banco, de uso único.
 *
 * Em memória parece mais simples e quebra no primeiro segundo processo: a
 * pessoa é mandada para o provedor por uma instância e volta em outra, e o
 * login falha sem explicação. */
function guardarEstado(tenantId, state, nonce, destino) {
  const db = banco.abrir();
  db.prepare(`INSERT INTO sso_estados (state, tenant_id, nonce, destino, criado_em, expira_em)
              VALUES (?,?,?,?,?,?)`)
    .run(state, tenantId, nonce, destino || '/', Date.now(), Date.now() + ESTADO_VALE_MS);
}

function consumirEstado(state) {
  const db = banco.abrir();
  const linha = db.prepare('SELECT * FROM sso_estados WHERE state = ?').get(state);
  /* Some sempre, mesmo vencido: reaproveitar state é o que o uso único
   * existe para impedir. */
  db.prepare('DELETE FROM sso_estados WHERE state = ?').run(state);
  db.prepare('DELETE FROM sso_estados WHERE expira_em < ?').run(Date.now());
  if (!linha) return null;
  if (linha.expira_em < Date.now()) return null;
  return linha;
}

/* ---------- fluxo ---------- */

/** Onde mandar a pessoa, a partir do e-mail que ela digitou. */
async function iniciar(email, urlDeRetorno, destino) {
  const dominio = String(email || '').split('@')[1];
  if (!dominio) throw erro('informe o e-mail da empresa', 400);

  const cfg = banco.ssoPorDominio(dominio.toLowerCase());
  if (!cfg) return null;   // domínio sem SSO: segue pelo caminho de senha

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
  /* Pede a conta da empresa e não a última usada no navegador: sem isto, em
   * máquina compartilhada a pessoa entra como quem usou antes. */
  u.searchParams.set('login_hint', String(email));

  return { url: u.toString(), tenantId: cfg.tenant_id };
}

/** A volta do provedor. Devolve o usuário e a equipe, ou lança. */
async function concluir(code, state, urlDeRetorno) {
  if (!code || !state) throw erro('retorno do provedor incompleto', 400);

  const guardado = consumirEstado(state);
  if (!guardado) throw erro('esta entrada expirou ou já foi usada. Tente de novo.', 400);

  const cfg = banco.ssoDoTenant(guardado.tenant_id);
  if (!cfg) throw erro('esta equipe não tem entrada por provedor configurada', 400);

  const doc = await descobrir(cfg.issuer);

  const corpo = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: urlDeRetorno,
    client_id: cfg.client_id,
    client_secret: banco.ssoSegredo(cfg)
  });

  const r = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: corpo,
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS)
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || !dados.id_token) {
    throw erro('o provedor recusou a troca do código', 401);
  }

  const claims = await verificarIdToken(dados.id_token, {
    issuer: cfg.issuer,
    clientId: cfg.client_id,
    jwksUri: doc.jwks_uri,
    nonce: guardado.nonce
  });

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw erro('o provedor não informou o e-mail', 401);
  /* email_verified ausente é tratado como não verificado. Provedor que não
   * afirma não vale como afirmação. */
  if (claims.email_verified !== true) {
    throw erro('o provedor não confirmou este e-mail', 401);
  }

  /* O domínio TEM que ser o configurado. Sem isto, um provedor mal
   * configurado (ou uma conta pessoal dentro dele) afirma um e-mail de outra
   * empresa e entra na equipe errada. */
  const dominio = email.split('@')[1] || '';
  if (dominio !== String(cfg.dominio).toLowerCase()) {
    throw erro('este e-mail não pertence ao domínio desta equipe', 403);
  }

  return {
    email,
    nome: String(claims.name || '').slice(0, 120),
    tenantId: guardado.tenant_id,
    papel: cfg.papel_padrao || 'consultor',
    destino: guardado.destino || '/'
  };
}

module.exports = {
  iniciar, concluir, descobrir, verificarIdToken,
  guardarEstado, consumirEstado, ESTADO_VALE_MS
};
