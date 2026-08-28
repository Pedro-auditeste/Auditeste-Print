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

/* Quantos proxies confiáveis existem entre o cliente e este processo.
 * Na Railway é um. Zero desliga a leitura do cabeçalho e usa só o socket. */
const PROXIES = Number(process.env.PONTE_PROXIES ?? 1);

/* De quem é este pedido, e a resposta não pode vir de quem está pedindo.
 *
 * X-Forwarded-For é uma LISTA que cada proxy acrescenta, e não substitui:
 * quem chama escreve o primeiro item, o proxy da frente escreve o seguinte.
 * Ler o primeiro era ler o que o cliente digitou, e era esse valor que
 * contava no teto por origem, no limite de equipes por IP e na linha do
 * log de auditoria. Dava para varrer à vontade trocando o cabeçalho, e para
 * assinar cada ação com o endereço de outra pessoa.
 *
 * Com N proxies confiáveis na frente, o endereço real é o N-ésimo de trás
 * para frente: tudo à esquerda dele foi escrito por quem chamou. */
function ipDe(req) {
  const soquete = req.socket.remoteAddress || '';
  if (PROXIES < 1) return soquete;
  const lista = String(req.headers['x-forwarded-for'] || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!lista.length) return soquete;
  return lista[Math.max(0, lista.length - PROXIES)] || soquete;
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

/* ---------- cadastro ---------- */

const SENHA_MINIMA = 10;
const CADASTRO_ABERTO = String(process.env.COFRE_CADASTRO || 'aberto').toLowerCase() !== 'fechado';
const MAX_EQUIPES_POR_IP = Number(process.env.COFRE_MAX_EQUIPES_IP) || 5;

const novoCodigo = () => crypto.randomBytes(18).toString('base64url');

/* Criar conta.
 *
 * Duas portas, e a diferenca entre elas e o coracao do isolamento:
 *
 *   sem convite  -> nasce uma EQUIPE NOVA, e a pessoa vira admin dela. Nao
 *                   ha como escolher entrar numa equipe existente digitando
 *                   o nome: se houvesse, "cadastrar" seria o caminho para
 *                   ver a evidencia de outro cliente, que e o furo que o
 *                   tenant existe para fechar;
 *   com convite  -> entra na equipe do convite, com o papel que o convite
 *                   define, e o codigo queima no uso.
 *
 * Ou seja: ninguem entra na equipe da Amazon sem alguem da Amazon convidar. */
function cadastrar(req, dados) {
  const email = String(dados.email || '').trim().toLowerCase();
  const senha = String(dados.senha || '');
  const codigo = String(dados.convite || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const e = new Error('Informe um e-mail válido.');
    e.status = 400;
    throw e;
  }
  if (senha.length < SENHA_MINIMA) {
    const e = new Error('A senha precisa de pelo menos ' + SENHA_MINIMA + ' caracteres.');
    e.status = 400;
    throw e;
  }

  /* Freio por origem, e SO para quem cria equipe nova.
   *
   * A primeira versao contava todo cadastro, inclusive os com convite, e o
   * teste mostrou o efeito: um escritorio inteiro atras de um IP so travava
   * na sexta pessoa a entrar. Quem chega com convite ja passou pelo portao
   * de verdade, que e um codigo de uso unico gerado por alguem de dentro.
   * O que precisa de freio e a porta aberta: criar equipe sem nada. */
  const chaveIp = 'cadastro:' + ipDe(req);

  let convite = null;
  if (codigo) {
    convite = banco.convitePorHash(hashToken(codigo));
    if (!convite) {
      const e = new Error('Convite inválido, já usado ou vencido.');
      e.status = 400;
      throw e;
    }
  } else {
    if (banco.tentativasDe(chaveIp) >= MAX_EQUIPES_POR_IP) {
      const e = new Error('Muitas equipes criadas daqui. Tente de novo mais tarde.');
      e.status = 429;
      throw e;
    }
    if (!CADASTRO_ABERTO) {
      const e = new Error('Cadastro aberto está desligado. Peça um convite a quem já usa o sistema.');
      e.status = 403;
      throw e;
    }
    if (!String(dados.equipe || '').trim()) {
      const e = new Error('Informe o nome da equipe.');
      e.status = 400;
      throw e;
    }
  }

  /* E-mail repetido responde igual a qualquer outro erro de cadastro? Nao:
   * aqui a pessoa PRECISA saber que ja tem conta, senao fica travada sem
   * entender. O que existe de verdade a proteger e a senha, nao a lista de
   * quem se cadastrou num sistema em que qualquer um pode se cadastrar. */
  if (banco.usuarioPorEmail(email)) {
    if (!convite) banco.tentativaFalhou(chaveIp, JANELA_TENTATIVAS_MS);
    const e = new Error('Já existe uma conta com este e-mail. Use Entrar.');
    e.status = 409;
    throw e;
  }

  const r = banco.cadastrar({
    email, senhaHash: hashSenha(senha),
    equipe: String(dados.equipe || '').trim(), convite
  });

  if (!convite) banco.tentativaFalhou(chaveIp, JANELA_TENTATIVAS_MS);
  banco.auditar(r.tenantId, r.usuario.id,
    convite ? 'conta.criada_por_convite' : 'equipe.criada',
    email + ' como ' + r.papel, ipDe(req));

  const token = novoToken();
  banco.criarSessao(hashToken(token), r.usuario.id, r.tenantId, DURACAO_MS);
  return {
    token,
    cookie: cookieSessao(req, token, DURACAO_MS),
    sessao: {
      email, tenantId: r.tenantId, tenantNome: r.tenantNome, papel: r.papel,
      clientes: [{ id: r.tenantId, nome: r.tenantNome }]
    }
  };
}

/* Trocar de equipe sem sair e entrar de novo. So faz sentido depois dos
 * convites: antes disso ninguem pertencia a duas. */
/* Um usuario logado cria uma equipe nova, isolada, da qual vira admin, e a
 * sessao ja passa para ela. So os membros dela a enxergam, como qualquer
 * equipe. O nome unico e garantido pelo banco (criarTenant lanca 409). */
function criarEquipe(req, sessaoAtual, nome) {
  const n = String(nome || '').trim();
  if (n.length < 2) {
    const e = new Error('O nome da equipe precisa de pelo menos 2 caracteres.');
    e.status = 400;
    throw e;
  }
  const t = banco.criarTenant(n, 90);
  banco.vincular(t.id, sessaoAtual.usuarioId, 'admin');
  banco.auditar(t.id, sessaoAtual.usuarioId, 'equipe.criada', n, ipDe(req));

  banco.revogarSessao(sessaoAtual.tokenHash);
  const token = novoToken();
  banco.criarSessao(hashToken(token), sessaoAtual.usuarioId, t.id, DURACAO_MS);
  return {
    cookie: cookieSessao(req, token, DURACAO_MS),
    sessao: { email: sessaoAtual.email, tenantId: t.id, tenantNome: t.nome, papel: 'admin' }
  };
}

function trocarEquipe(req, sessaoAtual, tenantId) {
  const acesso = banco.acessoA(tenantId, sessaoAtual.usuarioId);
  if (!acesso) {
    const e = new Error('Você não faz parte desta equipe.');
    e.status = 403;
    throw e;
  }
  banco.revogarSessao(sessaoAtual.tokenHash);
  const token = novoToken();
  banco.criarSessao(hashToken(token), sessaoAtual.usuarioId, tenantId, DURACAO_MS);
  const t = banco.obterTenant(tenantId);

  /* Entrada da consultoria num cliente e evento distinto, e fica na
   * auditoria DO CLIENTE. O cliente precisa conseguir ver quem entrou na
   * casa dele; um "equipe.trocada" generico esconderia isso. */
  banco.auditar(tenantId, sessaoAtual.usuarioId,
    acesso.via === 'provedor' ? 'equipe.acessada_pela_provedora' : 'equipe.trocada',
    (t ? t.nome : tenantId) + (acesso.via === 'provedor' ? ' · via ' + acesso.provedorNome : ''),
    ipDe(req));

  return {
    cookie: cookieSessao(req, token, DURACAO_MS),
    sessao: { tenantId, tenantNome: t ? t.nome : '', papel: acesso.papel, via: acesso.via }
  };
}

/* Entrada vinda do provedor de identidade.
 *
 * Cria a conta no primeiro acesso (JIT provisioning). E o comportamento
 * esperado de SSO, e e o que faz ele valer a pena: quem o provedor da empresa
 * afirma que existe, existe; quem ele para de afirmar, para de entrar. Exigir
 * cadastro previo aqui devolveria o trabalho manual que o SSO veio tirar.
 *
 * A senha local nasce impossivel: quem entra por provedor nao tem senha, e
 * uma senha em branco ou previsivel seria uma segunda porta sem tranca. */
function entrarPorProvedor(req, dados) {
  const email = String(dados.email || '').trim().toLowerCase();
  if (!email) {
    const e = new Error('O provedor não informou o e-mail.');
    e.status = 401;
    throw e;
  }

  let usuario = banco.usuarioPorEmail(email);
  let novo = false;
  if (!usuario) {
    usuario = banco.criarUsuario(email, hashSenha(crypto.randomBytes(32).toString('hex')));
    novo = true;
  }

  /* Vinculo tambem no primeiro acesso, com o papel que a configuracao define.
   * Se a pessoa ja pertence a equipe, o papel dela e mantido: rebaixar quem
   * foi promovido a mao, toda vez que entra, seria surpresa cara. */
  if (!banco.vinculo(dados.tenantId, usuario.id)) {
    banco.vincular(dados.tenantId, usuario.id, dados.papel || 'consultor');
  }

  banco.marcarAcesso(usuario.id);
  const token = novoToken();
  banco.criarSessao(hashToken(token), usuario.id, dados.tenantId, DURACAO_MS);
  banco.auditar(dados.tenantId, usuario.id,
    novo ? 'login.provedor_primeiro_acesso' : 'login.provedor', email, ipDe(req));

  const t = banco.obterTenant(dados.tenantId);
  return {
    cookie: cookieSessao(req, token, DURACAO_MS),
    sessao: {
      email,
      tenantId: dados.tenantId,
      tenantNome: t ? t.nome : '',
      papel: banco.vinculo(dados.tenantId, usuario.id).papel
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
  /* Um lugar so decide se este usuario alcanca esta equipe: por vinculo
   * direto, ou por ser da provedora. Perder o acesso derruba a sessao na
   * hora, senao tirar alguem do cliente so teria efeito no proximo login,
   * que pode nunca acontecer. */
  const acesso = banco.acessoA(s.tenant_id, s.usuario_id);
  if (!acesso) return null;
  const t = banco.obterTenant(s.tenant_id);
  return {
    tokenHash: s.id,
    usuarioId: usuario.id,
    email: usuario.email,
    tenantId: s.tenant_id,
    tenantNome: t ? t.nome : '',
    retencaoDias: t ? t.retencao_dias : 90,
    papel: acesso.papel,
    via: acesso.via,
    provedorNome: acesso.provedorNome || '',
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
  hashSenha, conferirSenha, entrar, cadastrar, entrarPorProvedor, criarEquipe, trocarEquipe, sair, sessaoDe, podeOuErro,
  novoCodigo, SENHA_MINIMA, CADASTRO_ABERTO, MAX_EQUIPES_POR_IP,
  lerCookie, cookieLimpo, ipDe, hashToken, novoToken,
  COOKIE, DURACAO_MS, MAX_TENTATIVAS, PAPEIS
};
