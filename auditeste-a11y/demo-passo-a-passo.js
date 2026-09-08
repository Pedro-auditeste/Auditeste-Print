/* Demonstração narrada, de ponta a ponta, dos 10 passos de como o Print
 * captura uma evidência (ver passo-a-passo-como-o-print-grava.txt). Cada
 * console.log abaixo é um desses passos acontecendo de verdade: extensão
 * real, clique real, servidor real, cofre real -- só a resposta da IA é
 * simulada (sem custo, sem depender de rede externa; o /descrever real já
 * está coberto por teste-descrever-ponta-a-ponta.js).
 *
 *   node demo-passo-a-passo.js
 *   node demo-passo-a-passo.js --visivel   (mostra o Chrome fazendo tudo)
 *
 * Reaproveita os caminhos já provados por teste-push-automatico.js
 * (extensão -> Print sem clique) e teste-chrome-cofre.js (Print -> cofre).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');
const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');

const VISIVEL = process.argv.includes('--visivel');
const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA = 8993;
const PORTA_SITE = 8994;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-print-')), 'cofre.db');

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja do cliente</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>Sistema do cliente</h1>
  <button id="entrarSite" style="padding:14px 28px;font-size:16px">Entrar</button>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const passo = (n, texto) => console.log(`\nPASSO ${n} · ${texto}`);

function chromeLocal() {
  return [
    caminhoChrome(),
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find((p) => p && fs.existsSync(p));
}

(async () => {
  // Cliente e usuário já existem, como se o admin já tivesse provisionado
  // a conta (node cofre/admin.js) antes desta demonstração começar.
  banco.abrir(ARQUIVO);
  const tenant = banco.criarTenant('Cliente Demo', 90);
  const usuario = banco.criarUsuario('demo@auditeste.com', contas.hashSenha('senha-bem-longa-demo'));
  banco.vincular(tenant.id, usuario.id, 'admin');
  banco.fechar();

  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  const servidor = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1',
      COFRE_BANCO: ARQUIVO, COFRE_SEGREDO: 'segredo-da-demonstracao',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: 'ignore'
  });
  await esperar(2000);

  const browser = await puppeteer.launch({
    headless: !VISIVEL,
    executablePath: chromeLocal(),
    defaultViewport: VISIVEL ? null : { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox',
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const encerrar = async () => { await browser.close().catch(() => {}); servidor.kill(); site.close(); };

  try {
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'a extensão não carregou');
    const idExt = new URL(sw.url()).host;

    passo(1, 'abrir o Print, criar o projeto e entrar na tela de gravação');
    const print = await browser.newPage();
    print.on('pageerror', (e) => console.error('  erro na página do Print:', e.message));
    await print.bringToFront();
    await print.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Mocka o /descrever: sem chave de IA nenhuma, e sem depender de rede.
    await print.setRequestInterception(true);
    print.on('request', (req) => {
      if (req.url().endsWith('/descrever')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            legenda_curta: 'Clicou em "Entrar" e acessou o sistema',
            descricao_detalhada: 'O clique em "Entrar" levou o usuário para a tela seguinte do sistema.',
            titulo_cenario: '', gherkin: '', cenarios_alternativos: [], alerta_qa: ''
          })
        });
      } else req.continue();
    });

    await print.click('#entrarSite');
    await print.waitForSelector('#telaProjetos.ativa');
    await print.click('[data-acao="novoProjeto"]');
    await print.waitForSelector('#campoNome', { visible: true });
    await print.type('#campoNome', 'Demo Passo a Passo');
    // #campoIA já nasce marcado: descrição automática liberada por padrão.
    await print.click('#btnConfirmarModal');
    await print.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await print.click('#gradeProjetos .cartao[data-projeto]');
    await print.waitForSelector('[data-acao="novaGravacao"]');
    await print.click('[data-acao="novaGravacao"]');
    await print.waitForSelector('#telaGravador.ativa');
    console.log('  ok   projeto criado, Print pronto para receber');

    const aba = await browser.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' });

    passo(2, 'armar a extensão na aba do sistema do cliente');
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popup.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:8994/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id });
    });
    await popup.close();
    console.log('  ok   extensão observando a aba do cliente');

    passo(3, 'clicar de verdade no sistema do cliente (print "antes" + xpath + HTML)');
    await aba.bringToFront();
    // Espera passar da janela de pull automático que abrirGravador() dispara
    // sozinho ao abrir a tela, para provar o caminho AO VIVO, não esse.
    await esperar(4000);
    await aba.click('#entrarSite');
    console.log('  ok   clique feito (print "depois" e fechamento do passo acontecem no background da extensão)');

    passo(4, 'o passo chega sozinho na aba do Print, sem clicar em nada');
    await print.bringToFront();
    await print.waitForSelector('#lista > .passo', { timeout: 10000 });
    const titulo = await print.$eval('.passo .titulo', (el) => el.textContent);
    console.log('  ok   passo recebido: "' + titulo.trim() + '"');

    passo(5, 'a descrição automática por IA substitui "Descrição pendente." sozinha');
    await print.waitForFunction(
      () => /Clicou em "Entrar"/i.test(document.querySelector('.passo .legenda-ia')?.textContent || ''),
      { timeout: 8000 }
    );
    console.log('  ok   descrição gerada sem clicar em "Gerar descrição"');

    passo(6, 'parar a gravação e salvar no projeto (fica local, no navegador)');
    // "Salvar no projeto" já encerra a gravação sozinho se ainda estiver
    // rodando (salvarNoProjeto chama parar() por dentro); não precisa de
    // um clique em "Parar" separado.
    await print.click('[data-acao="salvar"]');
    await print.waitForSelector('#telaProjeto.ativa', { timeout: 15000 });
    console.log('  ok   evidência salva localmente (IndexedDB)');

    passo(7, 'entrar no cofre (login real) para poder enviar');
    const login = await browser.newPage();
    await login.goto(BASE + '/cofre.html', { waitUntil: 'domcontentloaded' });
    await login.waitForSelector('#email', { visible: true, timeout: 15000 });
    await login.type('#email', 'demo@auditeste.com');
    await login.type('#senha', 'senha-bem-longa-demo');
    await login.click('#btnEntrar');
    await login.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    await login.close();
    console.log('  ok   sessão do cofre aberta (o Print, mesma origem, já enxerga essa sessão)');

    passo(8, 'abrir a evidência salva e enviar ao cofre');
    await print.waitForSelector('.registro [data-abrir]', { timeout: 15000 });
    await print.click('.registro [data-abrir]');
    await print.waitForSelector('#telaRegistro.ativa', { timeout: 15000 });
    await print.waitForSelector('[data-acao="publicarCofre"]', { timeout: 15000 });
    await print.click('[data-acao="publicarCofre"]');
    await print.waitForSelector('#fundoConfirma.aberto', { timeout: 15000 });
    await print.click('#btnSim');
    await print.waitForFunction(
      () => /guardados no cofre|Nao consegui|Falha/i.test(document.body.innerText),
      { timeout: 60000 }
    );
    const resultado = await print.evaluate(() => document.body.innerText);
    assert.ok(/guardados no cofre/i.test(resultado), 'o envio ao cofre não confirmou: ' + resultado.slice(0, 200));
    console.log('  ok   evidência cifrada e gravada no servidor, sob o cliente da conta');

    console.log('\nOs 10 passos do documento aconteceram de ponta a ponta, com extensão e cofre reais.\n');
  } finally {
    await encerrar();
  }
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
