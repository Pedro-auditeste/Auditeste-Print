/* Trace: o banco.
 *
 * Nucleo de seguranca portado do Print (cofre de evidencias) e completo:
 * isolamento por cliente, identidade, papeis, auditoria, cifra em repouso,
 * link assinado, retencao e exclusao segura, freio de forca bruta, SSO (OIDC)
 * e backup conferido. O dominio do produto entra em cima desta base, no lugar
 * do recurso de exemplo.
 *
 *   TRACE_BANCO    caminho do arquivo. Em producao, apontar para um volume.
 *   TRACE_CHAVE    hex de 64 para a cifra em repouso. Ausente = grava em claro.
 *   TRACE_SEGREDO  hex para assinar link temporario. Ausente = link desligado.
 *
 * Regra que vale mais que o esquema: NENHUMA funcao aceita ser chamada sem
 * tenant. O isolamento e argumento obrigatorio, nao checagem que se esquece.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* Node < 22 */ }

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  retencao_dias INTEGER NOT NULL DEFAULT 90,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  ultimo_acesso INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  papel TEXT NOT NULL DEFAULT 'consultor',
  UNIQUE(tenant_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  criada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  revogada_em INTEGER
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  usuario_id TEXT,
  acao TEXT NOT NULL,
  recurso TEXT,
  ip TEXT,
  quando INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tentativas (
  chave TEXT PRIMARY KEY,
  contagem INTEGER NOT NULL,
  ate INTEGER NOT NULL
);

/* Recurso de exemplo, tenant-scoped, corpo cifrado, com prazo de validade e
 * estado. Existe para o isolamento, a auditoria, a cifra, o link assinado, a
 * retencao e a exclusao terem algo real para proteger. Trocar pelo dominio. */
CREATE TABLE IF NOT EXISTS recursos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'text/plain',
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  corpo BLOB NOT NULL,
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ativo',
  criado_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sso (
  tenant_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret BLOB NOT NULL,
  dominio TEXT NOT NULL UNIQUE,
  papel_padrao TEXT NOT NULL DEFAULT 'consultor',
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sso_estados (
  state TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  destino TEXT,
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_memb_usuario ON memberships(usuario_id);
CREATE INDEX IF NOT EXISTS ix_rec_tenant ON recursos(tenant_id);
CREATE INDEX IF NOT EXISTS ix_rec_expira ON recursos(expira_em);
CREATE INDEX IF NOT EXISTS ix_audit ON auditoria(tenant_id, quando);
`;

let db = null;
let motivoDesligado = '';
let semVolume = false;
let ondeEstou = '';
const VOLUMES = ['/dados', '/data'];

function caminhoPadrao() {
  for (const v of VOLUMES) {
    try {
      if (fs.existsSync(v) && fs.statSync(v).isDirectory()) { semVolume = false; ondeEstou = path.join(v, 'trace.db'); return ondeEstou; }
    } catch (e) { /* tenta o proximo */ }
  }
  semVolume = true;
  ondeEstou = path.join(__dirname, 'dados', 'trace.db');
  return ondeEstou;
}

const efemero = () => semVolume;
const onde = () => ondeEstou;
const id = () => crypto.randomUUID();
const agora = () => Date.now();

function abrir(caminho) {
  if (db) return db;
  if (!DatabaseSync) { motivoDesligado = 'este Node nao tem node:sqlite (precisa de 22 ou mais novo)'; return null; }
  const arquivo = caminho || process.env.TRACE_BANCO || caminhoPadrao();
  if (caminho || process.env.TRACE_BANCO) {
    ondeEstou = arquivo;
    semVolume = !VOLUMES.some(v => path.resolve(arquivo).replace(/\\/g, '/').startsWith(v + '/'));
  }
  try {
    if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true });
    db = new DatabaseSync(arquivo);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(ESQUEMA);
    motivoDesligado = '';
    return db;
  } catch (err) { motivoDesligado = 'nao consegui abrir ' + arquivo + ': ' + err.message; db = null; return null; }
}

const ligado = () => !!db;
const porque = () => motivoDesligado;
function fechar() { if (db) { db.close(); db = null; } }

function exigir() { if (!db) { const e = new Error('Trace desligado: ' + (motivoDesligado || 'sem banco')); e.status = 503; throw e; } return db; }

function exigirTenant(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') { const e = new Error('consulta sem tenant no contexto'); e.status = 500; throw e; }
  return tenantId;
}

/* ---------- papeis ---------- */
/* Ordem de poder. Ninguem age acima do proprio papel, e ninguem convida para
 * papel acima do proprio. */
const PAPEIS = ['leitor', 'consultor', 'gestor', 'admin'];
const nivel = papel => Math.max(0, PAPEIS.indexOf(papel));
const podeGravar = papel => nivel(papel) >= nivel('consultor');
const podeExcluir = papel => nivel(papel) >= nivel('gestor');
const podeAdministrar = papel => papel === 'admin';

/* ---------- tenants, usuarios, vinculos ---------- */

function criarTenant(nome, retencaoDias) {
  exigir();
  const n = String(nome || '').trim();
  if (!n) { const e = new Error('nome da equipe vazio'); e.status = 400; throw e; }
  if (db.prepare('SELECT id FROM tenants WHERE lower(nome) = lower(?)').get(n)) { const e = new Error('ja existe uma equipe com esse nome'); e.status = 409; throw e; }
  const rd = Number(retencaoDias);
  const t = { id: id(), nome: n, retencao_dias: Number.isFinite(rd) && rd >= 0 ? rd : 90, criado_em: agora() };
  db.prepare('INSERT INTO tenants (id, nome, retencao_dias, criado_em) VALUES (?, ?, ?, ?)').run(t.id, t.nome, t.retencao_dias, t.criado_em);
  return t;
}

const obterTenant = tid => (exigir(), db.prepare('SELECT * FROM tenants WHERE id = ?').get(exigirTenant(tid)) || null);
const tenantPorNome = nome => (exigir(), db.prepare('SELECT * FROM tenants WHERE lower(nome) = lower(?)').get(String(nome || '')) || null);

function criarUsuario(email, senhaHash) {
  exigir();
  const e = String(email || '').trim().toLowerCase();
  const u = { id: id(), email: e, senha_hash: senhaHash, criado_em: agora() };
  db.prepare('INSERT INTO usuarios (id, email, senha_hash, criado_em) VALUES (?, ?, ?, ?)').run(u.id, u.email, u.senha_hash, u.criado_em);
  return u;
}

const usuarioPorEmail = email => (exigir(), db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email || '').trim().toLowerCase()) || null);
const usuarioPorId = uid => (exigir(), db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid) || null);

function vincular(tenantId, usuarioId, papel) {
  exigirTenant(tenantId); exigir();
  db.prepare('INSERT OR IGNORE INTO memberships (id, tenant_id, usuario_id, papel) VALUES (?, ?, ?, ?)').run(id(), tenantId, usuarioId, papel || 'consultor');
  return vinculo(tenantId, usuarioId);
}

const vinculo = (tenantId, usuarioId) => (exigirTenant(tenantId), exigir(), db.prepare('SELECT * FROM memberships WHERE tenant_id = ? AND usuario_id = ?').get(tenantId, usuarioId) || null);
const desvincular = (tenantId, usuarioId) => (exigirTenant(tenantId), exigir(), db.prepare('DELETE FROM memberships WHERE tenant_id = ? AND usuario_id = ?').run(tenantId, usuarioId));
const equipesDoUsuario = usuarioId => (exigir(), db.prepare(`SELECT t.id, t.nome, m.papel FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.usuario_id = ? ORDER BY t.nome`).all(usuarioId));

/* ---------- sessoes ---------- */

function criarSessao(usuarioId, tenantId, sessaoIdHash, duracaoMs) {
  exigirTenant(tenantId); exigir();
  const s = { id: sessaoIdHash, usuario_id: usuarioId, tenant_id: tenantId, criada_em: agora(), expira_em: agora() + duracaoMs };
  db.prepare('INSERT INTO sessoes (id, usuario_id, tenant_id, criada_em, expira_em) VALUES (?, ?, ?, ?, ?)').run(s.id, s.usuario_id, s.tenant_id, s.criada_em, s.expira_em);
  return s;
}

function sessaoValida(sessaoIdHash) {
  exigir();
  const s = db.prepare('SELECT * FROM sessoes WHERE id = ?').get(sessaoIdHash);
  if (!s || s.revogada_em || s.expira_em < agora()) return null;
  if (!vinculo(s.tenant_id, s.usuario_id)) return null;   // tirar da equipe derruba a sessao na hora
  return s;
}
const revogarSessao = sessaoIdHash => (exigir(), db.prepare('UPDATE sessoes SET revogada_em = ? WHERE id = ? AND revogada_em IS NULL').run(agora(), sessaoIdHash));

/* ---------- auditoria ---------- */

function registrar(tenantId, usuarioId, acao, recurso, ip) {
  exigir();
  db.prepare('INSERT INTO auditoria (tenant_id, usuario_id, acao, recurso, ip, quando) VALUES (?, ?, ?, ?, ?, ?)').run(tenantId || null, usuarioId || null, acao, recurso || null, ip || null, agora());
}
const listarAuditoria = tenantId => (exigirTenant(tenantId), exigir(), db.prepare('SELECT acao, recurso, usuario_id, quando FROM auditoria WHERE tenant_id = ? ORDER BY quando DESC LIMIT 500').all(tenantId));

/* ---------- freio de forca bruta ---------- */

function contarFalha(chave, janelaMs, max) {
  exigir();
  const t = db.prepare('SELECT contagem, ate FROM tentativas WHERE chave = ?').get(chave);
  if (!t || t.ate < agora()) { db.prepare('INSERT OR REPLACE INTO tentativas (chave, contagem, ate) VALUES (?, 1, ?)').run(chave, agora() + janelaMs); return { travado: false, restam: max - 1 }; }
  const nova = t.contagem + 1;
  db.prepare('UPDATE tentativas SET contagem = ? WHERE chave = ?').run(nova, chave);
  return { travado: nova >= max, restam: Math.max(0, max - nova) };
}
const travado = (chave, max) => { exigir(); const t = db.prepare('SELECT contagem, ate FROM tentativas WHERE chave = ?').get(chave); return !!(t && t.ate >= agora() && t.contagem >= max); };
const limparFalhas = chave => (exigir(), db.prepare('DELETE FROM tentativas WHERE chave = ?').run(chave));

/* ---------- cifra do corpo em repouso ---------- */

const CIFRA = 'aes-256-gcm';
const MARCA = Buffer.from('AUDIENC1');

function chaveDaCifra() {
  const bruta = String(process.env.TRACE_CHAVE || '').trim();
  if (!bruta) return null;
  if (/^[0-9a-f]{64}$/i.test(bruta)) return Buffer.from(bruta, 'hex');
  return crypto.createHash('sha256').update(bruta).digest();
}
const cifraLigada = () => chaveDaCifra() !== null;

function cifrar(buf) {
  const chave = chaveDaCifra();
  if (!chave) return buf;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(CIFRA, chave, iv);
  const corpo = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MARCA, iv, c.getAuthTag(), corpo]);
}
function decifrar(dados) {
  const buf = Buffer.from(dados);
  if (buf.length < MARCA.length || !buf.subarray(0, MARCA.length).equals(MARCA)) return buf;
  const chave = chaveDaCifra();
  if (!chave) { const e = new Error('Conteudo cifrado e TRACE_CHAVE nao esta definida.'); e.status = 503; throw e; }
  const iv = buf.subarray(8, 20); const tag = buf.subarray(20, 36);
  const d = crypto.createDecipheriv(CIFRA, chave, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(36)), d.final()]);
}

/* ---------- link assinado (acesso ao corpo sem sessao, por pouco tempo) ---------- */
/* HMAC sobre tenant, recurso e validade. Trocar qualquer parte no endereco
 * invalida a assinatura. Sem TRACE_SEGREDO, nao emite link. */
function segredoLink() { const s = String(process.env.TRACE_SEGREDO || '').trim(); return s ? crypto.createHash('sha256').update(s).digest() : null; }
const linkLigado = () => segredoLink() !== null;

function assinarLink(tenantId, recursoId, ttlMs) {
  const seg = segredoLink();
  if (!seg) { const e = new Error('link desligado: defina TRACE_SEGREDO'); e.status = 503; throw e; }
  const exp = agora() + (Number(ttlMs) || 5 * 60 * 1000);
  const base = tenantId + ':' + recursoId + ':' + exp;
  const sig = crypto.createHmac('sha256', seg).update(base).digest('hex');
  return { t: tenantId, r: recursoId, exp, sig };
}
function validarLink({ t, r, exp, sig }) {
  const seg = segredoLink();
  if (!seg || !t || !r || !exp || !sig) return null;
  if (Number(exp) < agora()) return null;
  const base = t + ':' + r + ':' + exp;
  const bom = crypto.createHmac('sha256', seg).update(base).digest('hex');
  const a = Buffer.from(sig); const b = Buffer.from(bom);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tenantId: t, recursoId: r };
}

/* ---------- recurso de exemplo (tenant-scoped, com ciclo de vida) ---------- */

const TIPOS_OK = ['text/plain', 'application/json', 'application/pdf', 'image/png', 'image/jpeg'];

function criarRecurso(tenantId, usuarioId, nome, conteudo, tipo) {
  exigirTenant(tenantId); exigir();
  const t = String(tipo || 'text/plain');
  if (!TIPOS_OK.includes(t)) { const e = new Error('tipo de conteudo nao permitido: ' + t); e.status = 415; throw e; }
  const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo || ''), 'utf8');
  if (buffer.length > 5 * 1024 * 1024) { const e = new Error('conteudo grande demais (max 5 MB)'); e.status = 413; throw e; }
  const tenant = obterTenant(tenantId);
  const dias = tenant && Number.isFinite(tenant.retencao_dias) ? tenant.retencao_dias : 90;
  const r = {
    id: id(), tenant_id: tenantId, nome: String(nome || 'sem nome'), tipo: t,
    bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    criado_em: agora(), expira_em: agora() + dias * 86400000, estado: 'ativo', criado_por: usuarioId
  };
  db.prepare('INSERT INTO recursos (id, tenant_id, nome, tipo, bytes, sha256, corpo, criado_em, expira_em, estado, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.tenant_id, r.nome, r.tipo, r.bytes, r.sha256, cifrar(buffer), r.criado_em, r.expira_em, r.estado, r.criado_por);
  return r;
}

const listarRecursos = tenantId => (exigirTenant(tenantId), exigir(),
  db.prepare("SELECT id, nome, tipo, bytes, sha256, criado_em, expira_em FROM recursos WHERE tenant_id = ? AND estado = 'ativo' AND expira_em > ? ORDER BY criado_em DESC").all(tenantId, agora()));

function obterRecurso(tenantId, recursoId) {
  exigirTenant(tenantId); exigir();
  const r = db.prepare("SELECT * FROM recursos WHERE tenant_id = ? AND id = ? AND estado = 'ativo' AND expira_em > ?").get(tenantId, recursoId, agora());
  if (!r) return null;
  r.corpo = decifrar(r.corpo);
  return r;
}

/* Exclusao segura: some o metadado e o corpo juntos, na mesma transacao. */
function excluirRecurso(tenantId, recursoId) {
  exigirTenant(tenantId); exigir();
  const r = db.prepare('DELETE FROM recursos WHERE tenant_id = ? AND id = ?').run(tenantId, recursoId);
  return r.changes > 0;
}

/* Poda por prazo: o que venceu sai de vez, com o corpo junto. Roda na leitura
 * e pode rodar por agendamento. */
function podarVencidos() {
  exigir();
  const r = db.prepare('DELETE FROM recursos WHERE expira_em <= ?').run(agora());
  return { removidos: r.changes };
}

/* ---------- SSO (OIDC): configuracao ---------- */

function ssoConfigurar(tenantId, { issuer, clientId, clientSecret, dominio, papelPadrao }) {
  exigirTenant(tenantId); exigir();
  db.prepare(`INSERT OR REPLACE INTO sso (tenant_id, issuer, client_id, client_secret, dominio, papel_padrao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(tenantId, String(issuer), String(clientId), cifrar(Buffer.from(String(clientSecret), 'utf8')), String(dominio).toLowerCase(), papelPadrao || 'consultor', agora());
  return ssoDoTenant(tenantId);
}
const ssoDoTenant = tenantId => (exigir(), db.prepare('SELECT * FROM sso WHERE tenant_id = ?').get(exigirTenant(tenantId)) || null);
const ssoPorDominio = dominio => (exigir(), db.prepare('SELECT * FROM sso WHERE dominio = ?').get(String(dominio || '').toLowerCase()) || null);
const ssoSegredo = cfg => decifrar(cfg.client_secret).toString('utf8');

/* ---------- backup ---------- */

function snapshot(destino) {
  exigir();
  if (fs.existsSync(destino)) { const e = new Error('destino ja existe: ' + destino); e.status = 409; throw e; }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec("VACUUM INTO '" + String(destino).replace(/'/g, "''") + "'");
  return destino;
}

function conferirArquivo(caminho) {
  if (!DatabaseSync) throw new Error('sem node:sqlite');
  if (!fs.existsSync(caminho)) { const e = new Error('arquivo nao existe: ' + caminho); e.status = 404; throw e; }
  const outro = new DatabaseSync(caminho, { readOnly: true });
  try {
    const integridade = outro.prepare('PRAGMA integrity_check').get();
    const veredito = integridade && (integridade.integrity_check || Object.values(integridade)[0]);
    if (veredito !== 'ok') { const e = new Error('arquivo corrompido ou nao e um banco'); e.status = 422; throw e; }
    const conta = {};
    for (const t of ['tenants', 'usuarios', 'recursos', 'auditoria']) {
      try { conta[t] = outro.prepare('SELECT count(*) n FROM ' + t).get().n; }
      catch (e) { const err = new Error('arquivo nao tem cara de Trace (falta ' + t + ')'); err.status = 422; throw err; }
    }
    return conta;
  } finally { outro.close(); }
}

module.exports = {
  abrir, fechar, exigir, exigirTenant, ligado, porque, onde, efemero, agora, id,
  PAPEIS, nivel, podeGravar, podeExcluir, podeAdministrar,
  criarTenant, obterTenant, tenantPorNome,
  criarUsuario, usuarioPorEmail, usuarioPorId,
  vincular, vinculo, desvincular, equipesDoUsuario,
  criarSessao, sessaoValida, revogarSessao,
  registrar, listarAuditoria,
  contarFalha, travado, limparFalhas,
  cifraLigada, cifrar, decifrar,
  linkLigado, assinarLink, validarLink,
  criarRecurso, listarRecursos, obterRecurso, excluirRecurso, podarVencidos, TIPOS_OK,
  ssoConfigurar, ssoDoTenant, ssoPorDominio, ssoSegredo,
  snapshot, conferirArquivo,
};
