/* Demo visível: antes/depois + descrição NVIDIA por passo.
 *
 *   node teste-chrome-antes-depois.js
 *
 * Requer a ponte em http://127.0.0.1:8900. Deixa o Chrome aberto.
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
      res.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ok(null); } });
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
    process.exit(1);
  }
  console.log('Ponte ok · modelo ' + (info.modelo || '') + ' · cenarios=' + !!info.cenarios);

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
  pagina.setDefaultTimeout(45000);

  try {
    // Sem isto o Print hospedado nao manda o token e a ponte devolve 401.
    if (TOKEN) await pagina.evaluateOnNewDocument(t => localStorage.setItem('ponte_token', t), TOKEN);
    await pagina.goto(BASE + '/?v=4', { waitUntil: 'load' });
    await delay(700);
    const splash = await pagina.$('#entrarSite');
    if (splash) { await splash.click(); await delay(800); }

    await pagina.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1280;
      c.height = 720;
      c.style.cssText = 'position:fixed;right:8px;bottom:8px;width:240px;height:135px;z-index:9;border:2px solid #76c043;background:#fff;pointer-events:none';
      document.body.appendChild(c);
      const ctx = c.getContext('2d');
      let titulo = 'Busca: ponto frio';
      let sub = 'Resultado: www.pontofrio.com.br';
      let fundo = '#e8f0fe';
      function desenhar() {
        ctx.fillStyle = fundo;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#0d3446';
        ctx.fillRect(0, 0, c.width, 88);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px Segoe UI, sans-serif';
        ctx.fillText('google.com', 40, 55);
        ctx.fillStyle = '#202124';
        ctx.font = 'bold 52px Segoe UI, sans-serif';
        ctx.fillText(titulo, 80, 260);
        ctx.font = '32px Segoe UI, sans-serif';
        ctx.fillStyle = '#3c4043';
        ctx.fillText(sub || '', 80, 330);
        ctx.fillStyle = '#76c043';
        ctx.fillRect(80, 400, 280, 64);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px Segoe UI, sans-serif';
        ctx.fillText('Continuar', 140, 442);
        requestAnimationFrame(desenhar);
      }
      desenhar();
      window.__cenaPrint = (t, s, f) => { titulo = t; sub = s; fundo = f || fundo; };
      const stream = c.captureStream(24);
      navigator.mediaDevices.getDisplayMedia = async () => stream;
    });

    const build = await pagina.$eval('#printBuild', el => el.textContent).catch(() => '');
    console.log('Build na tela: ' + (build || '(nao achou — Print antigo!)'));

    await pagina.waitForSelector('[data-acao="novoProjeto"]', { visible: true });
    const jaTem = await pagina.$('#gradeProjetos .cartao[data-projeto]');
    if (!jaTem) {
      await pagina.click('[data-acao="novoProjeto"]');
      await pagina.waitForSelector('#campoNome', { visible: true });
      await pagina.click('#campoNome', { clickCount: 3 });
      await pagina.type('#campoNome', 'Teste local IA', { delay: 20 });
      await pagina.click('#btnConfirmarModal');
      const criou = await esperar(pagina, async () => !!(await pagina.$('#gradeProjetos .cartao[data-projeto]')), 10000);
      if (!criou) throw new Error('Não criou o projeto');
    }
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await delay(800);
    await pagina.waitForSelector('[data-acao="novaGravacao"]', { visible: true });
    await pagina.click('[data-acao="novaGravacao"]');
    await delay(700);

    await pagina.click('.aba-captura[data-modo="alteracao"]');
    await pagina.evaluate(() => {
      const v = document.getElementById('gravarVideo');
      if (v) v.checked = false;
      const s = document.getElementById('sensibilidade');
      if (s) s.value = '0.8';
    });

    console.log('Iniciando gravação...');
    await pagina.click('#btnIniciar');
    const gravando = await esperar(pagina, async () => {
      const est = await pagina.$eval('#rotEstado', el => el.textContent).catch(() => '');
      return est === 'Gravando';
    }, 15000);
    if (!gravando) throw new Error('Não entrou em Gravando');

    await esperar(pagina, async () => (await pagina.$$('#lista .passo')).length >= 1, 8000);
    console.log('Tela inicial capturada. Mudando cena (Google → Ponto Frio)...');
    await delay(2000);
    await pagina.evaluate(() => {
      if (typeof window.__cenaPrint !== 'function') throw new Error('__cenaPrint ausente');
      window.__cenaPrint('FLASH', 'mudanca', '#ff0000');
    });
    await delay(400);
    await pagina.evaluate(() => {
      window.__cenaPrint(
        'Ponto Frio — Produtos patrocinados',
        'Console PlayStation 5 Slim 1TB',
        '#fff3e0'
      );
    });

    let doisPassos = await esperar(pagina, async () => (await pagina.$$('#lista .passo')).length >= 2, 8000);
    if (!doisPassos) {
      console.log('Auto não disparou. Clicando Capturar agora...');
      await pagina.click('#btnCapturar');
      doisPassos = await esperar(pagina, async () => (await pagina.$$('#lista .passo')).length >= 2, 8000);
    }
    if (!doisPassos) throw new Error('Não capturou a segunda tela');

    await esperar(pagina, async () => {
      const txt = await pagina.$$eval('#lista .passo .obs', els => els.map(e => e.textContent).join('\n'));
      const n = await pagina.$$eval('#lista .passo', els => els.length);
      return n >= 2 && /busc|clic|pesquis|ponto|playstation|abriu|ia descreveu|ia não/i.test(txt)
        && !/Descrevendo com IA: o que foi clicado/.test(txt);
    }, 28000);
    await delay(1500);
    const resumo = await pagina.evaluate(() => {
      return [...document.querySelectorAll('#lista .passo')].map((p, i) => ({
        n: i + 1,
        titulo: (p.querySelector('.titulo') || {}).textContent || '',
        obs: (p.querySelector('.obs') || {}).textContent || '',
        imagens: p.querySelectorAll('img').length,
        legendas: [...p.querySelectorAll('.legenda')].map(l => l.textContent.trim())
      }));
    });
    console.log(JSON.stringify(resumo, null, 2));
    await pagina.screenshot({ path: path.join(SAIDA, 'demo-antes-depois.png'), fullPage: true });

    const segundo = resumo[1] || {};
    const okImagens = (segundo.imagens || 0) >= 2;
    const okTexto = /descrevendo|ia não|clic|pesquis|ponto|playstation|abriu|ação/i.test(
      (segundo.titulo || '') + ' ' + (segundo.obs || '')
    );
    console.log('Passo 2 imagens: ' + (segundo.imagens || 0) + (okImagens ? ' OK' : ' FALHOU (queria 2)'));
    console.log('Passo 2 texto: ' + (okTexto ? 'OK' : 'FRACO') + ' → ' + (segundo.titulo || '(vazio)'));

    await pagina.click('#btnParar');
    console.log('Chrome fica aberto 90s para você conferir.');
    await delay(90000);
  } catch (err) {
    console.error('FALHOU: ' + err.message);
    try { await pagina.screenshot({ path: path.join(SAIDA, 'demo-antes-depois-falha.png'), fullPage: true }); } catch (e) {}
    console.log('Chrome fica aberto 45s...');
    await delay(45000);
    process.exitCode = 1;
  } finally {
    await navegador.close().catch(() => {});
  }
})();
