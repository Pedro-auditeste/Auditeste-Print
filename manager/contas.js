/* Manager: identidade. Senha, sessao, cookie e freio de forca bruta.
 *
 * Portado do Print. scrypt do proprio Node (KDF de memoria dura, sem
 * compilacao nativa). O token vai para o navegador; o banco guarda so o hash
 * dele, entao vazar o banco nao entrega sessao viva.
 */
const crypto = require('crypto');
const banco = require('./banco.js');

const N = 16384, r = 8, p = 1, TAM = 32;
const DURACAO_MS = Number(process.env.MANAGER_SESSAO_MS) || 12 * 60 * 60 * 1000;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;
const COOKIE = 'manager';

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const chave = crypto.scryptSync(String(senha), sal, TAM, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, sal.toString('base64'), chave.toString('base64')].join('$');
}

/* Tempo fixo na comparacao, e tempo fixo tambem quando o hash esta podre:
 * um formato invalido que retornasse na hora diria quais contas tem hash velho. */
function conferirSenha(senha, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, rr, pp, salB64, chaveB64] = partes;
  let esperado;
  try { esperado = Buffer.from(chaveB64, 'base64'); } catch (e) { return false; }
  if (!esperado.length) return false;
  let obtido;
  try {
    obtido = crypto.scryptSync(String(senha), Buffer.from(salB64, 'base64'), esperado.length,
      { N: Number(n), r: Number(rr), p: Number(pp), maxmem: 64 * 1024 * 1024 });
  } catch (e) { return false; }
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}

const novoToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/* Cadastro sem convite cria uma EQUIPE NOVA, isolada. Nasce sem enxergar nada
 * de ninguem: o teto contra abuso e por conta de quem opera o Manager. */
function cadastrar(req, { email, senha, equipe }) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { const x = new Error('e-mail invalido'); x.status = 400; throw x; }
  if (String(senha || '').length < 8) { const x = new Error('senha muito curta (minimo 8)'); x.status = 400; throw x; }
  if (!String(equipe || '').trim()) { const x = new Error('informe o nome da equipe'); x.status = 400; throw x; }
  if (banco.usuarioPorEmail(e)) { const x = new Error('e-mail ja cadastrado'); x.status = 409; throw x; }
  const tenant = banco.criarTenant(equipe);
  const usuario = banco.criarUsuario(e, hashSenha(senha));
  banco.vincular(tenant.id, usuario.id, 'admin');
  banco.registrar(tenant.id, usuario.id, 'cadastro', 'equipe:' + tenant.nome, ipDe(req));
  return abrirSessao(req, usuario, tenant.id);
}

function entrar(req, { email, senha }) {
  const e = String(email || '').trim().toLowerCase();
  const chave = 'login:' + e;
  if (banco.travado(chave, MAX_TENTATIVAS)) { const x = new Error('conta travada por tentativas. Espere e tente de novo.'); x.status = 429; throw x; }
  const usuario = banco.usuarioPorEmail(e);
  const ok = usuario && conferirSenha(senha, usuario.senha_hash);
  if (!ok) {
    banco.contarFalha(chave, JANELA_TENTATIVAS_MS, MAX_TENTATIVAS);
    const x = new Error('e-mail ou senha invalidos'); x.status = 401; throw x;   // mesma msg dos dois: nao revela se o e-mail existe
  }
  const equipes = banco.equipesDoUsuario(usuario.id);
  if (!equipes.length) { const x = new Error('conta sem equipe'); x.status = 403; throw x; }
  banco.limparFalhas(chave);
  banco.registrar(equipes[0].id, usuario.id, 'entrar', null, ipDe(req));
  return abrirSessao(req, usuario, equipes[0].id);
}

function abrirSessao(req, usuario, tenantId) {
  const token = novoToken();
  banco.criarSessao(usuario.id, tenantId, hashToken(token), DURACAO_MS);
  return { token, cookie: montarCookie(token, req), usuario: { id: usuario.id, email: usuario.email }, tenantId };
}

/* HttpOnly (script nao le), SameSite=Lax (nao vaza em requisicao de terceiro),
 * Secure quando a borda e https. */
function montarCookie(token, req) {
  const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const partes = [COOKIE + '=' + token, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' + Math.floor(DURACAO_MS / 1000)];
  if (https) partes.push('Secure');
  return partes.join('; ');
}

function sessaoDe(req) {
  const bruto = String(req.headers.cookie || '');
  const par = bruto.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!par) return null;
  const token = par.slice(COOKIE.length + 1);
  const s = banco.sessaoValida(hashToken(token));
  if (!s) return null;
  const u = banco.usuarioPorId(s.usuario_id);
  return { usuarioId: s.usuario_id, email: u && u.email, tenantId: s.tenant_id, papel: (banco.vinculo(s.tenant_id, s.usuario_id) || {}).papel, ip: ipDe(req), tokenHash: s.id };
}

function sair(req) {
  const s = sessaoDe(req);
  if (s) { banco.revogarSessao(s.tokenHash); banco.registrar(s.tenantId, s.usuarioId, 'sair', null, s.ip); }
  return { cookie: COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' };
}

const ipDe = req => (req && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || (req && req.socket && req.socket.remoteAddress) || '';

module.exports = { hashSenha, conferirSenha, cadastrar, entrar, sessaoDe, sair, ipDe, COOKIE, DURACAO_MS, MAX_TENTATIVAS };
