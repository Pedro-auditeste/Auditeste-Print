/* Publicação no Zephyr Essential Cloud (API v2), contra um Zephyr de mentira.
 *
 *   node teste-zephyr.js
 *
 * O Zephyr de verdade não entra num teste automático: publicar cria execução
 * na conta da equipe. Então o teste sobe um servidor que exige o mesmo que a
 * API exige (o cabeçalho AccessToken) e recusa o que ela recusaria.
 */
const assert = require('assert');
const http = require('http');

const TOKEN = 'token-de-teste-nao-use-em-producao';
const PORTA = 8984;

process.env.ZEPHYR_BASE = 'http://127.0.0.1:' + PORTA + '/v2';
process.env.ZEPHYR_API_TOKEN = TOKEN;
process.env.ZEPHYR_PROJETO = 'GOV';
process.env.ZEPHYR_CICLO = 'GOV-R1';

const zephyr = require('./cofre/zephyr.js');

let falhas = 0;
async function caso(nome, fn) {
  try { await fn(); console.log('  ok   ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n         ' + String(err && err.message).split('\n')[0]); }
}

/* ---------- Zephyr de mentira ---------- */

const chamadas = [];
let proximaFalha = null;

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const caminho = u.pathname.replace(/^\/v2/, '');
  const pedacos = [];
  req.on('data', d => pedacos.push(d));
  req.on('end', () => {
    const corpo = Buffer.concat(pedacos).toString('utf8');
    const responder = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    /* A API inteira depende deste cabeçalho. Sem ele, 401. */
    if (req.headers.accesstoken !== TOKEN) {
      return responder(401, { message: 'token ausente ou inválido' });
    }
    chamadas.push({ metodo: req.method, caminho, query: u.search, corpo });

    if (proximaFalha && proximaFalha.caminho === caminho) {
      const f = proximaFalha; proximaFalha = null;
      return responder(f.status, { message: f.msg });
    }
    if (caminho === '/testcycles' && req.method === 'GET') {
      return responder(200, { values: [{ key: 'GOV-R1', name: 'Regressão' }, { key: 'GOV-R2', name: 'Sprint 42' }] });
    }
    if (caminho === '/statuses' && req.method === 'GET') {
      return responder(200, { values: [{ name: 'Pass' }, { name: 'Fail' }, { name: 'In Progress' }, { name: 'Blocked' }] });
    }
    if (caminho === '/testexecutions' && req.method === 'POST') {
      return responder(201, { id: 9001, key: 'GOV-E7' });
    }
    responder(404, { message: 'rota de mentira desconhecida: ' + caminho });
  });
});

(async () => {
  await new Promise(ok => servidor.listen(PORTA, '127.0.0.1', ok));
  console.log('\nzephyr essential cloud (api v2)\n');

  await caso('a query sai só com o que tem valor', () => {
    assert.strictEqual(zephyr.query({ projectKey: 'GOV', folderId: null, maxResults: 20, x: '' }),
      '?projectKey=GOV&maxResults=20');
  });

  await caso('CRITERIO: toda chamada leva o cabeçalho AccessToken', async () => {
    chamadas.length = 0;
    await zephyr.conferir();
    assert.ok(chamadas.length >= 1, 'não chamou');
    // o servidor de mentira devolve 401 sem o cabeçalho, entao chegar aqui ja prova
    assert.strictEqual(chamadas[0].caminho, '/testcycles');
  });

  await caso('conferir devolve os ciclos e os status do projeto', async () => {
    const r = await zephyr.conferir();
    assert.strictEqual(r.projeto, 'GOV');
    assert.deepStrictEqual(r.ciclos, [
      { chave: 'GOV-R1', nome: 'Regressão' },
      { chave: 'GOV-R2', nome: 'Sprint 42' }
    ]);
    assert.deepStrictEqual(r.statusDisponiveis, ['Pass', 'Fail', 'In Progress', 'Blocked']);
  });

  await caso('CRITERIO: publicar cria a execução com caso, ciclo e status', async () => {
    chamadas.length = 0;
    const r = await zephyr.publicar({ caso: 'GOV-T1', resultado: 'Reprovado', comentario: 'EVD-1' });
    const p = chamadas.find(c => c.metodo === 'POST' && c.caminho === '/testexecutions');
    assert.ok(p, 'não criou a execução');
    assert.deepStrictEqual(JSON.parse(p.corpo), {
      projectKey: 'GOV', testCaseKey: 'GOV-T1', statusName: 'Fail',
      testCycleKey: 'GOV-R1', comment: 'EVD-1'
    });
    assert.strictEqual(r.execucao, 'GOV-E7');
  });

  await caso('o resultado da ficha vira o NOME do status, não um número', () => {
    assert.strictEqual(zephyr.statusDe('Aprovado'), 'Pass');
    assert.strictEqual(zephyr.statusDe('Reprovado'), 'Fail');
    assert.strictEqual(zephyr.statusDe('Bloqueado'), 'Blocked');
    assert.strictEqual(zephyr.statusDe(''), 'In Progress', 'sem resultado, fica em andamento');
  });

  await caso('a chave minúscula é aceita e normalizada', async () => {
    chamadas.length = 0;
    await zephyr.publicar({ caso: ' gov-t9 ', resultado: 'Aprovado' });
    const p = chamadas.find(c => c.metodo === 'POST');
    assert.strictEqual(JSON.parse(p.corpo).testCaseKey, 'GOV-T9');
  });

  await caso('CRITERIO: chave de issue do Jira é recusada antes de chamar', async () => {
    /* GOV-12 é uma issue; GOV-T12 é um caso de teste. Trocar uma pela outra
     * dava 404 do Zephyr, que não explica nada. */
    chamadas.length = 0;
    await assert.rejects(() => zephyr.publicar({ caso: 'GOV-12', resultado: 'Aprovado' }),
      (e) => e.status === 400 && /caso de teste/.test(e.message));
    assert.strictEqual(chamadas.length, 0, 'não podia ter falado com o Zephyr');
  });

  await caso('caso vazio é recusado antes de chamar', async () => {
    chamadas.length = 0;
    await assert.rejects(() => zephyr.publicar({ caso: '  ' }), (e) => e.status === 400);
    assert.strictEqual(chamadas.length, 0);
  });

  await caso('ciclo informado na hora vence o configurado', async () => {
    chamadas.length = 0;
    await zephyr.publicar({ caso: 'GOV-T2', resultado: 'Aprovado', ciclo: 'GOV-R2' });
    assert.strictEqual(JSON.parse(chamadas.find(c => c.metodo === 'POST').corpo).testCycleKey, 'GOV-R2');
  });

  await caso('erro do Zephyr chega legível, sem virar 500 mudo', async () => {
    proximaFalha = { caminho: '/testexecutions', status: 400, msg: 'test case not found' };
    await assert.rejects(() => zephyr.publicar({ caso: 'GOV-T3', resultado: 'Aprovado' }),
      (e) => /test case not found/.test(e.message) && e.status === 502);
  });

  await caso('CRITERIO: a resposta diz que o anexo NÃO foi, porque a API não anexa', async () => {
    const r = await zephyr.publicar({ caso: 'GOV-T4', resultado: 'Aprovado' });
    assert.strictEqual(r.anexado, false);
  });

  await pelaRota();
  servidor.close();
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (16 casos)\n');
  process.exit(falhas ? 1 : 0);
})();

/* ---------- o caminho inteiro: Print -> rota do cofre -> Zephyr ---------- */
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
    for (const s of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) cookie = s.split(';')[0];
    const texto = await r.text();
    let d = null; try { d = JSON.parse(texto); } catch (_) { d = texto; }
    return { status: r.status, corpo: d };
  };

  try {
    await caso('rota: sem sessao nao publica', async () => {
      const r = await pedir('/api/zephyr/publicar', { caso: 'GOV-T1' });
      assert.strictEqual(r.status, 401);
    });

    await pedir('/api/entrar', { email: 'qa@exemplo.com', senha: 'senha-bem-longa-9' });

    await caso('CRITERIO: a rota de estado nao devolve o token', async () => {
      const r = await pedir('/api/zephyr');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.corpo.configurado, true);
      assert.ok(!JSON.stringify(r.corpo).includes(TOKEN), 'vazou o token: ' + JSON.stringify(r.corpo));
    });

    await caso('rota: publica de verdade e devolve a execucao', async () => {
      chamadas.length = 0;
      const r = await pedir('/api/zephyr/publicar', {
        caso: 'GOV-T1', resultado: 'Reprovado', comentario: 'do teste'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.execucao, 'GOV-E7');
    });

    await caso('CRITERIO: erro do Zephyr chega inteiro pela rota, sem virar "falha interna"', async () => {
      /* Era assim que ficava antes: 504 mascarado como "informe o codigo ao
       * suporte", escondendo que o endereco da API estava errado. */
      proximaFalha = { caminho: '/testexecutions', status: 400, msg: 'projeto nao encontrado' };
      const r = await pedir('/api/zephyr/publicar', { caso: 'GOV-T1', resultado: 'Aprovado' });
      assert.ok(/projeto nao encontrado/.test(JSON.stringify(r.corpo)),
        'a mensagem do Zephyr foi mascarada: ' + JSON.stringify(r.corpo));
      assert.ok(!/falha interna|informe o c/i.test(JSON.stringify(r.corpo)));
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
