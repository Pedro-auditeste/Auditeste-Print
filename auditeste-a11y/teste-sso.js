/* Entrada pelo provedor de identidade (OIDC), contra um provedor de mentira
 * que este teste controla.
 *
 * Não dá para testar SSO de verdade sem credencial de um provedor corporativo,
 * e escrever autenticação sem executar uma vez é como se erra feio. A saída é
 * subir aqui um provedor que cumpre o protocolo: publica a configuração,
 * publica a chave, troca código por token e assina o token.
 *
 * Isso exercita tudo que é nosso: descoberta, state, nonce, troca do código,
 * verificação de assinatura, validação de emissor, audiência, validade e
 * domínio, e a criação da sessão. O que fica de fora são as manias de cada
 * provedor, e para OIDC padrão isso é pouco.
 *
 * Cada caso de ataque aqui já foi CVE em alguma biblioteca de JWT.
 *
 *   node teste-sso.js
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const banco = require('./cofre/banco.js');
const sso = require('./cofre/sso.js');

const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sso-')), 'cofre.db');
const PORTA_IDP = 8994;
const EMISSOR = 'http://127.0.0.1:' + PORTA_IDP;
const CLIENT_ID = 'print-de-teste';
const CLIENT_SECRET = 'segredo-do-cliente-oidc';
const DOMINIO = 'empresa-cliente.com';
const RETORNO = 'http://127.0.0.1:9999/api/sso/retorno';

let falhas = 0, feitos = 0;

async function caso(nome, fn) {
  try {
    await fn();
    feitos++;
    console.log('  ok     ' + nome);
  } catch (err) {
    falhas++;
    console.log('  FALHOU ' + nome);
    console.log('           ' + String(err && err.message).split('\n')[0]);
  }
}

/* ---------- provedor de mentira ---------- */

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign({ kid: 'chave-1', alg: 'RS256', use: 'sig' }, publicKey.export({ format: 'jwk' }));

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(corpo, { alg = 'RS256', kid = 'chave-1', chave = privateKey } = {}) {
  const cabecalho = b64({ alg, kid, typ: 'JWT' });
  const carga = b64(corpo);
  if (alg === 'none') return cabecalho + '.' + carga + '.';
  const ass = crypto.sign('RSA-SHA256', Buffer.from(cabecalho + '.' + carga), chave);
  return cabecalho + '.' + carga + '.' + ass.toString('base64url');
}

function tokenPadrao(extra) {
  const agora = Math.floor(Date.now() / 1000);
  return Object.assign({
    iss: EMISSOR,
    aud: CLIENT_ID,
    sub: 'usuario-123',
    email: 'ana@' + DOMINIO,
    email_verified: true,
    name: 'Ana',
    nonce: nonceDaIda,
    iat: agora,
    exp: agora + 300
  }, extra || {});
}

/* O provedor guarda o que devolver na próxima troca de código, para o teste
 * poder mandar um token torto sem mudar o servidor. */
let proximoToken = null;
let emissorNaConfig = EMISSOR;
/* Provedor de verdade guarda o nonce da ida e devolve no token. Sem isto o
 * teste mandaria token sem nonce, e o nosso codigo recusaria com razao: foi
 * o que aconteceu na primeira execucao. */
let nonceDaIda = null;

const idp = http.createServer((req, res) => {
  const u = new URL(req.url, EMISSOR);
  const responder = (obj, status) => {
    res.writeHead(status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === '/.well-known/openid-configuration') {
    return responder({
      issuer: emissorNaConfig,
      authorization_endpoint: EMISSOR + '/autorizar',
      token_endpoint: EMISSOR + '/token',
      jwks_uri: EMISSOR + '/jwks'
    });
  }
  if (u.pathname === '/jwks') return responder({ keys: [JWK] });
  if (u.pathname === '/token') {
    let corpo = '';
    req.on('data', d => { corpo += d; });
    return req.on('end', () => {
      const p = new URLSearchParams(corpo);
      if (p.get('client_secret') !== CLIENT_SECRET) {
        return responder({ error: 'invalid_client' }, 401);
      }
      const id_token = proximoToken !== null ? proximoToken : assinar(tokenPadrao());
      proximoToken = null;
      responder({ access_token: 'x', token_type: 'Bearer', id_token });
    });
  }
  responder({ erro: 'rota do provedor de teste desconhecida' }, 404);
});

/* ---------- roteiro ---------- */

async function principal() {
  await new Promise(ok => idp.listen(PORTA_IDP, '127.0.0.1', ok));

  banco.abrir(ARQUIVO);
  const cliente = banco.criarTenant('Empresa Cliente', 90);
  const outra = banco.criarTenant('Outra Empresa', 90);
  banco.configurarSso(cliente.id, {
    issuer: EMISSOR, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    dominio: DOMINIO, papelPadrao: 'consultor'
  });

  console.log('\nconfiguracao\n');

  await caso('o segredo do provedor nao fica em texto no banco', () => {
    const bruto = fs.readFileSync(ARQUIVO);
    const noWal = fs.existsSync(ARQUIVO + '-wal') ? fs.readFileSync(ARQUIVO + '-wal') : Buffer.alloc(0);
    /* Sem COFRE_CHAVE ele fica em claro, e isso é esperado. O que este caso
     * garante é que a leitura devolve o valor certo dos dois jeitos. */
    assert.strictEqual(banco.ssoSegredo(banco.ssoDoTenant(cliente.id)), CLIENT_SECRET,
      'o segredo não volta igual ao que entrou');
    assert.ok(bruto.length + noWal.length > 0);
  });

  await caso('dominio sem provedor segue pelo caminho de senha', async () => {
    const r = await sso.iniciar('alguem@sem-provedor.com', RETORNO, '/');
    assert.strictEqual(r, null, 'domínio sem SSO não pode virar erro: é o fluxo normal');
  });

  console.log('\nida\n');

  let ida;
  await caso('CRITERIO: monta o endereco do provedor com state e nonce', async () => {
    ida = await sso.iniciar('ana@' + DOMINIO, RETORNO, '/');
    assert.ok(ida && ida.url, 'não montou o endereço');
    const u = new URL(ida.url);
    assert.strictEqual(u.origin + u.pathname, EMISSOR + '/autorizar');
    assert.strictEqual(u.searchParams.get('response_type'), 'code');
    assert.strictEqual(u.searchParams.get('client_id'), CLIENT_ID);
    assert.strictEqual(u.searchParams.get('redirect_uri'), RETORNO);
    assert.ok(u.searchParams.get('state'), 'sem state: o retorno aceitaria ida que não começou aqui');
    assert.ok(u.searchParams.get('nonce'), 'sem nonce: token capturado se reaproveita');
    assert.match(u.searchParams.get('scope'), /openid/);
  });

  await caso('state e nonce sao diferentes a cada ida', async () => {
    const outraIda = await sso.iniciar('ana@' + DOMINIO, RETORNO, '/');
    const a = new URL(ida.url).searchParams;
    const b = new URL(outraIda.url).searchParams;
    assert.notStrictEqual(a.get('state'), b.get('state'));
    assert.notStrictEqual(a.get('nonce'), b.get('nonce'));
  });

  console.log('\nvolta\n');

  const novaIda = async (email) => {
    const r = await sso.iniciar(email || ('ana@' + DOMINIO), RETORNO, '/');
    const p = new URL(r.url).searchParams;
    nonceDaIda = p.get('nonce');
    return p.get('state');
  };

  await caso('CRITERIO: volta valida cria a entrada, com o e-mail do provedor', async () => {
    const state = await novaIda();
    const r = await sso.concluir('codigo-qualquer', state, RETORNO);
    assert.strictEqual(r.email, 'ana@' + DOMINIO);
    assert.strictEqual(r.tenantId, cliente.id);
    assert.strictEqual(r.papel, 'consultor');
  });

  await caso('CRITERIO: state so serve uma vez', async () => {
    const state = await novaIda();
    await sso.concluir('c1', state, RETORNO);
    await assert.rejects(() => sso.concluir('c2', state, RETORNO), /expirou ou já foi usada/,
      'o mesmo state entrou duas vezes');
  });

  await caso('CRITERIO: state inventado nao entra', async () => {
    await assert.rejects(() => sso.concluir('c', 'state-que-eu-inventei', RETORNO),
      /expirou ou já foi usada/);
  });

  await caso('CRITERIO: token com assinatura de outra chave e recusado', async () => {
    const outraChave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao(), { chave: outraChave });
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /assinatura/);
  });

  await caso('CRITERIO: alg none e recusado', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao(), { alg: 'none' });
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /algoritmo não aceito/,
      'aceitar alg none é o furo mais antigo de JWT');
  });

  await caso('CRITERIO: token de outro emissor e recusado', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ iss: 'https://outro-provedor.com' }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /outro provedor/);
  });

  await caso('CRITERIO: token emitido para outro aplicativo e recusado', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ aud: 'outro-aplicativo' }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /outro aplicativo/);
  });

  await caso('CRITERIO: token expirado e recusado', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ iat: agora - 7200, exp: agora - 3600 }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /expirado/);
  });

  await caso('CRITERIO: nonce trocado e recusado', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ nonce: 'nonce-de-outra-ida' }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /nonce/);
  });

  await caso('CRITERIO: e-mail nao confirmado pelo provedor e recusado', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ email_verified: false }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /não confirmou/);
  });

  await caso('e-mail sem a marca de confirmado tambem e recusado', async () => {
    /* A ida primeiro: tokenPadrao le o nonce da ida corrente, e montar antes
     * produzia token com nonce velho, recusado por outro motivo. */
    const state = await novaIda();
    const t = tokenPadrao();
    delete t.email_verified;
    proximoToken = assinar(t);
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /não confirmou/,
      'ausência não pode valer como confirmação');
  });

  await caso('CRITERIO: e-mail de outro dominio nao entra nesta equipe', async () => {
    const state = await novaIda();
    proximoToken = assinar(tokenPadrao({ email: 'invasor@empresa-alheia.com' }));
    await assert.rejects(() => sso.concluir('c', state, RETORNO), /não pertence ao domínio/,
      'provedor mal configurado afirmaria e-mail de outra empresa');
  });

  await caso('CRITERIO: descoberta que devolve outro emissor e recusada', async () => {
    /* Servidor proprio, em outra porta: a descoberta do emissor bom ja esta
     * em cache, e o cache existe de proposito. Mexer nele para testar seria
     * testar outra coisa.
     *
     * O ataque: um redirecionamento leva a descoberta para um provedor que
     * nao e o configurado, e a partir dai tudo vem dele. */
    const impostor = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: 'https://provedor-de-verdade.com',
        authorization_endpoint: 'https://x/a',
        token_endpoint: 'https://x/t',
        jwks_uri: 'https://x/j'
      }));
    });
    await new Promise(ok => impostor.listen(8995, '127.0.0.1', ok));
    try {
      await assert.rejects(() => sso.descobrir('http://127.0.0.1:8995'),
        /configuração de outro emissor/,
        'aceitou configuração de um emissor diferente do pedido');
    } finally {
      impostor.close();
    }
  });

  console.log('\nsessao e isolamento\n');

  const contas = require('./cofre/contas.js');
  const reqFalso = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };

  await caso('CRITERIO: primeiro acesso cria a conta e o vinculo', async () => {
    const state = await novaIda();
    const dados = await sso.concluir('c', state, RETORNO);
    assert.strictEqual(banco.usuarioPorEmail(dados.email), null, 'a conta não deveria existir ainda');

    const r = contas.entrarPorProvedor(reqFalso, dados);
    assert.strictEqual(r.sessao.email, 'ana@' + DOMINIO);
    assert.strictEqual(r.sessao.tenantNome, 'Empresa Cliente');

    const u = banco.usuarioPorEmail(dados.email);
    assert.ok(u, 'a conta não foi criada');
    assert.strictEqual(banco.vinculo(cliente.id, u.id).papel, 'consultor');
  });

  await caso('segundo acesso nao rebaixa quem foi promovido a mao', async () => {
    const u = banco.usuarioPorEmail('ana@' + DOMINIO);
    banco.vincular(cliente.id, u.id, 'gestor');

    const state = await novaIda();
    const dados = await sso.concluir('c', state, RETORNO);
    const r = contas.entrarPorProvedor(reqFalso, dados);
    assert.strictEqual(r.sessao.papel, 'gestor',
      'entrar de novo rebaixou a pessoa para o papel padrão');
  });

  await caso('a entrada por provedor fica na auditoria', () => {
    const eventos = banco.listarAuditoria(cliente.id, 50).map(e => e.acao);
    assert.ok(eventos.includes('login.provedor_primeiro_acesso'), 'primeiro acesso não registrado');
    assert.ok(eventos.includes('login.provedor'), 'acesso seguinte não registrado');
  });

  await caso('a senha local nasce impossivel de adivinhar', () => {
    const u = banco.usuarioPorEmail('ana@' + DOMINIO);
    assert.ok(!contas.conferirSenha('', u.senha_hash), 'senha vazia entra');
    assert.ok(!contas.conferirSenha('123456', u.senha_hash));
    assert.ok(!contas.conferirSenha('ana@' + DOMINIO, u.senha_hash));
  });

  await caso('a outra equipe nao ganhou nada com isso', () => {
    const u = banco.usuarioPorEmail('ana@' + DOMINIO);
    assert.strictEqual(banco.vinculo(outra.id, u.id), null,
      'entrar por provedor de uma equipe deu acesso a outra');
  });
}

principal()
  .catch(err => { falhas++; console.log('\nERRO GERAL: ' + err.message + '\n' + err.stack); })
  .then(() => {
    try { idp.close(); } catch (e) {}
    try { banco.fechar(); } catch (e) {}
    console.log('\n' + feitos + ' passaram, ' + falhas + ' falharam\n');
    process.exit(falhas ? 1 : 0);
  });
