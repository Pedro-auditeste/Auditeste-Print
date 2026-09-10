/* O cofre tem de mostrar o alvo (xpath e id), nao so titulo e print.
 *
 * O produto virou "id e xpath primeiro", mas quem recebe a evidencia abre o
 * COFRE, e la a tela mostrava titulo, observacao e a imagem. O localizador
 * chegava na API e morria sem ser desenhado.
 *
 * Cobre tambem o custo da tela: era uma ida ao servidor POR evidencia.
 *
 *   node teste-alvo-no-cofre.js
 *   node teste-alvo-no-cofre.js --visivel
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const VISIVEL = process.argv.includes('--visivel');
const PORTA = 8993;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-alvo-')), 'cofre.db');

const XPATH_COM_ID = '//*[@id="btnSalvar"]';
const XPATH_SEM_ID = '//*[@id="painel"]/div[2]/button';

let falhas = 0, feitos = 0, proc = null, navegador = null;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) {
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

(async () => {
  banco.abrir(ARQUIVO);
  const tenant = banco.criarTenant('Cliente do Alvo', 90);
  const u = banco.criarUsuario('qa@auditeste.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(tenant.id, u.id, 'admin');
  const proj = banco.criarProjeto(tenant.id, u.id, 'Portal do Cliente', 'Teste');
  const exec = banco.criarExecucao(tenant.id, u.id, proj.id, 'Fluxo de cadastro');
  banco.criarEvidencia(tenant.id, u.id, exec.id, {
    ordem: 1, titulo: 'clique · Salvar', obs: '', acao: 'clique',
    elemento: XPATH_COM_ID, valor: '', html: '', url_antes: '', url_depois: ''
  }, 90);
  banco.criarEvidencia(tenant.id, u.id, exec.id, {
    ordem: 2, titulo: 'clique · Continuar', obs: '', acao: 'clique',
    elemento: XPATH_SEM_ID, valor: '', html: '', url_antes: '', url_depois: ''
  }, 90);
  banco.fechar();

  proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1',
      COFRE_BANCO: ARQUIVO, COFRE_SEGREDO: 'segredo-do-alvo',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stderr.on('data', d => process.stdout.write('    [err] ' + d));
  await esperarServidor();

  const chrome = await Promise.resolve(puppeteer.executablePath()).catch(() => undefined);
  navegador = await puppeteer.launch({
    headless: !VISIVEL, executablePath: chrome, protocolTimeout: 40000,
    defaultViewport: VISIVEL ? null : { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));
  pagina.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  /* Conta as idas ao servidor: e assim que se prova que a tela deixou de
   * pedir uma evidencia por vez. */
  const chamadas = [];
  pagina.on('request', r => { if (r.url().indexOf('/api/evidencias') >= 0) chamadas.push(r.url()); });

  console.log('\nalvo (xpath e id) no cofre\n');

  await caso('entra no cofre', async () => {
    await pagina.goto(BASE + '/cofre.html', { waitUntil: 'load', timeout: 30000 });
    await pagina.waitForSelector('#telaEntrar:not([hidden])', { timeout: 10000 });
    await pagina.type('#email', 'qa@auditeste.com');
    await pagina.type('#senha', 'senha-bem-longa-9');
    await pagina.click('#btnEntrar');
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
  });

  await caso('abre o projeto e lista a execucao', async () => {
    await pagina.$eval('[data-projeto]', el => el.click());
    await pagina.waitForSelector('#telaProjeto:not([hidden]) .item', { timeout: 15000 });
  });

  await caso('CRITERIO: o xpath aparece na tela', async () => {
    const codigos = await pagina.$$eval('#listaExecucoes .alvo code', els => els.map(e => e.textContent));
    if (codigos.indexOf(XPATH_COM_ID) < 0) throw new Error('sem o xpath: ' + JSON.stringify(codigos));
    if (codigos.indexOf(XPATH_SEM_ID) < 0) throw new Error('sem o xpath posicional: ' + JSON.stringify(codigos));
  });

  await caso('CRITERIO: o id sai do xpath e aparece separado', async () => {
    const rotulos = await pagina.$$eval('#listaExecucoes .alvo',
      els => els.map(e => e.querySelector('.rot').textContent + '=' + e.querySelector('code').textContent));
    if (rotulos.indexOf('id=btnSalvar') < 0) throw new Error('sem a linha do id: ' + JSON.stringify(rotulos));
  });

  await caso('CRITERIO: xpath posicional nao inventa id', async () => {
    const ids = await pagina.$$eval('#listaExecucoes .alvo',
      els => els.filter(e => e.querySelector('.rot').textContent === 'id')
               .map(e => e.querySelector('code').textContent));
    if (ids.length !== 1) throw new Error('so o primeiro passo tem id proprio, vieram: ' + JSON.stringify(ids));
  });

  await caso('CRITERIO: uma ida ao servidor por execucao, nao por evidencia', async () => {
    /* 2 evidencias: antes era 1 (lista) + 2 (detalhe) = 3. */
    if (chamadas.length !== 1) throw new Error(chamadas.length + ' chamadas: ' + JSON.stringify(chamadas));
  });

  await caso('CRITERIO: o botao Copiar existe em cada localizador', async () => {
    const n = await pagina.$$eval('#listaExecucoes .alvo .copiar', els => els.length);
    const alvos = await pagina.$$eval('#listaExecucoes .alvo', els => els.length);
    if (n !== alvos) throw new Error(n + ' botoes para ' + alvos + ' localizadores');
  });

  await caso('a pagina nao soltou erro nenhum', async () => {
    if (erros.length) throw new Error(erros.join(' | '));
  });

  await navegador.close(); navegador = null;
  proc.kill(); proc = null;

  console.log('\n' + feitos + ' ok, ' + falhas + ' falha(s)\n');
  process.exit(falhas ? 1 : 0);
})().catch(async e => {
  console.error('QUEBROU:', e.message);
  if (navegador) await navegador.close().catch(() => {});
  if (proc) proc.kill();
  process.exit(1);
});
