/* Jira e Zephyr por equipe: várias equipes no mesmo servidor, cada uma com a
 * credencial dela, sem uma alcançar a da outra.
 *
 *   node teste-integracoes.js
 *
 * O risco que este arquivo trava é o de SaaS com vários clientes: a equipe B
 * abrindo bug no Jira da equipe A, ou uma conta recém-criada herdando o Jira
 * de quem subiu o servidor. O Jira e o Zephyr de mentira só aceitam o token
 * certo para cada projeto, então credencial cruzada aparece como 401.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORTA_FALSO = 8973;
const PORTA_COFRE = 8974;
const FALSO = 'http://127.0.0.1:' + PORTA_FALSO;
const COFRE = 'http://127.0.0.1:' + PORTA_COFRE;
const CHAVE = '7c'.repeat(32);
const SENHA = 'senha-bem-longa-9';

/* Quem é dono de quê. O "dono" é quem pôs as variáveis no servidor. */
const DONO = { email: 'dono@auditeste.com.br', jira: 'token-jira-do-dono', zephyr: 'token-zephyr-do-dono', projeto: 'DONO' };
const A = { email: 'admin@clientea.com', jira: 'token-jira-da-equipe-A', zephyr: 'token-zephyr-da-equipe-A', projeto: 'AAA' };
const B = { email: 'admin@clienteb.com', jira: 'token-jira-da-equipe-B', zephyr: 'token-zephyr-da-equipe-B', projeto: 'BBB' };
const DONOS = [DONO, A, B];

let falhas = 0, feitos = 0;
async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Jira e Zephyr de mentira: um token só abre o projeto dele ---------- */
const visto = [];
const falso = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const responder = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const auth = String(req.headers.authorization || '');

    if (u.pathname.startsWith('/v2/')) {
      const projeto = u.searchParams.get('projectKey');
      const dono = DONOS.find(d => auth === 'Bearer ' + d.zephyr);
      visto.push({ servico: 'zephyr', projeto, token: dono ? dono.zephyr : auth });
      if (!dono || dono.projeto !== projeto) return responder(401, { message: 'token nao e deste projeto' });
      if (u.pathname === '/v2/testcases') return responder(200, { values: [{ key: projeto + '-T1', name: 'Caso de ' + projeto }] });
      if (u.pathname === '/v2/testcycles') return responder(200, { values: [{ key: projeto + '-R1', name: 'Ciclo de ' + projeto }] });
      if (u.pathname === '/v2/statuses') return responder(200, { values: [{ name: 'Pass' }, { name: 'Fail' }, { name: 'In Progress' }, { name: 'Blocked' }] });
      return responder(404, { message: 'rota de mentira' });
    }

    const dono = DONOS.find(d => auth === 'Basic ' + Buffer.from(d.email + ':' + d.jira).toString('base64'));
    const cam = u.pathname.replace(/^\/jira/, '');
    const m = cam.match(/^\/rest\/api\/3\/project\/([A-Z]+)$/);
    visto.push({ servico: 'jira', projeto: m ? m[1] : null, token: dono ? dono.jira : auth });
    if (!dono) return responder(401, { errorMessages: ['sem credencial'] });
    if (cam === '/rest/api/3/myself') return responder(200, { displayName: 'Conta de ' + dono.projeto, emailAddress: dono.email });
    if (m) {
      if (m[1] !== dono.projeto) return responder(404, { errorMessages: ['projeto de outro cliente'] });
      return responder(200, { key: m[1], issueTypes: [{ id: '1', name: 'Bug', subtask: false }] });
    }
    responder(404, { errorMessages: ['rota de mentira'] });
  });
});

function navegador() {
  let cookie = '';
  return {
    async pedir(caminho, corpo) {
      const o = { method: corpo !== undefined ? 'POST' : 'GET', headers: {} };
      if (cookie) o.headers.cookie = cookie;
      if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
      const r = await fetch(COFRE + caminho, o);
      for (const s of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) cookie = s.split(';')[0];
      const texto = await r.text();
      let d = null; try { d = JSON.parse(texto); } catch (_) { d = texto; }
      return { status: r.status, corpo: d, texto };
    },
    async entrar(email) {
      const r = await this.pedir('/api/entrar', { email, senha: SENHA });
      assert.strictEqual(r.status, 200, 'login de ' + email + ': ' + r.texto);
      return this;
    }
  };
}

const configDe = (d, extra) => Object.assign({
  jira: { base: FALSO + '/jira', email: d.email, token: d.jira, projeto: d.projeto },
  zephyr: { token: d.zephyr, projeto: d.projeto }
}, extra || {});

(async () => {
  await new Promise(ok => falso.listen(PORTA_FALSO, '127.0.0.1', ok));

  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'integ-')), 'c.db');
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(arq);
  const hash = contas.hashSenha(SENHA);
  const equipe = (nome, pessoas) => {
    const t = banco.criarTenant(nome, 90);
    for (const [email, papel] of pessoas) banco.vincular(t.id, banco.criarUsuario(email, hash).id, papel);
    return t;
  };
  equipe('Auditeste', [[DONO.email, 'admin'], ['colega@auditeste.com.br', 'admin']]);
  const tA = equipe('Cliente A', [[A.email, 'admin'], ['gestor@clientea.com', 'gestor'], ['consultor@clientea.com', 'consultor']]);
  const tB = equipe('Cliente B', [[B.email, 'admin']]);
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA_COFRE), HOST: '127.0.0.1', COFRE_BANCO: arq, COFRE_CHAVE: CHAVE,
      COFRE_SEGREDO: 'segredo-integracoes', AGENTE_API_KEY: '', PONTE_TOKEN: '',
      /* As variaveis do dono do servidor: e delas que conta nova nao pode herdar. */
      JIRA_BASE: FALSO + '/jira', JIRA_EMAIL: DONO.email, JIRA_API_TOKEN: DONO.jira, JIRA_PROJETO: DONO.projeto,
      ZEPHYR_BASE: FALSO + '/v2', ZEPHYR_API_TOKEN: DONO.zephyr, ZEPHYR_PROJETO: DONO.projeto, ZEPHYR_CICLO: ''
    }),
    stdio: 'ignore'
  });

  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(COFRE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o cofre nao subiu');
      await delay(250);
    }
    const a = await navegador().entrar(A.email);
    const b = await navegador().entrar(B.email);
    const dono = await navegador().entrar(DONO.email);
    const gestor = await navegador().entrar('gestor@clientea.com');
    const consultor = await navegador().entrar('consultor@clientea.com');

    console.log('\nas variaveis do servidor nao sao de todo mundo\n');

    await caso('CRITERIO: conta de cliente nao herda o Jira nem o Zephyr de quem subiu o servidor', async () => {
      visto.length = 0;
      assert.deepStrictEqual((await a.pedir('/api/jira')).corpo, { configurado: false });
      assert.deepStrictEqual((await a.pedir('/api/zephyr')).corpo, { configurado: false });
      assert.strictEqual((await a.pedir('/api/zephyr/casos')).status, 503);
      assert.strictEqual((await a.pedir('/api/jira/bug', { titulo: 'x', passos: [] })).status, 503);
      assert.strictEqual(visto.length, 0, 'saiu pedido para o Jira ou Zephyr do dono: ' + JSON.stringify(visto));
      assert.strictEqual((await a.pedir('/api/integracoes')).corpo.origem, null);
    });

    await caso('CRITERIO: nem o dono do JIRA_EMAIL herda as variaveis do servidor', async () => {
      visto.length = 0;
      /* O servidor subiu com JIRA_* e ZEPHYR_* no ambiente, e mesmo assim a
       * sessao do dono desse e-mail nasce sem integracao: as variaveis nao
       * configuram sessao nenhuma, so a instancia do modulo. */
      assert.deepStrictEqual((await dono.pedir('/api/jira')).corpo, { configurado: false });
      assert.deepStrictEqual((await dono.pedir('/api/zephyr')).corpo, { configurado: false });
      assert.strictEqual((await dono.pedir('/api/zephyr/casos')).status, 503);
      assert.strictEqual((await dono.pedir('/api/integracoes')).corpo.origem, null);
      assert.strictEqual(visto.length, 0, 'saiu pedido para o Jira ou Zephyr do servidor: ' + JSON.stringify(visto));
    });

    console.log('\ncada equipe com o Jira e o Zephyr dela\n');

    await caso('as duas equipes configuram as integracoes delas', async () => {
      const ra = await a.pedir('/api/integracoes', configDe(A));
      const rb = await b.pedir('/api/integracoes', configDe(B));
      assert.strictEqual(ra.status, 200, ra.texto);
      assert.strictEqual(rb.status, 200, rb.texto);
      assert.deepStrictEqual([ra.corpo.origem, ra.corpo.jira.projeto, rb.corpo.zephyr.projeto], ['equipe', 'AAA', 'BBB']);
    });

    await caso('CRITERIO: ao mesmo tempo, cada equipe so fala com o token e o projeto dela', async () => {
      visto.length = 0;
      const [ca, cb, ta, tb] = await Promise.all([
        a.pedir('/api/zephyr/casos'), b.pedir('/api/zephyr/casos'),
        a.pedir('/api/integracoes/conferir', {}), b.pedir('/api/integracoes/conferir', {})
      ]);
      assert.deepStrictEqual(ca.corpo.casos.map(c => c.chave), ['AAA-T1'], ca.texto);
      assert.deepStrictEqual(cb.corpo.casos.map(c => c.chave), ['BBB-T1'], cb.texto);
      assert.deepStrictEqual([ta.corpo.jira.ok, ta.corpo.jira.conta, ta.corpo.jira.tipoBug, ta.corpo.zephyr.ok],
        [true, 'Conta de AAA', 'Bug', true], ta.texto);
      assert.deepStrictEqual([tb.corpo.jira.conta, tb.corpo.zephyr.projeto], ['Conta de BBB', 'BBB'], tb.texto);
      /* O que saiu do servidor: token e projeto sempre do mesmo dono. */
      for (const v of visto) {
        const d = DONOS.find(x => x.jira === v.token || x.zephyr === v.token);
        assert.ok(d, 'pedido com credencial desconhecida: ' + JSON.stringify(v));
        if (v.projeto) assert.strictEqual(v.projeto, d.projeto, 'credencial de uma equipe no projeto de outra: ' + JSON.stringify(v));
        assert.notStrictEqual(d, DONO, 'equipe configurada usou a credencial do servidor');
      }
      assert.ok(visto.some(v => v.token === A.zephyr) && visto.some(v => v.token === B.jira), 'faltou pedido de alguma equipe');
    });

    console.log('\no token entra e nao sai\n');

    await caso('CRITERIO: nenhuma rota devolve o token guardado', async () => {
      const respostas = [await a.pedir('/api/integracoes'), await a.pedir('/api/integracoes/conferir', {}),
        await a.pedir('/api/auditoria?limite=100'), await a.pedir('/api/eu'), await gestor.pedir('/api/integracoes')];
      for (const r of respostas) {
        assert.ok(!r.texto.includes(A.jira) && !r.texto.includes(A.zephyr), 'vazou token em: ' + r.texto.slice(0, 160));
      }
      assert.deepStrictEqual(respostas[0].corpo.jira,
        { base: FALSO + '/jira', email: A.email, projeto: 'AAA', tipoBug: '', temToken: true });
    });

    await caso('CRITERIO: no arquivo do banco a configuracao esta cifrada', async () => {
      const bytes = Buffer.concat([arq, arq + '-wal'].filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f)));
      for (const segredo of [A.jira, A.zephyr, B.jira, B.zephyr]) {
        assert.ok(!bytes.includes(Buffer.from(segredo)), 'token em texto no disco: ' + segredo);
      }
      assert.ok(!bytes.includes(Buffer.from('"projeto":"AAA"')), 'a configuracao inteira devia estar cifrada');
    });

    await caso('token vazio mantem o guardado; trocar o endereco ou a conta exige o token de novo', async () => {
      const mesmo = await a.pedir('/api/integracoes', configDe(A, { jira: { base: FALSO + '/jira', email: A.email, token: '', projeto: 'AAA', tipoBug: 'Bug' },
        zephyr: { token: '', projeto: 'AAA' } }));
      assert.strictEqual(mesmo.status, 200, mesmo.texto);
      assert.strictEqual((await a.pedir('/api/integracoes/conferir', {})).corpo.jira.ok, true, 'o token guardado se perdeu');

      const outroEndereco = await a.pedir('/api/integracoes', { jira: { base: 'https://outra.atlassian.net', email: A.email, token: '', projeto: 'AAA' } });
      assert.strictEqual(outroEndereco.status, 400);
      assert.ok(/Informe o token do Jira/.test(outroEndereco.corpo.erro), outroEndereco.texto);
      const outraConta = await a.pedir('/api/integracoes', { jira: { base: FALSO + '/jira', email: 'outra@clientea.com', token: '', projeto: 'AAA' } });
      assert.strictEqual(outraConta.status, 400, 'o token antigo iria junto para outra conta');
      assert.strictEqual((await a.pedir('/api/integracoes')).corpo.jira.email, A.email, 'pedido recusado mudou a configuracao');
    });

    console.log('\no que a tela manda nao e confianca\n');

    await caso('CRITERIO: endereco que nao e Jira Cloud e recusado, e nada sai do servidor para ele', async () => {
      visto.length = 0;
      const ruins = ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:' + PORTA_FALSO, 'http://localhost/jira',
        'https://evil.example.com', 'https://empresa.atlassian.net.evil.com', 'https://atlassian.net',
        'http://empresa.atlassian.net', 'https://empresa.atlassian.net@evil.com', 'https://empresa.atlassian.net/x', 'file:///etc/passwd'];
      for (const base of ruins) {
        const r = await b.pedir('/api/integracoes', { jira: { base, email: B.email, token: B.jira, projeto: 'BBB' } });
        assert.strictEqual(r.status, 400, 'aceitou ' + base + ': ' + r.texto);
        assert.ok(/atlassian\.net/.test(r.corpo.erro), r.texto);
      }
      assert.strictEqual(visto.length, 0);
      assert.strictEqual((await b.pedir('/api/integracoes')).corpo.jira.base, FALSO + '/jira', 'pedido recusado mudou a configuracao');
      const cloud = await b.pedir('/api/integracoes', { jira: { base: 'https://Cliente-B.atlassian.net/', email: B.email, token: B.jira, projeto: 'BBB' } });
      assert.strictEqual(cloud.corpo.jira.base, 'https://cliente-b.atlassian.net', cloud.texto);
      await b.pedir('/api/integracoes', configDe(B));
    });

    await caso('projeto, ciclo e token malformados sao recusados com mensagem que explica', async () => {
      const base = configDe(A);
      const casos = [
        [{ jira: Object.assign({}, base.jira, { projeto: 'gov 1' }) }, /sigla/],
        [{ jira: Object.assign({}, base.jira, { email: 'sem-arroba' }) }, /e-mail/],
        [{ jira: Object.assign({}, base.jira, { token: 'curto' }) }, /não parece um token/],
        [{ jira: Object.assign({}, base.jira, { token: 'token com espaco no meio' }) }, /não parece um token/],
        [{ zephyr: { token: A.zephyr, projeto: 'AAA', ciclo: 'AAA-12' } }, /ciclo/],
        [{ zephyr: { token: A.zephyr, projeto: '' } }, /sigla/]
      ];
      for (const [corpo, esperado] of casos) {
        const r = await a.pedir('/api/integracoes', corpo);
        assert.strictEqual(r.status, 400, JSON.stringify(corpo) + ' -> ' + r.texto);
        assert.ok(esperado.test(r.corpo.erro), r.corpo.erro);
      }
    });

    await caso('CRITERIO: so o administrador grava; gestor le e testa; consultor nem le', async () => {
      const g = await gestor.pedir('/api/integracoes');
      assert.deepStrictEqual([g.status, g.corpo.podeEditar, g.corpo.jira.projeto], [200, false, 'AAA']);
      assert.strictEqual((await gestor.pedir('/api/integracoes/conferir', {})).status, 200);
      assert.strictEqual((await gestor.pedir('/api/integracoes', configDe(B))).status, 403);
      assert.strictEqual((await consultor.pedir('/api/integracoes')).status, 403);
      assert.strictEqual((await consultor.pedir('/api/integracoes', configDe(B))).status, 403);
      /* O consultor usa a integracao da equipe, sem poder ver nem mexer nela. */
      assert.deepStrictEqual((await consultor.pedir('/api/zephyr/casos')).corpo.casos.map(c => c.chave), ['AAA-T1']);
      assert.strictEqual((await fetch(COFRE + '/api/integracoes')).status, 401);
    });

    await caso('salvar fica na auditoria da propria equipe, com o destino e sem token', async () => {
      const da = (await a.pedir('/api/auditoria?limite=100')).corpo.eventos.filter(e => e.acao === 'integracao.salva');
      assert.ok(da.length >= 1 && /Jira .*\(AAA\) · Zephyr AAA/.test(da[0].recurso), JSON.stringify(da[0]));
      const db = (await b.pedir('/api/auditoria?limite=100')).texto;
      assert.ok(!db.includes('AAA'), 'a auditoria de B mostra o que A fez');
    });

    await caso('remover: bloco nulo apaga, e a equipe volta a nao ter integracao', async () => {
      const so = await b.pedir('/api/integracoes', { jira: null, zephyr: { token: '', projeto: 'BBB' } });
      assert.deepStrictEqual([so.corpo.jira, so.corpo.zephyr.temToken], [null, true], so.texto);
      assert.deepStrictEqual((await b.pedir('/api/jira')).corpo, { configurado: false });
      assert.deepStrictEqual((await b.pedir('/api/zephyr')).corpo, { configurado: true });
      await b.pedir('/api/integracoes', { jira: null, zephyr: null });
      assert.deepStrictEqual((await b.pedir('/api/zephyr')).corpo, { configurado: false });
      assert.strictEqual((await b.pedir('/api/integracoes')).corpo.origem, null);
      /* A da equipe A nao foi tocada. */
      assert.deepStrictEqual((await a.pedir('/api/jira')).corpo, { configurado: true });
    });
  } finally {
    proc.kill();
    await delay(600);
  }

  console.log('\nno banco\n');

  /* Sem o servidor: as mesmas funcoes, direto no arquivo que ele usou. */
  process.env.COFRE_CHAVE = CHAVE;
  banco.abrir(arq);
  const integracoes = require('./cofre/integracoes.js');

  await caso('apagar a equipe leva a configuracao junto', () => {
    assert.ok(banco.integracaoDoTenant(tA.id), 'a configuracao de A devia estar no banco');
    banco.apagarTenant(tA.id);
    assert.strictEqual(banco.integracaoDoTenant(tA.id), null, 'ficou token de equipe apagada');
  });

  await caso('CRITERIO: sem a chave de cifra o servidor nao guarda token', () => {
    delete process.env.COFRE_CHAVE;
    try {
      assert.throws(() => integracoes.salvar({ tenantId: tB.id, usuarioId: 'x' }, { zephyr: { token: B.zephyr, projeto: 'BBB' } }),
        e => e.status === 503 && /chave de cifra/.test(e.message));
      assert.strictEqual(banco.integracaoDoTenant(tB.id), null);
    } finally { process.env.COFRE_CHAVE = CHAVE; }
  });

  await caso('chave de cifra trocada: a configuracao vale como ausente, sem derrubar nada', () => {
    integracoes.salvar({ tenantId: tB.id, usuarioId: 'x' }, { zephyr: { token: B.zephyr, projeto: 'BBB' } });
    process.env.COFRE_CHAVE = 'ab'.repeat(32);
    try { assert.strictEqual(banco.integracaoDoTenant(tB.id), null); }
    finally { process.env.COFRE_CHAVE = CHAVE; }
    assert.strictEqual(banco.integracaoDoTenant(tB.id).zephyr.projeto, 'BBB');
  });

  banco.fechar();
  falso.close();
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (' + feitos + ' casos)\n');
  process.exit(falhas ? 1 : 0);
})().catch(err => { console.error('\nERRO GERAL: ' + err.message + '\n' + err.stack); process.exit(1); });
