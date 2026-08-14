/* Demo visivel no Chrome: Print + Gerar cenarios via NVIDIA.
 *
 *   node teste-chrome-nvidia.js
 *
 * Sobe/usa a ponte em http://127.0.0.1:8900 e deixa o Chrome aberto.
 */
const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const TOKEN = process.env.PONTE_TOKEN || '';
const SAIDA = path.join(__dirname, 'saida');
const delay = ms => new Promise(r => setTimeout(r, ms));

function ping() {
  return new Promise(ok => {
    const req = http.get(BASE + '/ping', res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { ok(JSON.parse(d)); } catch (e) { ok(null); }
      });
    });
    req.on('error', () => ok(null));
    req.setTimeout(4000, () => { req.destroy(); ok(null); });
  });
}

async function esperar(pagina, fn, ms, passo = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await delay(passo);
  }
  return false;
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });

  const info = await ping();
  if (!info || !info.ok) {
    console.error('Ponte nao esta no ar em ' + BASE);
    console.error('Rode em outro terminal: npm run servidor');
    process.exit(1);
  }
  if (!info.cenarios) {
    console.error('Agente NVIDIA desligado. Defina AGENTE_API_KEY no .env e reinicie a ponte.');
    process.exit(1);
  }
  console.log('Ponte ok · modelo ' + (info.modelo || '') + ' · base ' + (info.base || ''));
  console.log('Abrindo Chrome visivel em ' + BASE + ' ...');

  const chromeLocal = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find(p => p && fs.existsSync(p));

  const navegador = await puppeteer.launch({
    headless: false,
    channel: chromeLocal ? undefined : 'chrome',
    executablePath: chromeLocal,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
  });
  const pagina = await navegador.newPage();
  pagina.setDefaultTimeout(30000);

  try {
    // Sem isto o Print hospedado nao manda o token e a ponte devolve 401.
    if (TOKEN) await pagina.evaluateOnNewDocument(t => localStorage.setItem('ponte_token', t), TOKEN);
    await pagina.goto(BASE + '/', { waitUntil: 'load' });
    await delay(800);

    const splash = await pagina.$('#entrarSite');
    if (splash) {
      await splash.click();
      await delay(1000);
    }

    await pagina.waitForSelector('[data-acao="novoProjeto"]', { visible: true });
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.click('#campoNome', { clickCount: 3 });
    await pagina.type('#campoNome', 'Demo NVIDIA Cenários', { delay: 40 });
    await pagina.click('#btnConfirmarModal');
    await delay(1200);

    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await delay(700);
    await pagina.click('[data-acao="novaGravacao"]');
    await delay(800);

    await pagina.evaluate(() => {
      const set = (campo, valor) => {
        const el = document.querySelector('#ficha [data-campo="' + campo + '"]');
        if (!el) return;
        if (el.tagName === 'SELECT') el.value = valor;
        else el.textContent = valor;
      };
      set('registro', 'EV-NVIDIA-001');
      set('executor', 'Demo Chrome');
      set('modulo', 'Login');
      set('ambiente', 'Homologação');
      set('tipo', 'Funcional');
      set('resultado', 'Aprovado');
      set('observacoes', 'Fluxo de login para gerar cenário via NVIDIA no padrão automacao-web-qa.');
    });

    const criarPasso = async (titulo, obs) => {
      await pagina.click('[data-acao="manual"]');
      await delay(300);
      await pagina.keyboard.press('Escape');
      await delay(200);
      await pagina.evaluate((t, o) => {
        const passos = document.querySelectorAll('#lista .passo');
        const p = passos[passos.length - 1];
        if (!p) return;
        p.querySelector('.titulo').textContent = t;
        p.querySelector('.obs').textContent = o;
      }, titulo, obs);
    };

    await criarPasso('Acessar tela de login', 'Abriu https://app.exemplo.com/login com formulário de e-mail e senha.');
    await criarPasso('Preencher e-mail', 'Campo e-mail preenchido com qa@teste.com.');
    await criarPasso('Preencher senha', 'Campo senha preenchido com 123456.');
    await criarPasso('Clicar em Entrar', 'Dashboard exibiu o nome Maria Santos.');

    await pagina.click('[data-acao="salvar"]');
    const salvou = await esperar(pagina, () => pagina.$('#listaRegistros [data-abrir]'), 8000);
    if (!salvou) throw new Error('Não salvou o registro');

    await pagina.click('#listaRegistros [data-abrir]');
    await pagina.waitForSelector('[data-acao="gerarCenariosIA"]', { visible: true });
    await delay(800);

    console.log('Clicando em Gerar cenários (NVIDIA)...');
    await pagina.click('[data-acao="gerarCenariosIA"]');

    const ok = await esperar(pagina, async () => {
      const txt = await pagina.$eval('#caixaCenarios', el => el.hidden ? '' : el.innerText).catch(() => '');
      return /Funcionalidade:|# language: pt|Passo:\s*1/.test(txt);
    }, 120000, 800);

    const shot = path.join(SAIDA, 'demo-nvidia-cenarios.png');
    await pagina.screenshot({ path: shot, fullPage: true });
    console.log('Screenshot: ' + shot);

    const gherkin = await pagina.$eval('#textoGherkin', el => el.textContent).catch(() => '');
    const mapa = await pagina.$eval('#textoMapeamento', el => el.textContent).catch(() => '');
    const estado = await pagina.$eval('#estadoCenarios', el => el.textContent).catch(() => '');

    if (!ok) {
      console.error('Não gerou a tempo. Estado: ' + estado);
    } else {
      console.log('\nEstado: ' + estado);
      console.log('\n--- GHERKIN ---\n' + (gherkin || '(vazio)') + '\n');
      console.log('--- MAPEAMENTO ---\n' + (mapa || '(vazio)') + '\n');
      fs.writeFileSync(path.join(SAIDA, 'demo-nvidia-gherkin.txt'), gherkin || '', 'utf8');
      fs.writeFileSync(path.join(SAIDA, 'demo-nvidia-mapeamento.txt'), mapa || '', 'utf8');
    }

    console.log('Chrome fica aberto 90s para você ver. Feche a janela quando quiser.');
    await delay(90000);
  } catch (err) {
    console.error('FALHOU: ' + err.message);
    try {
      await pagina.screenshot({ path: path.join(SAIDA, 'demo-nvidia-falha.png'), fullPage: true });
    } catch (e) { /* ok */ }
    console.log('Chrome fica aberto 30s...');
    await delay(30000);
    process.exitCode = 1;
  } finally {
    await navegador.close().catch(() => {});
  }
})();
