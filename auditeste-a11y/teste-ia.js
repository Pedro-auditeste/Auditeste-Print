/* Teste autônomo: abre a URL, percorre a página, grava vídeo e printa antes/depois. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { caminhoChrome } = require('./a11y.js');

const MAX_CLIQUES = Number(process.env.TESTE_IA_CLIQUES || 12);
const MAX_VIDEO = 16 * 1024 * 1024;
const MAX_QUADROS = 70;
const PERIGOSOS = /sair|logout|log off|excluir|deletar|apagar|comprar agora|finalizar compra|pagar|checkout|remover|cancelar conta|unsubscribe|delete account/i;

const ROTEIRO = [
  { chave: 'home', nome: 'Home', texto: /^(home|inicio|pagina inicial|principal)$/i, href: /\/(home|inicio|index)\/?$/i },
  { chave: 'quem-somos', nome: 'Quem somos', texto: /quem\s*somos|sobre(\s+n[oa]s)?$|institucional|a\s+empresa|nossa\s+historia|about/i, href: /quem-?somos|sobre|about|institucional|empresa/i },
  { chave: 'funcionalidades', nome: 'Funcionalidades', texto: /funcionalidades|recursos|servicos|solucoes|produtos|o\s+que\s+fazemos|vantagens|como\s+funciona|features/i, href: /funcional|servic|soluc|produt|feature|recurso/i },
  { chave: 'entrar', nome: 'Entrar', texto: /^(entrar|login|acessar|sign\s*in|cadastre-?se|criar\s+conta|registre-?se)$/i, href: /\/(login|entrar|signin|cadastro|register|conta)\b/i },
  { chave: 'contato', nome: 'Contato', texto: /contato|fale\s*conosco|atendimento|suporte/i, href: /contato|contact|fale|suporte/i }
];

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function casarRoteiro(texto, href) {
  const t = normalizar(texto);
  const h = String(href || '').toLowerCase();
  for (const r of ROTEIRO) {
    if ((t && r.texto.test(t)) || (h && r.href.test(h))) return r;
  }
  return null;
}

function escolherDaRota(lista, rota, usados, base) {
  const pontos = lista
    .filter((c) => c && c.seletor && !usados.has(c.seletor) && !(c.href && usados.has(c.href)))
    .filter((c) => !c.href || mesmaOrigem(c.href, base) || c.href.startsWith('/') || c.href.startsWith('#'))
    .map((c) => {
      const t = normalizar(c.texto);
      const h = String(c.href || '').toLowerCase();
      let s = 0;
      if (t && rota.texto.test(t)) s += 80;
      if (h && rota.href.test(h)) s += 50;
      if (c.noNav) s += 20;
      if (c.temId) s += 10;
      return { c, s };
    })
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s);
  return pontos[0] ? pontos[0].c : null;
}

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

async function printTela(pagina, qualidade) {
  const buf = await pagina.screenshot({ type: 'jpeg', quality: qualidade || 68, fullPage: false });
  return jpegDataUrl(buf);
}

function mesmaOrigem(href, base) {
  if (!href || href.startsWith('#') || /^javascript:/i.test(href) || /^(mailto|tel):/i.test(href)) return false;
  try {
    const u = new URL(href, base);
    const b = new URL(base);
    return u.host === b.host && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch (_) {
    return false;
  }
}

async function listarCandidatos(pagina) {
  return pagina.evaluate(() => {
    const perigosos = /sair|logout|log off|excluir|deletar|apagar|comprar agora|finalizar compra|pagar|checkout|remover|cancelar conta|unsubscribe|delete account/i;
    function visivel(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (r.bottom < -40 || r.top > innerHeight * 1.4 || r.right < 0 || r.left > innerWidth) return false;
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
    const sel = 'a[href], button, [role="button"], [role="menuitem"], input[type="submit"], input[type="button"], summary, nav a, header a, footer a';
    const vistos = new Set();
    return [...document.querySelectorAll(sel)].filter(visivel).map((el) => {
      const texto = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const href = el.getAttribute('href') || '';
      const seletor = seletorDe(el);
      if (!seletor || vistos.has(seletor)) return null;
      vistos.add(seletor);
      const noNav = !!(el.closest('nav, header, [role="navigation"], [role="menubar"]'));
      return {
        seletor,
        id: el.id || '',
        testid: el.getAttribute('data-testid') || '',
        name: el.getAttribute('name') || '',
        tag: el.tagName.toLowerCase(),
        texto: texto.slice(0, 80),
        href,
        html: (el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        temId: !!el.id,
        noNav,
        perigoso: perigosos.test(texto + ' ' + href)
      };
    }).filter((c) => c && !c.perigoso && !/^javascript:/i.test(c.href) && !/\.(pdf|zip|exe)(\?|$)/i.test(c.href));
  });
}

function pontuar(c) {
  let s = 0;
  if (c.temId) s += 40;
  if (c.testid) s += 24;
  if (c.noNav) s += 28;
  if (c.name) s += 10;
  if (/entrar|login|menu|buscar|pesquisar|saiba|ver mais|produtos|cadastro|aceitar|aceito|concordo|home|início|inicio|sobre|contato|serviços|servicos/i.test(c.texto)) s += 26;
  if (c.tag === 'button' || c.tag === 'a') s += 4;
  return s;
}

async function clicarSeletor(pagina, seletor) {
  const loc = (seletor.startsWith('/') || seletor.startsWith('('))
    ? pagina.locator('xpath=' + seletor)
    : pagina.locator(seletor);
  await loc.first().scrollIntoViewIfNeeded().catch(() => {});
  await new Promise((r) => setTimeout(r, 350));
  try {
    await loc.first().click({ timeout: 7000 });
  } catch (_) {
    await loc.first().click({ timeout: 5000, force: true });
  }
}

async function esperarAssentar(pagina) {
  await pagina.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await pagina.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1400));
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
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Auditeste-Teste/1.0',
    locale: 'pt-BR'
  };
  if (comVideo) opts.recordVideo = { dir: pasta, size: { width: 1366, height: 768 } };
  return opts;
}

async function voltarBase(pagina, base) {
  if (pagina.url() === base) return;
  await pagina.goBack({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  if (pagina.url() !== base) await pagina.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await esperarAssentar(pagina);
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
  let gravandoQuadros = true;
  const timerQuadros = setInterval(() => {
    if (!gravandoQuadros || !pagina || quadros.length >= MAX_QUADROS) return;
    printTela(pagina, 42).then((u) => {
      if (gravandoQuadros && quadros.length < MAX_QUADROS) quadros.push(u);
    }).catch(() => {});
  }, 500);

  try {
    await pagina.goto(url, { waitUntil: 'load', timeout: 45000 });
    const printChegando = await printTela(pagina);
    await esperarAssentar(pagina);
    const base = pagina.url();
    const tituloHome = (await pagina.title().catch(() => '')) || parsed.hostname;
    const printHome = await printTela(pagina);
    passos.push(passoBase({
      titulo: 'Acessou ' + parsed.hostname,
      obs: 'Antes: abrindo o site. Depois: "' + tituloHome + '" em ' + base,
      acao: 'Acessar',
      elemento: url,
      html: '',
      imagens: [
        { dataUrl: printChegando, legenda: '1 — tela do clique' },
        { dataUrl: printHome, legenda: '2 — tela que abriu' }
      ]
    }));
    await new Promise((r) => setTimeout(r, 800));

    const usados = new Set();
    let cliques = 0;

    async function executarClique(cand) {
      if (!cand || cliques >= MAX_CLIQUES) return false;
      if (usados.has(cand.seletor) || (cand.href && usados.has(cand.href))) return false;
      usados.add(cand.seletor);
      if (cand.href) usados.add(cand.href);
      const urlAntes = pagina.url();
      try {
        const loc = (cand.seletor.startsWith('/') || cand.seletor.startsWith('('))
          ? pagina.locator('xpath=' + cand.seletor)
          : pagina.locator(cand.seletor);
        await loc.first().scrollIntoViewIfNeeded().catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      } catch (_) { /* segue o print mesmo assim */ }
      const antes = await printTela(pagina);
      try {
        await clicarSeletor(pagina, cand.seletor);
      } catch (e) {
        avisos.push('não clicou em ' + cand.seletor + ': ' + e.message);
        return false;
      }
      await esperarAssentar(pagina);
      const depois = await printTela(pagina);
      const heading = await pagina.evaluate(() => {
        const h = document.querySelector('h1, h2, [role="heading"]');
        return (h && (h.innerText || '').trim().slice(0, 80)) || document.title || '';
      }).catch(() => '');
      const rotulo = cand.texto || cand.id || cand.seletor;
      passos.push(passoBase({
        titulo: 'Clicou em "' + rotulo + '"',
        obs: 'Antes: ' + rotulo + '. Depois: ' + (heading || pagina.url()) + (cand.html ? '. HTML: ' + cand.html : ''),
        acao: 'Clicar',
        elemento: cand.seletor,
        html: cand.html,
        imagens: [
          { dataUrl: antes || depois, legenda: '1 — tela do clique' },
          { dataUrl: depois, legenda: '2 — tela que abriu' }
        ]
      }));
      cliques++;
      await new Promise((r) => setTimeout(r, 1100));
      const soAncora = cand.href && (cand.href.startsWith('#') || (() => {
        try {
          const u = new URL(cand.href, urlAntes);
          const a = new URL(urlAntes);
          return u.hash && u.pathname === a.pathname && u.host === a.host;
        } catch (_) { return false; }
      })());
      if (soAncora) {
        await pagina.evaluate(() => window.scrollTo(0, 0));
        await new Promise((r) => setTimeout(r, 400));
      } else if (pagina.url() !== urlAntes && pagina.url() !== base) {
        await voltarBase(pagina, base);
      }
      return true;
    }

    async function abrirMenuSeHouver() {
      const clicou = await pagina.evaluate(() => {
        const b = [...document.querySelectorAll('button, [role="button"], summary')].find((el) => {
          const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          return /menu|abrir navega|hamburguer|☰|≡/.test(t);
        });
        if (!b) return false;
        b.click();
        return true;
      }).catch(() => false);
      if (clicou) await new Promise((r) => setTimeout(r, 700));
    }

    /* 1) cookies */
    const cookie = (await listarCandidatos(pagina)).find((c) => /aceitar|aceito|concordo|entendi|ok,?\s*continuar/i.test(c.texto));
    if (cookie) await executarClique(cookie);

    /* 2) roteiro de funcionalidades: Home, Quem somos, Funcionalidades, Entrar, Contato */
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 400));
    await abrirMenuSeHouver();
    for (const rota of ROTEIRO) {
      if (cliques >= MAX_CLIQUES) break;
      if (rota.chave === 'home' && /\/(home|inicio|index)?\/?$/i.test(new URL(pagina.url()).pathname) && new URL(pagina.url()).pathname.replace(/\/$/, '') === new URL(base).pathname.replace(/\/$/, '')) {
        continue;
      }
      const lista = await listarCandidatos(pagina);
      const cand = escolherDaRota(lista, rota, usados, base);
      if (cand) await executarClique(cand);
    }

    /* 3) demais itens do menu ainda não visitados */
    await abrirMenuSeHouver();
    const restoNav = (await listarCandidatos(pagina))
      .filter((c) => c.noNav || /menu|nav/i.test(c.html))
      .filter((c) => !c.href || mesmaOrigem(c.href, base) || c.href.startsWith('/') || c.href.startsWith('#'))
      .sort((a, b) => pontuar(b) - pontuar(a));
    for (const cand of restoNav) {
      if (cliques >= MAX_CLIQUES) break;
      await executarClique(cand);
    }

    if (cliques < 2) avisos.push('poucos elementos clicáveis nesta página');
    if (!comVideo) avisos.push('vídeo montado por quadros');
  } finally {
    gravandoQuadros = false;
    clearInterval(timerQuadros);
    await new Promise((r) => setTimeout(r, 600));
    const handleVideo = comVideo && pagina && typeof pagina.video === 'function' ? pagina.video() : null;
    await contexto?.close().catch(() => {});
    await navegador.close().catch(() => {});
    try {
      if (handleVideo) {
        const arq = await handleVideo.path();
        if (arq && fs.existsSync(arq)) {
          const buf = fs.readFileSync(arq);
          if (buf.length >= 80 * 1024 && buf.length <= MAX_VIDEO) {
            videoData = 'data:video/webm;base64,' + buf.toString('base64');
          } else if (buf.length > MAX_VIDEO) {
            avisos.push('vídeo grande demais; usando os quadros da sessão');
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
    quadros: videoData ? quadros.slice(0, 24) : quadros,
    avisos
  };
}

module.exports = { testarUrl, montarSeletor, ePerigoso, PERIGOSOS, ROTEIRO, casarRoteiro, escolherDaRota, normalizar };
