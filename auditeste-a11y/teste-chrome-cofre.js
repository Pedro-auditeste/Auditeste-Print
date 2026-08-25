/* O cofre num navegador de verdade, servido pela ponte.
 *
 * O teste-cofre.js bate na API com fetch. Isto aqui é o que nenhum deles
 * cobria: a página de entrada, o cookie viajando sozinho, o <img> buscando
 * o print pela rota autorizada, e o botão Enviar ao cofre dentro do Print.
 *
 *   node teste-chrome-cofre.js
 *   node teste-chrome-cofre.js --visivel
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const VISIVEL = process.argv.includes('--visivel');
const PORTA = 8991;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-nav-')), 'cofre.db');

let falhas = 0, feitos = 0, proc = null, navegador = null;
const delay = ms => new Promise(r => setTimeout(r, ms));

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

async function esperarServidor() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + '/ping'); if (r.ok) { await r.text(); return; } }
    catch (e) { /* subindo */ }
    await delay(250);
  }
  throw new Error('o servidor não subiu');
}

/* Conexao curta para conferir o banco.
 *
 * Segurar o arquivo aberto no processo do teste enquanto o servidor tambem o
 * usa travava o servidor no meio da corrida. Em producao isso nao acontece
 * (medido: rodar o admin.js com o servidor no ar responde em 2 ms), mas o
 * teste nao pode criar uma contencao que o sistema real nao tem. */
function conferir(fn) {
  banco.abrir(ARQUIVO);
  try { return fn(); } finally { banco.fechar(); }
}

const PIXEL_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  banco.abrir(ARQUIVO);
  const tenant = banco.criarTenant('Cliente de Teste', 90);
  const u = banco.criarUsuario('qa@auditeste.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  banco.fechar();

  proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1',
      COFRE_BANCO: ARQUIVO, COFRE_SEGREDO: 'segredo-navegador',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', d => process.stdout.write('    [srv] ' + d));
  proc.stderr.on('data', d => process.stdout.write('    [err] ' + d));
  await esperarServidor();

  const chrome = await Promise.resolve(puppeteer.executablePath()).catch(() => undefined);
  navegador = await puppeteer.launch({
    headless: !VISIVEL,
    executablePath: chrome,
    defaultViewport: VISIVEL ? null : { width: 1280, height: 900 },
    protocolTimeout: 40000,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  console.log('\ncofre no navegador\n');

  await caso('a pagina do cofre abre e pede entrada', async () => {
    await pagina.goto(BASE + '/cofre.html', { waitUntil: 'load', timeout: 30000 });
    await pagina.waitForSelector('#telaEntrar:not([hidden])', { timeout: 10000 });
  });

  await caso('a aba Criar conta abre e pede o nome da equipe', async () => {
    await pagina.click('#abaCriar');
    await pagina.waitForSelector('#painelCriar:not([hidden])', { timeout: 10000 });
    const equipeVisivel = await pagina.$eval('#campoEquipe', el => !el.hidden);
    if (!equipeVisivel) throw new Error('sem convite, o nome da equipe tem que ser pedido');
  });

  await caso('colar um convite esconde o campo de equipe', async () => {
    await pagina.type('#novoConvite', 'qualquer-coisa');
    await pagina.waitForFunction(
      () => document.getElementById('campoEquipe').hidden, { timeout: 10000 });
    await pagina.$eval('#novoConvite', el => { el.value = ''; });
    await pagina.$eval('#novoConvite', el => el.dispatchEvent(new Event('input')));
  });

  await caso('criar conta pela tela cria uma equipe nova', async () => {
    await pagina.type('#novoEmail', 'time@amazon.com');
    await pagina.type('#novaSenha', 'senha-bem-longa-am');
    await pagina.type('#novaEquipe', 'Amazon');
    await pagina.click('#btnCriar');
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    const quem = await pagina.$eval('#quem', el => el.textContent);
    if (!/Amazon/.test(quem)) throw new Error('cabecalho sem a equipe nova: ' + quem);
    if (!/admin/.test(quem)) throw new Error('quem cria a equipe deveria ser admin: ' + quem);
    const projetos = await pagina.$$eval('[data-projeto]', els => els.length);
    if (projetos !== 0) throw new Error('equipe nova ja nasceu com projeto: ' + projetos);
  });

  await caso('sair da equipe nova e voltar para a tela de entrada', async () => {
    await pagina.click('#btnSair');
    await pagina.waitForSelector('#telaEntrar:not([hidden])', { timeout: 15000 });
  });

  await caso('senha errada mostra o aviso, nao entra', async () => {
    await pagina.type('#email', 'qa@auditeste.com');
    await pagina.type('#senha', 'errada');
    await pagina.click('#btnEntrar');
    await pagina.waitForSelector('.aviso.ruim', { timeout: 10000 });
    const visivel = await pagina.$eval('#telaEntrar', el => !el.hidden);
    if (!visivel) throw new Error('saiu da tela de entrada mesmo com senha errada');
  });

  await caso('login correto abre a lista de projetos', async () => {
    await pagina.$eval('#senha', el => { el.value = ''; });
    await pagina.type('#senha', 'senha-bem-longa-9');
    await pagina.click('#btnEntrar');
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    const quem = await pagina.$eval('#quem', el => el.textContent);
    if (!/qa@auditeste\.com/.test(quem)) throw new Error('cabeçalho sem o usuário: ' + quem);
    if (!/Cliente de Teste/.test(quem)) throw new Error('cabeçalho sem o cliente: ' + quem);
  });

  await caso('a retencao do cliente aparece na tela', async () => {
    const t = await pagina.$eval('#metaTenant', el => el.textContent);
    if (!/90 dias/.test(t)) throw new Error('não diz o prazo: ' + t);
  });

  console.log('\nprint · enviar ao cofre\n');

  const print = await navegador.newPage();
  const errosPrint = [];
  print.on('pageerror', e => errosPrint.push('pageerror: ' + e.message));
  print.on('console', m => { if (m.type() === 'error') errosPrint.push('console: ' + m.text()); });

  await caso('o Print abre servido pela ponte', async () => {
    await print.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await print.waitForSelector('#entrarSite', { timeout: 15000 });
    await print.click('#entrarSite');
    await print.waitForSelector('#telaProjetos.ativa', { timeout: 15000 });
  });

  await caso('o link do cofre aparece quando o cofre esta ligado', async () => {
    await print.waitForFunction(
      () => { const el = document.getElementById('linkCofre'); return el && !el.hidden; },
      { timeout: 15000 });
  });

  await caso('semeia projeto e evidencia no banco local do Print', async () => {
    const r = await print.evaluate(async (b64) => {
      const bd = await new Promise((ok, err) => {
        const q = indexedDB.open('auditeste_evidencias', 2);
        q.onsuccess = e => ok(e.target.result);
        q.onerror = () => err(q.error);
      });
      /* Espera a TRANSACAO fechar, nao so o pedido responder.
       *
       * onsuccess do add dispara antes do commit. Recarregar a pagina nesse
       * instante, com a maquina ocupada, perdia o registro e o teste falhava
       * dizendo que o botao nao existia, quando o que faltava era o dado. */
      const põe = (loja, valor) => new Promise((ok, err) => {
        const tx = bd.transaction(loja, 'readwrite');
        const pedido = tx.objectStore(loja).add(valor);
        let id = null;
        pedido.onsuccess = () => { id = pedido.result; };
        tx.oncomplete = () => ok(id);
        tx.onerror = () => err(tx.error);
        tx.onabort = () => err(tx.error);
      });
      const pid = await põe('projetos', { nome: 'Portal do Cliente', cliente: 'Teste', criadoEm: Date.now() });
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bin], { type: 'image/png' });
      const rid = await põe('registros', {
        projetoId: pid, projetoNome: 'Portal do Cliente',
        ficha: { registro: 'Login e busca', modulo: 'Acesso', resultado: 'Aprovado' },
        passos: [
          { titulo: 'Abrir a tela de acesso', obs: 'Tela inicial', acao: 'Clicar', elemento: '#entrar',
            valor: '', html: '<button id="entrar">Entrar</button>', urlAntes: 'https://x/a', urlDepois: 'https://x/b',
            imagens: [{ blob, legenda: 'antes' }, { blob, legenda: 'depois' }] },
          { titulo: 'Buscar produto', obs: 'Resultado da busca', acao: 'Preencher', elemento: '#busca',
            valor: 'caneta', html: '<input id="busca">', urlAntes: 'https://x/b', urlDepois: 'https://x/c',
            imagens: [{ blob, legenda: 'depois' }] }
        ],
        video: null, criadoEm: Date.now()
      });
      return { pid, rid };
    }, PIXEL_B64);
    if (!r.rid) throw new Error('não gravou o registro');
  });

  await caso('abre a evidencia e o botao Enviar ao cofre esta la', async () => {
    await print.reload({ waitUntil: 'load' });
    await print.waitForSelector('#entrarSite', { timeout: 15000 });
    await print.click('#entrarSite');
    await print.waitForSelector('#telaProjetos.ativa', { timeout: 15000 });
    await print.waitForSelector('.cartao[data-projeto]', { timeout: 15000 });
    await print.click('.cartao[data-projeto]');
    await print.waitForSelector('#telaProjeto.ativa', { timeout: 15000 });
    // O cartao inteiro nao abre nada: quem abre e o botao Abrir.
    await print.waitForSelector('.registro [data-abrir]', { timeout: 15000 });
    await print.click('.registro [data-abrir]');
    await print.waitForSelector('#telaRegistro.ativa', { timeout: 15000 });
    await print.waitForSelector('[data-acao="publicarCofre"]', { timeout: 15000 });
  });

  await caso('o Print enxerga a mesma sessao do cofre (mesma origem)', async () => {
    const eu = await print.evaluate(async () => (await (await fetch('/api/eu')).json()));
    if (!eu.autenticado) throw new Error('a aba do Print não recebeu a sessão');
    if (eu.tenantNome !== 'Cliente de Teste') throw new Error('cliente errado: ' + eu.tenantNome);
  });

  await caso('CRITERIO: publicar leva os passos e os prints para o servidor', async () => {
    await print.click('[data-acao="publicarCofre"]');
    // Duas confirmações: a de aviso do cofre. Aceita a que aparecer.
    await print.waitForSelector('#fundoConfirma.aberto', { timeout: 15000 });
    await print.click('#btnSim');
    await print.waitForFunction(
      () => /guardados no cofre|Nao consegui|Falha/i.test(document.body.innerText),
      { timeout: 60000 });
    const texto = await print.evaluate(() => document.body.innerText);
    if (/Nao consegui|Falha ao enviar/i.test(texto)) {
      throw new Error('a publicação falhou: ' + (texto.match(/Nao consegui[^\n]*/) || [''])[0]);
    }
  });

  await caso('o servidor tem as evidencias, com os arquivos', async () => {
    conferir(() => {
      const projetos = banco.listarProjetos(tenant.id);
      if (projetos.length !== 1) throw new Error('projetos no servidor: ' + projetos.length);
      const execs = banco.listarExecucoes(tenant.id, projetos[0].id);
      if (execs.length !== 1) throw new Error('execuções: ' + execs.length);
      const evid = banco.listarEvidencias(tenant.id, execs[0].id);
      if (evid.length !== 2) throw new Error('evidências: ' + evid.length + ', esperava 2');
      const comArquivo = evid.filter(e => banco.objetosDe(tenant.id, e.id).length);
      if (comArquivo.length !== 2) throw new Error('evidência sem print anexado');
      if (banco.objetosDe(tenant.id, evid[0].id).length !== 2) {
        throw new Error('o passo com antes e depois deveria ter 2 objetos');
      }
    });
  });

  await caso('o print aparece no cofre pela rota autorizada', async () => {
    /* bringToFront nao e enfeite: o Chrome congela aba em segundo plano, e
     * sem isto o reload e todo evaluate seguinte ficavam pendurados ate o
     * timeout do protocolo. A aba do cofre ficou atras da do Print. */
    await pagina.bringToFront();
    await pagina.reload({ waitUntil: 'load' });
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    await pagina.waitForSelector('[data-projeto]', { timeout: 15000 });
    await pagina.click('[data-projeto]');
    await pagina.waitForSelector('#telaProjeto:not([hidden])', { timeout: 15000 });
    await pagina.waitForSelector('.item img', { timeout: 20000 });
    const carregou = await pagina.$$eval('.item img',
      els => els.every(i => i.complete && i.naturalWidth > 0));
    if (!carregou) throw new Error('a imagem não carregou: a rota autorizada não serviu o arquivo');
  });

  await caso('sem sessao a mesma imagem nao carrega', async () => {
    await pagina.bringToFront();
    const src = await pagina.$eval('.item img', el => el.getAttribute('src'));
    const anonima = await navegador.createBrowserContext();
    const p2 = await anonima.newPage();
    const r = await p2.goto(BASE + src, { waitUntil: 'load' });
    const status = r.status();
    await anonima.close();
    if (status !== 401) throw new Error('sem sessão o arquivo respondeu ' + status + ', esperava 401');
  });

  await caso('a auditoria mostra o envio e o download', async () => {
    await pagina.bringToFront();
    // O botao de auditoria mora na lista de projetos, nao dentro de um deles.
    await pagina.click('#btnVoltar');
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    await pagina.click('#btnAuditoria');
    await pagina.waitForSelector('#telaAuditoria:not([hidden])', { timeout: 15000 });
    const texto = await pagina.$eval('#corpoAuditoria', el => el.textContent);
    for (const acao of ['login', 'projeto.criado', 'evidencia.criada', 'objeto.baixado']) {
      if (!texto.includes(acao)) throw new Error('auditoria sem ' + acao);
    }
    if (!texto.includes('qa@auditeste.com')) throw new Error('auditoria sem quem fez');
  });

  await caso('nenhuma das paginas jogou erro de javascript', () => {
    /* So pageerror. "Failed to load resource" entra no console por causa do
     * favicon que nao existe e do 401 que este teste provoca de proposito:
     * sao ruido esperado, e transformar ruido em falha ensina a ignorar o
     * teste. Erro de JavaScript, nao. */
    const todos = erros.concat(errosPrint).filter(e => e.startsWith('pageerror:'));
    if (todos.length) throw new Error(todos.slice(0, 3).join(' | '));
  });

  if (VISIVEL) { console.log('\nChrome fica aberto 30s...'); await delay(30000); }
})()
  .catch(err => { falhas++; console.log('\nERRO GERAL: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    if (navegador) { try { await navegador.close(); } catch (e) {} }
    if (proc) { try { proc.kill(); } catch (e) {} }
    try { banco.fechar(); } catch (e) {}
    console.log('\n' + feitos + ' passaram, ' + falhas + ' falharam\n');
    process.exit(falhas ? 1 : 0);
  });
