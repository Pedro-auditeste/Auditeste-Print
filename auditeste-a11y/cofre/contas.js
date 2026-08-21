/* Identidade do cofre: senha, sessão, cookie e freio de força bruta.
 *
 * scrypt do próprio Node, não bcrypt/argon2. Os dois exigem compilação
 * nativa dentro da imagem, e scrypt é um KDF de memória dura de verdade,
 * recomendado para senha. Trocar por argon2 depois é possível: o hash
 * carrega o algoritmo no prefixo, então convivem.
 */
const crypto = require('crypto');
const banco = require('./banco.js');

const N = 16384, r = 8, p = 1, TAM = 32;
const DURACAO_MS = Number(process.env.COFRE_SESSAO_MS) || 12 * 60 * 60 * 1000;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;
const COOKIE = 'cofre';

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const chave = crypto.scryptSync(String(senha), sal, TAM, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, sal.toString('base64'), chave.toString('base64')].join('$');
}

/* Tempo fixo na comparação, e tempo fixo TAMBÉM quando o hash está podre:
 * um formato inválido que retornasse na hora diria ao atacante quais contas
 * têm hash antigo. */
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

/* O token vai para o navegador; o banco guarda só o hash dele. Vazar uma
 * cópia do banco não pode entregar sessão viva de ninguém. */
const novoToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function httpsNaBorda(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

/* Secure só quando a borda é https: marcar Secure em http faz o navegador
 * descartar o cookie, e o login em 127.0.0.1 nunca completaria. */
function cookieSessao(req, token, maxIdade) {
  const partes = [
    COOKIE + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(maxIdade / 1000)
  ];
  if (httpsNaBorda(req)) partes.push('Secure');
  return partes.join('; ');
}

const cookieLimpo = req => cookieSessao(req, '', 0);

function ipDe(req) {
  const enc = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return enc || req.socket.remoteAddress || '';
}

/* ---------- entrar e sair ---------- */

function entrar(req, email, senha, tenantPedido) {
  const alvo = String(email || '').trim().toLowerCase();
  const chave = 'login:' + alvo;

  if (banco.tentativasDe(chave) >= MAX_TENTATIVAS) {
    const e = new Error('Muitas tentativas. Espere alguns minutos e tente de novo.');
    e.status = 429;
    throw e;
  }

  const usuario = banco.usuarioPorEmail(alvo);
  /* Confere a senha mesmo sem usuário, contra um hash descartável: sem isso o
   * tempo de resposta diz quais e-mails existem. */
  const guardado = usuario ? usuario.senha_hash : HASH_ISCA;
  const senhaOk = conferirSenha(senha, guardado);

  if (!usuario || !senhaOk) {
    banco.tentativaFalhou(chave, JANELA_TENTATIVAS_MS);
    banco.auditar(null, usuario ? usuario.id : null, 'login.falhou', alvo, ipDe(req));
    const e = new Error('E-mail ou senha inválidos.');
    e.status = 401;
    throw e;
  }

  const vinculos = banco.vinculosDoUsuario(usuario.id);
  if (!vinculos.length) {
    const e = new Error('Esta conta não está vinculada a nenhum cliente.');
    e.status = 403;
    throw e;
  }
  const escolhido = tenantPedido
    ? vinculos.find(v => v.tenant_id === tenantPedido)
    : vinculos[0];
  if (!escolhido) {
    const e = new Error('Você não tem acesso a este cliente.');
    e.status = 403;
    throw e;
  }

  banco.limparTentativas(chave);
  banco.marcarAcesso(usuario.id);

  const token = novoToken();
  banco.criarSessao(hashToken(token), usuario.id, escolhido.tenant_id, DURACAO_MS);
  banco.auditar(escolhido.tenant_id, usuario.id, 'login', alvo, ipDe(req));

  return {
    token,
    cookie: cookieSessao(req, token, DURACAO_MS),
    sessao: {
      email: usuario.email,
      tenantId: escolhido.tenant_id,
      tenantNome: escolhido.tenant_nome,
      papel: escolhido.papel,
      clientes: vinculos.map(v => ({ id: v.tenant_id, nome: v.tenant_nome }))
    }
  };
}

function sair(req) {
  const token = lerCookie(req, COOKIE);
  if (token) {
    const s = banco.obterSessao(hashToken(token));
    if (s) {
      banco.revogarSessao(hashToken(token));
      banco.auditar(s.tenant_id, s.usuario_id, 'logout', null, ipDe(req));
    }
  }
  return cookieLimpo(req);
}

/* Quem sou eu, segundo o SERVIDOR.
 *
 * O tenant sai daqui e de nenhum outro lugar. Aceitar tenant vindo do corpo
 * ou da query seria devolver ao cliente a chave do isolamento. */
function sessaoDe(req) {
  const token = lerCookie(req, COOKIE);
  if (!token) return null;
  const s = banco.obterSessao(hashToken(token));
  if (!s) return null;
  const usuario = banco.usuarioPorId(s.usuario_id);
  if (!usuario) return null;
  const v = banco.vinculo(s.tenant_id, s.usuario_id);
  /* Vínculo removido derruba a sessão na hora: sem isto, tirar alguém do
   * cliente só teria efeito no próximo login, que pode nunca acontecer. */
  if (!v) return null;
  const t = banco.obterTenant(s.tenant_id);
  return {
    tokenHash: s.id,
    usuarioId: usuario.id,
    email: usuario.email,
    tenantId: s.tenant_id,
    tenantNome: t ? t.nome : '',
    retencaoDias: t ? t.retencao_dias : 90,
    papel: v.papel,
    ip: ipDe(req)
  };
}

const PAPEIS = { leitor: 1, consultor: 2, gestor: 3, admin: 4 };

function podeOuErro(sessao, papelMinimo) {
  const tem = PAPEIS[sessao.papel] || 0;
  const precisa = PAPEIS[papelMinimo] || 0;
  if (tem >= precisa) return true;
  const e = new Error('Seu papel (' + sessao.papel + ') não permite esta ação.');
  e.status = 403;
  throw e;
}

/* Hash de uma senha que ninguém tem, gerado uma vez na subida, só para dar
 * trabalho igual ao login de e-mail inexistente. */
const HASH_ISCA = hashSenha(crypto.randomBytes(32).toString('hex'));

module.exports = {
  hashSenha, conferirSenha, entrar, sair, sessaoDe, podeOuErro,
  lerCookie, cookieLimpo, ipDe, hashToken, novoToken,
  COOKIE, DURACAO_MS, MAX_TENTATIVAS, PAPEIS
};
