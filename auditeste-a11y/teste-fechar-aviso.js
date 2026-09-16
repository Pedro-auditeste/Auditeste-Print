/* Todo aviso que aparece por cima da tela pode ser fechado na hora.
 *
 *   node teste-fechar-aviso.js
 *
 * O aviso flutuante do Print ficava 3,6s por cima dos botões, e os avisos do
 * cofre que não somem sozinhos (erro, convite, volume) não tinham como sair.
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORTA = 8987;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-aviso-')), 'cofre.db');

let falhas = 0, proc = null, navegador = null;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function caso(nome, fn) {
  try { await fn(); console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}

(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO,
      COFRE_SEGREDO: 'segredo-aviso', AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: 'ignore'
  });
  for (let i = 0; ; i++) {
    try { const r = await fetch(BASE + '/ping'); if (r.ok) break; } catch (e) { /* subindo */ }
    if (i > 120) throw new Error('o servidor não subiu');
    await delay(250);
  }

  navegador = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('pageerror', e => erros.push(e.message));

  console.log('\nfechar avisos\n');

  const visivel = () => pagina.$eval('.aviso-toast', el => el.classList.contains('visivel'));

  await caso('Print: o aviso flutuante traz um X e fecha na hora', async () => {
    await pagina.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await pagina.click('#entrarSite');
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.click('#btnConfirmarModal'); // nome vazio: dispara o aviso
    await pagina.waitForSelector('.aviso-toast.visivel .aviso-fechar');
    const texto = await pagina.$eval('.aviso-toast .aviso-texto', el => el.textContent);
    if (!/nome/i.test(texto)) throw new Error('aviso inesperado: ' + texto);
    await pagina.click('.aviso-toast .aviso-fechar');
    await delay(100);
    if (await visivel()) throw new Error('clicou no X e o aviso continuou');
  });

  await caso('Print: o aviso nao rouba o clique do que esta embaixo dele', async () => {
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('.aviso-toast.visivel');
    await delay(400); // fim da animacao de entrada
    const alvo = await pagina.evaluate(() => {
      const r = document.querySelector('.aviso-toast .aviso-texto').getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return e && e.closest('.aviso-toast') ? 'o aviso' : 'o que esta embaixo';
    });
    if (alvo !== 'o que esta embaixo') throw new Error('o texto do aviso ainda captura o clique');
    // Pelo X: o Esc fecharia tambem o formulario, e o proximo caso precisa dele.
    await pagina.click('.aviso-toast .aviso-fechar');
    await delay(100);
  });

  await caso('Print: aviso fechado nao deixa o X alcançavel pelo Tab', async () => {
    const inerte = await pagina.$eval('.aviso-toast', el => el.inert);
    if (!inerte) throw new Error('fora da tela o X ainda recebe foco');
  });

  await caso('Print: o aviso volta normalmente depois de fechado', async () => {
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('.aviso-toast.visivel');
    if (await pagina.$eval('.aviso-toast', el => el.inert)) throw new Error('reapareceu inerte');
  });

  await caso('Print: Esc tambem fecha o aviso', async () => {
    await pagina.keyboard.press('Escape');
    await delay(100);
    if (await visivel()) throw new Error('Esc nao fechou');
  });

  await caso('cofre: aviso de erro (que nao some sozinho) ganha X e sai', async () => {
    await pagina.goto(BASE + '/cofre.html', { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('#email', { visible: true });
    await pagina.type('#email', 'ninguem@auditeste.com');
    await pagina.type('#senha', 'senha-errada-longa');
    await pagina.click('#btnEntrar');
    await pagina.waitForSelector('.aviso.ruim .aviso-fechar', { timeout: 10000 });
    // O login ainda pode redesenhar o aviso logo depois; espera assentar.
    await delay(800);
    await pagina.waitForSelector('.aviso.ruim .aviso-fechar', { timeout: 5000 });
    await pagina.click('.aviso.ruim .aviso-fechar');
    if (await pagina.$('.aviso.ruim')) throw new Error('clicou no X e o aviso ficou');
  });

  await caso('cofre: aviso montado direto com innerHTML tambem ganha X', async () => {
    await pagina.$eval('#avisoEntrada', el => { el.innerHTML = '<div class="aviso bom">Convite</div>'; });
    await pagina.waitForSelector('#avisoEntrada .aviso .aviso-fechar', { timeout: 3000 });
    const quantos = await pagina.$$eval('#avisoEntrada .aviso-fechar', els => els.length);
    if (quantos !== 1) throw new Error('esperava 1 X, veio ' + quantos);
  });

  await caso('nenhum erro de script nas duas paginas', async () => {
    if (erros.length) throw new Error(erros.join(' | '));
  });

  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (8 casos)\n');
})().catch(e => { falhas++; console.error('FALHOU:', e.message); })
  .finally(async () => {
    if (navegador) await navegador.close().catch(() => {});
    if (proc) proc.kill();
    process.exit(falhas ? 1 : 0);
  });
