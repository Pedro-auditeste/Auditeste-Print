/* Demonstração da publicação no Zephyr Squad, chamada por chamada.
 *
 *   node demo-zephyr.js
 *
 * Roda o caminho inteiro (Print -> cofre -> Zephyr) e IMPRIME o que passa em
 * cada etapa: a assinatura de cada chamada, o que foi gravado e o anexo que
 * chegou do outro lado.
 *
 * No lugar do Zephyr de verdade entra um que confere a assinatura exatamente
 * como a ZAPI confere, e recusa o que ela recusaria. Publicar contra a conta
 * real criaria execução de verdade só para uma demonstração.
 */
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ACCESS = 'ACCESSKEY-EXEMPLO-9f2a';
const SEGREDO = 'segredo-de-exemplo-nao-use-em-producao';
const CONTA = '557058:11d1e9f3-conta-exemplo';
const PORTA_ZEPHYR = 8979;
const PORTA_COFRE = 8978;
const COFRE = 'http://127.0.0.1:' + PORTA_COFRE;

const linha = (c = '─') => console.log(c.repeat(78));
const titulo = (t) => { console.log(''); linha('═'); console.log('  ' + t); linha('═'); };
const esconder = (s) => String(s).slice(0, 6) + '…' + String(s).slice(-4);

/* ---------- o Zephyr de mentira, rigoroso como o de verdade ---------- */

let passo = 0;
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const caminho = u.pathname.replace(/^\/connect/, '');
  const query = [...u.searchParams.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const pedacos = [];
  req.on('data', d => pedacos.push(d));
  req.on('end', () => {
    const corpo = Buffer.concat(pedacos);
    const responder = (status, obj) => {
      console.log('    resposta do Zephyr: HTTP ' + status);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    passo++;
    console.log('');
    linha();
    console.log(' CHAMADA ' + passo + ':  ' + req.method + ' ' + caminho + (query ? '?' + query : ''));
    linha();

    const auth = (req.headers.authorization || '').replace(/^JWT /, '');
    const [cab, carga, assin] = auth.split('.');
    const c = JSON.parse(Buffer.from(carga, 'base64').toString('utf8'));
    const esperada = crypto.createHmac('sha256', SEGREDO).update(cab + '.' + carga).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const canonico = [req.method, caminho, query].join('&');
    const qsh = crypto.createHash('sha256').update(canonico).digest('hex');

    console.log('  cabeçalho zapiAccessKey: ' + req.headers.zapiaccesskey);
    console.log('  crachá (JWT) que veio junto:');
    console.log('    quem assinou (iss): ' + c.iss);
    console.log('    conta        (sub): ' + c.sub);
    console.log('    vale até     (exp): ' + new Date(c.exp * 1000).toLocaleTimeString('pt-BR'));
    console.log('    impressão digital do pedido (qsh): ' + c.qsh.slice(0, 24) + '…');
    console.log('      calculada sobre: "' + canonico + '"');
    console.log('  CONFERÊNCIA DO ZEPHYR:');
    console.log('    assinatura bate com a chave secreta? ' + (assin === esperada ? 'SIM' : 'NÃO'));
    console.log('    a impressão digital corresponde a ESTA chamada? ' + (c.qsh === qsh ? 'SIM' : 'NÃO'));
    if (assin !== esperada || c.qsh !== qsh) return responder(401, { errorDesc: 'assinatura inválida' });

    if (corpo.length) {
      const tipo = req.headers['content-type'] || '';
      if (tipo.startsWith('multipart/')) {
        const texto = corpo.toString('utf8');
        const nome = (texto.match(/filename="([^"]+)"/) || [])[1];
        console.log('  ANEXO recebido:');
        console.log('    arquivo: ' + nome);
        console.log('    tamanho: ' + (corpo.length / 1024).toFixed(1) + ' KB');
        console.log('    começa com: ' + texto.split('\r\n\r\n')[1].slice(0, 60).replace(/\n/g, ' ') + '…');
      } else {
        console.log('  corpo enviado: ' + corpo.toString('utf8').slice(0, 220));
      }
    }

    if (caminho === '/public/rest/api/1.0/cycles/search') {
      return responder(200, { 77: { name: 'Ciclo de regressão' } });
    }
    if (caminho.startsWith('/public/rest/api/1.0/executions/add/cycle/')) return responder(200, {});
    if (caminho.startsWith('/public/rest/api/1.0/executions/search/cycle/')) {
      return responder(200, { searchObjectList: [{ execution: { id: 40211, issueId: 10101 } }] });
    }
    if (caminho.startsWith('/public/rest/api/1.0/executions/')) return responder(200, { ok: true });
    if (caminho === '/public/rest/api/1.0/attachment') return responder(200, { id: 'anexo-1' });
    responder(404, { errorDesc: 'rota desconhecida' });
  });
});

(async () => {
  await new Promise(ok => servidor.listen(PORTA_ZEPHYR, '127.0.0.1', ok));

  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-zephyr-')), 'cofre.db');
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(arq);
  const tenant = banco.criarTenant('Cliente Demonstração', 90);
  const u = banco.criarUsuario('qa@auditeste.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA_COFRE), HOST: '127.0.0.1', COFRE_BANCO: arq,
      COFRE_SEGREDO: 'segredo-demo', AGENTE_API_KEY: '', PONTE_TOKEN: '',
      ZEPHYR_BASE: 'http://127.0.0.1:' + PORTA_ZEPHYR + '/connect',
      ZEPHYR_ACCESS_KEY: ACCESS, ZEPHYR_SECRET_KEY: SEGREDO, ZEPHYR_ACCOUNT_ID: CONTA,
      ZEPHYR_PROJETO_ID: '10000', ZEPHYR_VERSAO_ID: '-1', ZEPHYR_CICLO_ID: '77'
    }),
    stdio: 'ignore'
  });
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; ; i++) {
    try { const r = await fetch(COFRE + '/ping'); if (r.ok) break; } catch (e) { /* subindo */ }
    if (i > 120) throw new Error('o cofre não subiu');
    await esperar(250);
  }

  let cookie = '';
  const pedir = async (caminho, corpo, metodo) => {
    const o = { method: metodo || (corpo ? 'POST' : 'GET'), headers: {} };
    if (cookie) o.headers.cookie = cookie;
    if (corpo) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(COFRE + caminho, o);
    for (const s of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) cookie = s.split(';')[0];
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch (_) { d = t; }
    return { status: r.status, corpo: d };
  };

  try {
    titulo('1. O QUE ESTÁ CONFIGURADO NO SERVIDOR');
    console.log('  chave de acesso: ' + esconder(ACCESS));
    console.log('  chave secreta:   ' + esconder(SEGREDO) + '   (só o servidor conhece)');
    console.log('  conta:           ' + esconder(CONTA));
    console.log('  projeto no Jira: 10000     ciclo: 77     versão: -1');

    titulo('2. O QUE A PÁGINA CONSEGUE PERGUNTAR AO SERVIDOR');
    const semSessao = await pedir('/api/zephyr/publicar', { caso: '10101' });
    console.log('  sem estar logado, publicar responde: HTTP ' + semSessao.status
      + ' (' + (semSessao.corpo.erro || '') + ')');
    await pedir('/api/entrar', { email: 'qa@auditeste.com', senha: 'senha-bem-longa-9' });
    const estado = await pedir('/api/zephyr');
    console.log('  logado, a página pergunta o estado e recebe: ' + JSON.stringify(estado.corpo));
    const vazou = [ACCESS, SEGREDO, CONTA].filter(s => JSON.stringify(estado.corpo).includes(s));
    console.log('  alguma credencial apareceu nessa resposta? ' + (vazou.length ? 'SIM' : 'NÃO'));

    titulo('3. CONFERIR AS CHAVES SEM PUBLICAR NADA');
    const conf = await pedir('/api/zephyr/conferir', {});
    console.log('');
    console.log('  resultado: ' + JSON.stringify(conf.corpo));

    titulo('4. PUBLICAR A EVIDÊNCIA (o que o botão do Print faz)');
    const html = '<!DOCTYPE html><html><head><title>EVD-20260922-001</title></head><body>'
      + '<h1>Evidência EVD-20260922-001</h1>'
      + '<p>Passo 1: Clicar em //*[@id="btnEntrar"]</p>'
      + '<img src="data:image/png;base64,iVBORw0KGgo..." alt="print">'
      + '</body></html>';
    const r = await pedir('/api/zephyr/publicar', {
      caso: '10101',
      resultado: 'Reprovado',
      comentario: 'Audi Print · EVD-20260922-001 · 26 passo(s) · ambiente Homologação · versão 4.2.1',
      anexoNome: 'EVD-20260922-001.html',
      anexoTipo: 'text/html',
      anexoBase64: Buffer.from(html).toString('base64')
    });

    titulo('5. O QUE O PRINT RECEBE DE VOLTA');
    console.log('  HTTP ' + r.status);
    console.log('  ' + JSON.stringify(r.corpo, null, 2).split('\n').join('\n  '));
    console.log('');
    console.log('  Na tela aparece: "Publicado no Zephyr: execução '
      + r.corpo.execucaoId + ' com a evidência anexada."');

    titulo('6. O QUE FICOU REGISTRADO NA AUDITORIA DA EQUIPE');
    const aud = await pedir('/api/auditoria');
    for (const e of (aud.corpo.eventos || []).filter(e => e.acao === 'zephyr.publicado')) {
      console.log('  ' + new Date(e.quando).toLocaleString('pt-BR')
        + '  ' + (e.email || 'sem e-mail') + '  ' + e.acao + '  ' + e.recurso);
    }

    titulo('7. E SE A CHAVE SECRETA ESTIVER ERRADA');
    console.log('  (uma chamada assinada com outra chave, para ver a recusa)');
    const falso = crypto.createHmac('sha256', 'chave-errada').update('x.y').digest('base64');
    const teste = await fetch('http://127.0.0.1:' + PORTA_ZEPHYR
      + '/connect/public/rest/api/1.0/cycles/search?projectId=10000&versionId=-1', {
      headers: {
        zapiAccessKey: ACCESS,
        Authorization: 'JWT ' + Buffer.from('{"alg":"HS256"}').toString('base64url')
          + '.' + Buffer.from(JSON.stringify({ iss: ACCESS, sub: CONTA, qsh: 'x', iat: 1, exp: 9 })).toString('base64url')
          + '.' + falso
      }
    });
    console.log('    o Zephyr respondeu: HTTP ' + teste.status + ' ' + (await teste.text()));

    console.log('');
    linha('═');
    console.log('  FIM. Nenhuma execução foi criada em conta real: o Zephyr acima é local.');
    linha('═');
  } finally {
    proc.kill();
    servidor.close();
  }
})();
