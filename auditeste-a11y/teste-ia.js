/* Teste autônomo: a IA abre a URL, clica, grava vídeo e inspeciona ids HTML. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { caminhoChrome } = require('./a11y.js');

const MAX_CLIQUES = Number(process.env.TESTE_IA_CLIQUES || 4);
const MAX_VIDEO = 9 * 1024 * 1024;
const PERIGOSOS = /sair|logout|log off|excluir|deletar|apagar|comprar agora|finalizar compra|pagar|checkout|remover|cancelar conta|unsubscribe|delete account/i;

function ePerigoso(texto) {
  return PERIGOSOS.test(String(texto || ''));
}

function escapeCss(s) {
  return String(s).replace(/([^\w-])/g, '\\$1');
}

function montarSeletor({ id, testid, qa, name, tag }) {
  if (id) return '#' + escapeCss(id);
  if (testid) return `[data-testid="${String(testid).replace(/"/g, '\\"')}"]`;
  if (qa) return `[data-qa="${String(qa).replace(/"/g, '\\"')}"]`;
  if (name) return `${String(tag || 'input').toLowerCase()}[name="${String(name).replace(/"/g, '\\"')}"]`;
  return '';
}

function candidatosChrome() {
  const lista = [];
  const viaA11y = caminhoChrome();
  if (viaA11y) lista.push(viaA11y);
  try {
    const p = require('puppeteer').executablePath();
    if (p && fs.existsSync(p)) lista.push(p);
  } catch (_) { /* ok */ }
  [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].forEach((p) => { if (p && fs.existsSync(p)) lista.push(p); });
  return [...new Set(lista)];
}

async function lancarBrowser() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  const tentativas = candidatosChrome().map((executablePath) => ({ executablePath, args }));
  tentativas.push({ channel: 'chrome', args });
  tentativas.push({ channel: 'msedge', args });
  tentativas.push({ args });
  let ultimo;
  for (const opt of tentativas) {
    try {
      return await chromium.launch({ headless: true, ...opt });
    } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error('Chrome não encontrado. Rode: npx puppeteer browsers install chrome');
}

function jpegDataUrl(buf) {
  return 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
}

async function printTela(pagina) {
  const buf = await pagina.screenshot({ type: 'jpeg', quality: 52, fullPage: false });
  return jpegDataUrl(buf);
}

async function listarCandidatos(pagina) {
  return pagina.evaluate(() => {
    const perigosos = /sair|logout|log off|excluir|deletar|apagar|comprar agora|finalizar compra|pagar|checkout|remover|cancelar conta|unsubscribe|delete account/i;
    function visivel(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
      return true;
    }
    function seletorDe(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      const testid = el.getAttribute('data-testid');
      if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
      const qa = el.getAttribute('data-qa') || el.getAttribute('data-test');
      if (qa) return `[data-qa="${CSS.escape(qa)}"]`;
      const name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      const partes = [];
      let n = el;
      while (n && n.nodeType === 1 && n !== document.body) {
        if (n.id) {
          partes.unshift('//*[@id=' + JSON.stringify(n.id) + ']');
          return partes.join('');
        }
        let i = 1;
        let s = n.previousElementSibling;
        while (s) {
          if (s.tagName === n.tagName) i++;
          s = s.previousElementSibling;
        }
        partes.unshift('/' + n.tagName.toLowerCase() + '[' + i + ']');
        n = n.parentElement;
      }
      return partes.length ? '//' + partes.join('').replace(/^\//, '') : '';
    }
    const els = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"], summary')];
    return els.filter(visivel).map((el) => {
      const texto = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const href = el.getAttribute('href') || '';
      return {
        seletor: seletorDe(el),
        id: el.id || '',
        testid: el.getAttribute('data-testid') || '',
        name: el.getAttribute('name') || '',
        tag: el.tagName.toLowerCase(),
        texto: texto.slice(0, 80),
        href,
        html: (el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        temId: !!el.id,
        perigoso: perigosos.test(texto + ' ' + href)
      };
    }).filter((c) => c.seletor && !c.perigoso && !/^javascript:/i.test(c.href) && !/\.(pdf|zip|exe)(\?|$)/i.test(c.href));
  });
}

function pontuar(c) {
  let s = 0;
  if (c.temId) s += 50;
  if (c.testid) s += 30;
  if (c.name) s += 12;
  if (/entrar|login|menu|buscar|pesquisar|saiba|ver mais|produtos|cadastro|aceitar|aceito|concordo/i.test(c.texto)) s += 22;
  if (c.tag === 'button' || c.tag === 'a') s += 4;
  return s;
}

async function clicarSeletor(pagina, seletor) {
  const loc = (seletor.startsWith('/') || seletor.startsWith('('))
    ? pagina.locator('xpath=' + seletor)
    : pagina.locator(seletor);
  try {
    await loc.first().click({ timeout: 6000 });
  } catch (_) {
    await loc.first().click({ timeout: 4000, force: true });
  }
}

async function esperarAssentar(pagina) {
  await pagina.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
}

function passoBase({ titulo, obs, acao, elemento, valor, html, imagens }) {
  return {
    titulo,
    obs,
    acao,
    elemento: elemento || '',
    valor: valor || '',
    html: html || '',
    imagens: imagens || []
  };
}

function optsContexto(pasta, comVideo) {
  const opts = {
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Auditeste-TesteIA/1.0',
    locale: 'pt-BR'
  };
  if (comVideo) opts.recordVideo = { dir: pasta, size: { width: 1280, height: 720 } };
  return opts;
}

async function testarUrl(alvo) {
  const url = String(alvo || '').trim();
  if (!url) throw new Error('url ausente');
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error('url inválida: ' + url); }

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'audi-teste-ia-'));
  const navegador = await lancarBrowser();
  let contexto;
  let pagina;
  let comVideo = true;
  try {
    contexto = await navegador.newContext(optsContexto(pasta, true));
    pagina = await contexto.newPage();
  } catch (e) {
    if (!/ffmpeg/i.test((e && e.message) || '')) {
      await navegador.close().catch(() => {});
      try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (_) { /* ok */ }
      throw e;
    }
    await contexto?.close().catch(() => {});
    comVideo = false;
    contexto = await navegador.newContext(optsContexto(pasta, false));
    pagina = await contexto.newPage();
  }

  const avisos = [];
  const passos = [];
  const quadros = [];
  let videoData = null;
  const gravarQuadro = async () => {
    if (comVideo || quadros.length >= 36) return;
    try { quadros.push(await printTela(pagina)); } catch (_) { /* ok */ }
  };

  try {
    await pagina.goto(url, { waitUntil: 'load', timeout: 45000 });
    await esperarAssentar(pagina);
    await gravarQuadro();
    const tituloHome = (await pagina.title().catch(() => '')) || parsed.hostname;
    const printHome = await printTela(pagina);
    passos.push(passoBase({
      titulo: 'Acessou ' + parsed.hostname,
      obs: 'Abriu "' + tituloHome + '" em ' + pagina.url(),
      acao: 'Acessar',
      elemento: url,
      html: '',
      imagens: [{ dataUrl: printHome, legenda: '1 — tela inicial' }]
    }));

    const usados = new Set();
    for (let i = 0; i < MAX_CLIQUES; i++) {
      const lista = (await listarCandidatos(pagina)).sort((a, b) => pontuar(b) - pontuar(a));
      const cand = lista.find((c) => c.seletor && !usados.has(c.seletor) && !usados.has(c.href || ''));
      if (!cand) break;
      usados.add(cand.seletor);
      if (cand.href) usados.add(cand.href);

      const antes = await printTela(pagina);
      await gravarQuadro();
      const rotulo = cand.texto || cand.id || cand.seletor;
      try {
        await clicarSeletor(pagina, cand.seletor);
      } catch (e) {
        avisos.push('não clicou em ' + cand.seletor + ': ' + e.message);
        continue;
      }
      await esperarAssentar(pagina);
      await gravarQuadro();
      const depois = await printTela(pagina);
      const heading = await pagina.evaluate(() => {
        const h = document.querySelector('h1, h2, [role="heading"]');
        return (h && (h.innerText || '').trim().slice(0, 80)) || document.title || '';
      }).catch(() => '');
      passos.push(passoBase({
        titulo: 'Clicou em "' + rotulo + '"',
        obs: 'Antes: ' + rotulo + '. Depois: ' + (heading || pagina.url()) + '. HTML: ' + (cand.html || ''),
        acao: 'Clicar',
        elemento: cand.seletor,
        html: cand.html,
        imagens: [
          { dataUrl: antes, legenda: '1 — tela do clique' },
          { dataUrl: depois, legenda: '2 — tela que abriu' }
        ]
      }));
    }

    if (passos.length < 2) avisos.push('poucos elementos clicáveis com id/seletor nesta página');
    if (!comVideo) avisos.push('vídeo montado por quadros (ffmpeg ausente na ponte)');
  } finally {
    const handleVideo = comVideo && pagina && typeof pagina.video === 'function' ? pagina.video() : null;
    await contexto?.close().catch(() => {});
    await navegador.close().catch(() => {});
    try {
      if (handleVideo) {
        const arq = await handleVideo.path();
        if (arq && fs.existsSync(arq)) {
          const buf = fs.readFileSync(arq);
          if (buf.length && buf.length <= MAX_VIDEO) {
            videoData = 'data:video/webm;base64,' + buf.toString('base64');
          } else if (buf.length > MAX_VIDEO) {
            avisos.push('vídeo grande demais (' + Math.round(buf.length / 1048576) + ' MB); prints foram mantidos');
          }
        }
      }
    } catch (e) {
      avisos.push('vídeo: ' + e.message);
    }
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (_) { /* ok */ }
  }

  return {
    url: parsed.href,
    titulo: parsed.hostname,
    passos,
    video: videoData,
    quadros: videoData ? [] : quadros,
    avisos
  };
}

module.exports = { testarUrl, montarSeletor, ePerigoso, PERIGOSOS };
