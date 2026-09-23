/* Publicação no Zephyr Squad Cloud, contra um Zephyr de mentira.
 *
 *   node teste-zephyr.js
 *
 * O Zephyr de verdade não pode entrar num teste automático: publicar cria
 * execução na conta da equipe. Então o teste sobe um servidor que exige
 * exatamente o que a ZAPI exige (cabeçalhos, JWT assinado com a chave
 * secreta, qsh do método + caminho + query ordenada) e recusa o que ela
 * recusaria. Assinatura errada aqui é assinatura errada lá.
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

const ACCESS = 'chave-de-acesso';
const SEGREDO = 'chave-secreta-bem-longa';
const CONTA = 'conta-atlassian-123';
const PORTA = 8984;

process.env.ZEPHYR_BASE = 'http://127.0.0.1:' + PORTA + '/connect';
process.env.ZEPHYR_ACCESS_KEY = ACCESS;
process.env.ZEPHYR_SECRET_KEY = SEGREDO;
process.env.ZEPHYR_ACCOUNT_ID = CONTA;
process.env.ZEPHYR_PROJETO_ID = '10000';
process.env.ZEPHYR_VERSAO_ID = '-1';
process.env.ZEPHYR_CICLO_ID = '77';

const zephyr = require('./cofre/zephyr.js');

let falhas = 0;
async function caso(nome, fn) {
  try { await fn(); console.log('  ok   ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String(err && err.message).split('\n')[0]); }
}

/* ---------- Zephyr de mentira, rigoroso como o de verdade ---------- */

const chamadas = [];
let proximaFalha = null;

function conferirJwt(req, caminho, query) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('JWT ')) throw new Error('sem Authorization JWT');
  if (req.headers.zapiaccesskey !== ACCESS) throw new Error('sem zapiAccessKey');

  const [cab, carga, assin] = auth.slice(4).split('.');
  const esperada = crypto.createHmac('sha256', SEGREDO).update(cab + '.' + carga).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (assin !== esperada) throw new Error('assinatura do JWT não confere');

  const c = JSON.parse(Buffer.from(carga, 'base64').toString('utf8'));
  if (c.iss !== ACCESS) throw new Error('iss deveria ser a chave de acesso');
  if (c.sub !== CONTA) throw new Error('sub deveria ser o accountId');
  const agora = Math.floor(Date.now() / 1000);
  if (!(c.iat <= agora + 5 && c.exp > agora)) throw new Error('iat/exp fora de hora (segundos?)');

  /* O qsh é o coração: método, caminho e query EM ORDEM. */
  const canonico = [req.method, caminho, query].join('&');
  const qsh = crypto.createHash('sha256').update(canonico).digest('hex');
  if (c.qsh !== qsh) throw new Error('qsh não bate para "' + canonico + '"');
  return c;
}

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const caminho = u.pathname.replace(/^\/connect/, '');
  const query = [...u.searchParams.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

  const pedacos = [];
  req.on('data', d => pedacos.push(d));
  req.on('end', () => {
    const corpo = Buffer.concat(pedacos);
    const responder = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      conferirJwt(req, caminho, query);
    } catch (err) {
      return responder(401, { errorDesc: err.message });
    }
    chamadas.push({ metodo: req.method, caminho, query, corpo, tipo: req.headers['content-type'] || '' });

    if (proximaFalha && proximaFalha.caminho === caminho) {
      const f = proximaFalha; proximaFalha = null;
      return responder(f.status, { errorDesc: f.msg });
    }
    if (caminho === '/public/rest/api/1.0/cycles/search') return responder(200, { 77: { name: 'Ciclo' } });
    if (caminho.startsWith('/public/rest/api/1.0/executions/add/cycle/')) return responder(200, {});
    if (caminho.startsWith('/public/rest/api/1.0/executions/search/cycle/')) {
      return responder(200, { searchObjectList: [{ execution: { id: 555, issueId: 10101 } }] });
    }
    if (caminho.startsWith('/public/rest/api/1.0/executions/')) return responder(200, { ok: true });
    if (caminho === '/public/rest/api/1.0/attachment') return responder(200, { id: 'anexo-1' });
    responder(404, { errorDesc: 'rota de mentira desconhecida: ' + caminho });
  });
});

(async () => {
  await new Promise(ok => servidor.listen(PORTA, '127.0.0.1', ok));
  console.log('\nzephyr squad cloud\n');

  await caso('a query do qsh vai em ordem alfabética, não na ordem escrita', () => {
    assert.strictEqual(zephyr.queryCanonica({ versionId: -1, projectId: 10000, action: 'expand' }),
      'action=expand&projectId=10000&versionId=-1');
  });

  await caso('o JWT leva iss, sub, iat, exp e o qsh do pedido', () => {
    const t = zephyr.gerarJwt('GET', '/public/rest/api/1.0/cycles/search', { projectId: 1 }, 1700000000000);
    const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString('utf8'));
    assert.strictEqual(c.iss, ACCESS);
    assert.strictEqual(c.sub, CONTA);
    assert.strictEqual(c.iat, 1700000000, 'iat tem de ser em segundos');
    assert.strictEqual(c.exp, 1700003600);
    assert.strictEqual(c.qsh,
      crypto.createHash('sha256').update('GET&/public/rest/api/1.0/cycles/search&projectId=1').digest('hex'));
  });

  await caso('CRITERIO: a chave secreta nunca vai dentro do pedido', () => {
    const t = zephyr.gerarJwt('GET', '/x', {});
    assert.ok(!t.includes(SEGREDO), 'a chave secreta apareceu no token');
    assert.ok(!JSON.stringify(zephyr.STATUS).includes(SEGREDO));
  });

  await caso('conferir() faz só leitura e passa pela assinatura', async () => {
    chamadas.length = 0;
    const r = await zephyr.conferir();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].metodo, 'GET');
    assert.strictEqual(chamadas[0].caminho, '/public/rest/api/1.0/cycles/search');
    // Os ciclos voltam com id e nome, que e o que falta para configurar.
    assert.deepStrictEqual(r.ciclos, [{ id: '77', nome: 'Ciclo' }]);
  });

  await caso('CRITERIO: publicar segue a sequência que a ZAPI exige', async () => {
    chamadas.length = 0;
    const r = await zephyr.publicar({
      caso: '10101', resultado: 'Aprovado', comentario: 'Evidência EVD-1',
      anexoNome: 'evidencia.html', anexoTipo: 'text/html',
      anexoBytes: Buffer.from('<html>prova</html>')
    });
    assert.deepStrictEqual(chamadas.map(c => c.metodo + ' ' + c.caminho), [
      'POST /public/rest/api/1.0/executions/add/cycle/77',
      'GET /public/rest/api/1.0/executions/search/cycle/77',
      'PUT /public/rest/api/1.0/executions/555',
      'POST /public/rest/api/1.0/attachment'
    ]);
    assert.strictEqual(r.execucaoId, '555');
    assert.strictEqual(r.anexado, true);
  });

  await caso('o resultado da ficha vira o status certo', () => {
    assert.strictEqual(zephyr.statusDe('Aprovado'), 1);
    assert.strictEqual(zephyr.statusDe('Reprovado'), 2);
    assert.strictEqual(zephyr.statusDe('Bloqueado'), 4);
    assert.strictEqual(zephyr.statusDe(''), 3, 'sem resultado, fica em andamento');
  });

  await caso('o status gravado é o do resultado, e o comentário vai junto', async () => {
    chamadas.length = 0;
    await zephyr.publicar({ caso: '10101', resultado: 'Reprovado', comentario: 'quebrou no login' });
    const put = chamadas.find(c => c.metodo === 'PUT');
    const corpo = JSON.parse(put.corpo.toString('utf8'));
    assert.strictEqual(corpo.status.id, 2);
    assert.strictEqual(corpo.comment, 'quebrou no login');
    assert.strictEqual(corpo.issueId, '10101');
  });

  await caso('o anexo sobe como multipart, com o arquivo dentro', async () => {
    chamadas.length = 0;
    await zephyr.publicar({ caso: '10101', resultado: 'Aprovado',
      anexoNome: 'evidencia.html', anexoTipo: 'text/html', anexoBytes: Buffer.from('<b>print</b>') });
    const envio = chamadas.find(c => c.caminho === '/public/rest/api/1.0/attachment');
    assert.ok(/^multipart\/form-data; boundary=/.test(envio.tipo), 'tipo errado: ' + envio.tipo);
    const texto = envio.corpo.toString('utf8');
    assert.ok(texto.includes('filename="evidencia.html"'), 'sem nome do arquivo');
    assert.ok(texto.includes('<b>print</b>'), 'o conteúdo do anexo não foi');
    assert.ok(/entityId=555/.test(envio.query) && /entityName=execution/.test(envio.query),
      'o anexo precisa apontar para a execução: ' + envio.query);
  });

  await caso('sem anexo, publica mesmo assim e avisa que não anexou', async () => {
    const r = await zephyr.publicar({ caso: '10101', resultado: 'Aprovado' });
    assert.strictEqual(r.anexado, false);
  });

  await caso('erro do Zephyr chega legível, sem virar 500 mudo', async () => {
    proximaFalha = { caminho: '/public/rest/api/1.0/executions/add/cycle/77', status: 400, msg: 'ciclo inexistente' };
    await assert.rejects(() => zephyr.publicar({ caso: '10101', resultado: 'Aprovado' }),
      (e) => /ciclo inexistente/.test(e.message) && e.status === 502);
  });

  await caso('caso vazio é recusado antes de qualquer chamada', async () => {
    chamadas.length = 0;
    await assert.rejects(() => zephyr.publicar({ caso: '  ', resultado: 'Aprovado' }),
      (e) => e.status === 400);
    assert.strictEqual(chamadas.length, 0, 'não podia ter falado com o Zephyr');
  });

  await caso('chave "ABC-123" sem credencial do Jira pede o id, em vez de falhar torto', async () => {
    await assert.rejects(() => zephyr.publicar({ caso: 'ABC-123', resultado: 'Aprovado' }),
      (e) => e.status === 400 && /id numérico/.test(e.message));
  });

  await pelaRota();

  servidor.close();
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (16 casos)\n');
  process.exit(falhas ? 1 : 0);
})();

/* ---------- o caminho inteiro: Print -> rota do cofre -> Zephyr ----------
 *
 * O modulo acima ja esta provado. Falta o que o botao do Print usa: a rota
 * precisa exigir sessao, publicar de verdade, registrar na auditoria e NUNCA
 * devolver chave nenhuma para a pagina. */
async function pelaRota() {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const { spawn } = require('child_process');

  const PORTA_COFRE = 8983;
  const COFRE = 'http://127.0.0.1:' + PORTA_COFRE;
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-')), 'c.db');

  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(arq);
  const tenant = banco.criarTenant('Equipe do teste', 90);
  const u = banco.criarUsuario('qa@exemplo.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA_COFRE), HOST: '127.0.0.1', COFRE_BANCO: arq,
      COFRE_SEGREDO: 'segredo-zephyr', AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: 'ignore'
  });
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; ; i++) {
    try { const r = await fetch(COFRE + '/ping'); if (r.ok) break; } catch (e) { /* subindo */ }
    if (i > 120) throw new Error('o cofre nao subiu');
    await esperar(250);
  }

  let cookie = '';
  const pedir = async (caminho, corpo, metodo) => {
    const o = { method: metodo || (corpo ? 'POST' : 'GET'), headers: {} };
    if (cookie) o.headers.cookie = cookie;
    if (corpo) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(COFRE + caminho, o);
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const s of set) cookie = s.split(';')[0];
    const texto = await r.text();
    let d = null; try { d = JSON.parse(texto); } catch (_) { d = texto; }
    return { status: r.status, corpo: d };
  };

  try {
    await caso('rota: sem sessao nao publica', async () => {
      const r = await pedir('/api/zephyr/publicar', { caso: '10101' });
      assert.strictEqual(r.status, 401);
    });

    await pedir('/api/entrar', { email: 'qa@exemplo.com', senha: 'senha-bem-longa-9' });

    await caso('CRITERIO: a rota de estado nao devolve chave nenhuma', async () => {
      const r = await pedir('/api/zephyr');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.corpo.configurado, true);
      const texto = JSON.stringify(r.corpo);
      for (const segredo of [SEGREDO, ACCESS, CONTA]) {
        assert.ok(!texto.includes(segredo), 'vazou credencial na resposta: ' + texto);
      }
    });

    await caso('rota: publica de verdade e devolve a execucao', async () => {
      chamadas.length = 0;
      const r = await pedir('/api/zephyr/publicar', {
        caso: '10101', resultado: 'Reprovado', comentario: 'do teste',
        anexoNome: 'EVD-1.html', anexoTipo: 'text/html',
        anexoBase64: Buffer.from('<html>prova</html>').toString('base64')
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.execucaoId, '555');
      assert.strictEqual(r.corpo.anexado, true);
      const anexo = chamadas.find(c => c.caminho === '/public/rest/api/1.0/attachment');
      assert.ok(anexo.corpo.toString('utf8').includes('<html>prova</html>'), 'o anexo nao chegou ao Zephyr');
    });

    await caso('rota: a publicacao fica na auditoria da equipe', async () => {
      const r = await pedir('/api/auditoria');
      const eventos = (r.corpo.eventos || []).map(e => e.acao);
      assert.ok(eventos.includes('zephyr.publicado'), 'nao auditou: ' + eventos.join(','));
    });
  } finally {
    proc.kill();
  }
}
