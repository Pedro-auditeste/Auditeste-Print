/* Abre o Print no Chrome e confere: campo Link do site + texto visível sem "IA". */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SAIDA = path.join(__dirname, 'saida');
const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const TOKEN = process.env.PONTE_TOKEN || '';
const RAILWAY = 'https://audiprint.up.railway.app/';

function get(url) {
  return new Promise((ok) => {
    const lib = url.startsWith('https') ? require('https') : http;
    const req = lib.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => ok({ status: res.statusCode, html: d }));
    });
    req.on('error', (e) => ok({ status: 0, html: '', erro: e.message }));
    req.setTimeout(20000, () => { req.destroy(); ok({ status: 0, html: '', erro: 'timeout' }); });
  });
}

function chromePath() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  try {
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) candidatos.unshift(p);
  } catch (_) { /* ok */ }
  return candidatos.find((p) => p && fs.existsSync(p));
}

function acharIaVisivel(html) {
  const texto = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const hits = texto.match(/\bIA\b|NVIDIA|AGENTE_API_KEY/gi) || [];
  return [...new Set(hits)];
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const R = [];
  const ok = (caso, cond, extra) => {
    R.push({ caso, ok: !!cond, extra: String(extra || '').slice(0, 160) });
    console.log((cond ? '  OK   ' : '  FALHA') + '  ' + caso + (extra ? '  →  ' + String(extra).slice(0, 120) : ''));
  };

  console.log('--- HTML local / Railway ---');
  const local = await get(BASE + '/?t=' + Date.now());
  ok('Ponte local responde', local.status === 200, local.status || local.erro);
  ok('Local tem Captura v22', /Captura v22/.test(local.html), (local.html.match(/Captura v\d+/) || ['(sem)'])[0]);
  ok('Local tem id urlTesteIaProjeto', /id="urlTesteIaProjeto"/.test(local.html));
  ok('Local tem id urlTesteIa', /id="urlTesteIa"/.test(local.html));
  ok('Local tem rótulo Link do site', />Link do site</.test(local.html));
  ok('Local tem caixa na home', /id="caixaLinkHome"/.test(local.html));
  const iaLocal = acharIaVisivel(local.html);
  ok('Local sem IA/NVIDIA no HTML visível', iaLocal.length === 0, iaLocal.join(', ') || 'limpo');

  const rw = await get(RAILWAY + '?t=' + Date.now());
  ok('Railway responde', rw.status === 200, rw.status || rw.erro);
  ok('Railway tem Captura v22 ou v21', /Captura v2[12]/.test(rw.html), (rw.html.match(/Captura v\d+/) || ['(sem)'])[0]);
  ok('Railway tem Link do site', />Link do site</.test(rw.html));
  const iaRw = acharIaVisivel(rw.html);
  ok('Railway sem IA/NVIDIA no HTML visível', iaRw.length === 0, iaRw.join(', ') || 'limpo');

  console.log('\n--- Chrome na máquina ---');
  const chrome = chromePath();
  ok('Chrome encontrado', !!chrome, chrome || 'não achou');
  if (!chrome || local.status !== 200) {
    console.log('\nRESULTADO:', R.every((r) => r.ok) ? 'PASSOU' : 'FALHOU');
    process.exit(R.every((r) => r.ok) ? 0 : 1);
  }

  const nav = await puppeteer.launch({
    headless: true,
    executablePath: chrome,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const pagina = await nav.newPage();
  try {
    // Sem isto o Print hospedado nao manda o token e a ponte devolve 401.
    if (TOKEN) await pagina.evaluateOnNewDocument(t => localStorage.setItem('ponte_token', t), TOKEN);
    await pagina.goto(BASE + '/?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pagina.waitForSelector('#entrarSite', { timeout: 10000 });
    await pagina.click('#entrarSite');
    await new Promise((r) => setTimeout(r, 1400));

    const telaHome = await pagina.$eval('.tela.ativa', (el) => el.id).catch(() => '');
    ok('Entrou no app', telaHome === 'telaProjetos', telaHome);

    const visHome = await pagina.evaluate(() => {
      const el = document.querySelector('#caixaLinkHome, #urlTesteIaHome');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 80 && r.height > 20 && st.display !== 'none' && st.visibility !== 'hidden';
    });
    ok('Campo Link do site visível na tela inicial', visHome);
    await pagina.screenshot({ path: path.join(SAIDA, 'teste-link-home.png'), fullPage: false });
    console.log('  print: saida/teste-link-home.png');

    await pagina.click('[data-acao="novoProjeto"]');
    await new Promise((r) => setTimeout(r, 400));
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.click('#campoNome', { clickCount: 3 });
    await pagina.type('#campoNome', 'Teste Link Maquina');
    await pagina.click('#btnConfirmarModal');
    await new Promise((r) => setTimeout(r, 1200));
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await new Promise((r) => setTimeout(r, 900));

    const telaProj = await pagina.$eval('.tela.ativa', (el) => el.id).catch(() => '');
    ok('Abriu o projeto', telaProj === 'telaProjeto', telaProj);

    const caixa = await pagina.$('#caixaLinkProjeto');
    const visivel = caixa && await pagina.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 40 && r.height > 20 && st.display !== 'none' && st.visibility !== 'hidden';
    }, caixa);
    ok('Caixa Link do site visível no projeto', !!visivel, visivel ? 'visível' : 'escondida');

    const input = await pagina.$('#urlTesteIaProjeto');
    ok('Input urlTesteIaProjeto no projeto', !!input);

    await pagina.screenshot({ path: path.join(SAIDA, 'teste-link-projeto.png'), fullPage: false });
    console.log('  print: saida/teste-link-projeto.png');

    const textoTela = await pagina.evaluate(() => document.body.innerText);
    const iaTela = (textoTela.match(/\bIA\b|NVIDIA|AGENTE_API_KEY/gi) || []).filter((t) => t !== 'ARIA');
    ok('Tela do projeto sem a palavra IA', iaTela.length === 0, iaTela.join(', ') || 'limpo');

    await pagina.click('[data-acao="novaGravacao"]');
    await new Promise((r) => setTimeout(r, 800));
    const telaGrav = await pagina.$eval('.tela.ativa', (el) => el.id).catch(() => '');
    ok('Abriu nova gravação', telaGrav === 'telaGravador', telaGrav);
    const inputGrav = await pagina.$('#urlTesteIa');
    const visGrav = inputGrav && await pagina.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 20;
    }, inputGrav);
    ok('Campo link visível no gravador', !!visGrav);
    const build = await pagina.$eval('#printBuild', (el) => el.textContent).catch(() => '');
    ok('printBuild v22', /v22/.test(build), build);
    await pagina.screenshot({ path: path.join(SAIDA, 'teste-link-gravador.png'), fullPage: false });
    console.log('  print: saida/teste-link-gravador.png');

    const textoGrav = await pagina.evaluate(() => document.body.innerText);
    const iaGrav = (textoGrav.match(/\bIA\b|NVIDIA|AGENTE_API_KEY/gi) || []);
    ok('Gravador sem a palavra IA', iaGrav.length === 0, iaGrav.join(', ') || 'limpo');
  } finally {
    await nav.close().catch(() => {});
  }

  const falhou = R.some((r) => !r.ok);
  console.log('\nRESULTADO:', falhou ? 'FALHOU' : 'PASSOU');
  process.exit(falhou ? 1 : 0);
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
