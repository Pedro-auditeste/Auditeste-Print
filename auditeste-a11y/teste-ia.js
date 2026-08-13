/* Teste: abre a URL no Chrome da ponte, percorre Home/abas/menu, printa antes/depois. */
const fs = require('fs');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const MAX_CLIQUES = Number(process.env.TESTE_IA_CLIQUES || 8);
const MAX_QUADROS = 24;
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
    const p = puppeteer.executablePath();
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
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,768'];
  const exe = candidatosChrome()[0];
  const tentativas = [];
  if (exe) tentativas.push({ executablePath: exe, headless: true, args });
  tentativas.push({ headless: true, args });
  let ultimo;
  for (const opt of tentativas) {
    try { return await puppeteer.launch(opt); } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error('Chrome não encontrado. Rode: npx puppeteer browsers install chrome');
}

function jpegDataUrl(buf) {
  return 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64');
}

async function printTela(pagina, qualidade) {
  const buf = await pagina.screenshot({ type: 'jpeg', quality: qualidade || 60, fullPage: false, captureBeyondViewport: false });
  return jpegDataUrl(buf);
}

async function destacar(pagina, seletor) {
  await pagina.evaluate((sel) => {
    document.querySelectorAll('[data-audi-destaque]').forEach((el) => {
      el.style.outline = el.getAttribute('data-audi-outline') || '';
      el.removeAttribute('data-audi-destaque');
      el.removeAttribute('data-audi-outline');
    });
    let el = null;
    if (sel && (sel.startsWith('/') || sel.startsWith('('))) {
      el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } else {
      try { el = document.querySelector(sel); } catch (_) { /* ok */ }
    }
    if (!el) return;
    el.setAttribute('data-audi-destaque', '1');
    el.setAttribute('data-audi-outline', el.style.outline || '');
    el.style.outline = '4px solid #e23c3c';
    el.style.outlineOffset = '3px';
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, seletor).catch(() => {});
}

async function listarCandidatos(pagina) {
  return pagina.evaluate(() => {
    const perigosos = /sair|logout|log off|excluir|deletar|apagar|comprar agora|finalizar compra|pagar|checkout|remover|cancelar conta|unsubscribe|delete account/i;
    function visivel(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (r.bottom < -20 || r.top > innerHeight * 1.3 || r.right < 0 || r.left > innerWidth) return false;
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
    const sel = [
      '[role="tab"]', '[role="tablist"] a', '[role="tablist"] button',
      '[data-toggle="tab"]', '.nav-tabs a', '.nav-tabs button', '[aria-controls]',
      'a[href]', 'button', '[role="button"]', '[role="menuitem"]',
      'input[type="submit"]', 'input[type="button"]', 'summary',
      'nav a', 'header a', 'footer a'
    ].join(',');
    const vistos = new Set();
    return [...document.querySelectorAll(sel)].filter(visivel).map((el) => {
      const texto = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const href = el.getAttribute('href') || '';
      const seletor = seletorDe(el);
      if (!seletor || vistos.has(seletor)) return null;
      vistos.add(seletor);
      const eAba = el.getAttribute('role') === 'tab'
        || !!el.closest('[role="tablist"], .nav-tabs, .tabs, [data-tabs]')
        || /tab/i.test(el.className || '')
        || el.hasAttribute('aria-controls');
      return {
        seletor,
        id: el.id || '',
        texto: texto.slice(0, 80),
        href,
        html: (el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        temId: !!el.id,
        noNav: !!(el.closest('nav, header, [role="navigation"], [role="menubar"]')),
        eAba,
        perigoso: perigosos.test(texto + ' ' + href)
      };
    }).filter((c) => c && !c.perigoso && !/^javascript:/i.test(c.href) && !/\.(pdf|zip|exe)(\?|$)/i.test(c.href));
  });
}

function pontuar(c) {
  let s = 0;
  if (c.eAba) s += 45;
  if (c.temId) s += 20;
  if (c.noNav) s += 22;
  if (/entrar|login|menu|home|inicio|quem|sobre|funcional|servic|contato|aba|tab/i.test(c.texto)) s += 18;
  return s;
}

async function clicarSeletor(pagina, seletor) {
  try {
    if (seletor.startsWith('/') || seletor.startsWith('(')) {
      await pagina.locator('xpath=' + seletor).first().click({ timeout: 7000 });
    } else {
      await pagina.locator(seletor).first().click({ timeout: 7000 });
    }
    return;
  } catch (e1) {
    const ok = await pagina.evaluate((sel) => {
      let el = null;
      if (sel.startsWith('/') || sel.startsWith('(')) {
        el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } else {
        try { el = document.querySelector(sel); } catch (_) { /* ok */ }
      }
      if (!el) return false;
      el.click();
      return true;
    }, seletor);
    if (!ok) throw e1;
  }
}

async function esperarAssentar(pagina) {
  await pagina.waitForNetworkIdle({ idleTime: 600, timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
}

function passoBase(p) {
  return {
    titulo: p.titulo,
    obs: p.obs,
    acao: p.acao,
    elemento: p.elemento || '',
    valor: p.valor || '',
    html: p.html || '',
    imagens: p.imagens || []
  };
}

async function voltarBase(pagina, base) {
  if (pagina.url() === base) return;
  await pagina.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
  if (pagina.url() !== base) await pagina.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await esperarAssentar(pagina);
}

async function testarUrl(alvo) {
  const url = String(alvo || '').trim();
  if (!url) throw new Error('url ausente');
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error('url inválida: ' + url); }

  const navegador = await lancarBrowser();
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  await pagina.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Auditeste-Teste/1.0');

  const avisos = [];
  const passos = [];
  const quadros = [];
  let gravandoQuadros = true;
  const timerQuadros = setInterval(() => {
    if (!gravandoQuadros || quadros.length >= MAX_QUADROS) return;
    printTela(pagina, 38).then((u) => {
      if (gravandoQuadros && quadros.length < MAX_QUADROS) quadros.push(u);
    }).catch(() => {});
  }, 600);

  try {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
      imagens: [
        { dataUrl: printChegando, legenda: '1 — tela do clique' },
        { dataUrl: printHome, legenda: '2 — tela que abriu' }
      ]
    }));

    const usados = new Set();
    let cliques = 0;

    async function executarClique(cand) {
      if (!cand || cliques >= MAX_CLIQUES) return false;
      if (usados.has(cand.seletor) || (cand.href && usados.has(cand.href))) return false;
      usados.add(cand.seletor);
      if (cand.href) usados.add(cand.href);
      const urlAntes = pagina.url();
      await destacar(pagina, cand.seletor);
      await new Promise((r) => setTimeout(r, 350));
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
        const h = document.querySelector('h1, h2, [role="heading"], [role="tabpanel"]');
        return (h && (h.innerText || '').trim().slice(0, 80)) || document.title || '';
      }).catch(() => '');
      const rotulo = cand.texto || cand.id || cand.seletor;
      const tipo = cand.eAba ? 'aba' : 'item';
      passos.push(passoBase({
        titulo: cand.eAba ? 'Clicou na aba "' + rotulo + '"' : 'Clicou em "' + rotulo + '"',
        obs: 'Antes: ' + tipo + ' "' + rotulo + '". Depois: ' + (heading || pagina.url()) + (cand.html ? '. HTML: ' + cand.html : ''),
        acao: 'Clicar',
        elemento: cand.seletor,
        html: cand.html,
        imagens: [
          { dataUrl: antes, legenda: '1 — tela do clique' },
          { dataUrl: depois, legenda: '2 — tela que abriu' }
        ]
      }));
      cliques++;
      await new Promise((r) => setTimeout(r, 700));
      const soAncora = cand.href && (cand.href.startsWith('#') || (() => {
        try {
          const u = new URL(cand.href, urlAntes);
          const a = new URL(urlAntes);
          return u.hash && u.pathname === a.pathname && u.host === a.host;
        } catch (_) { return false; }
      })());
      if (cand.eAba || soAncora || pagina.url() === urlAntes) return true;
      if (pagina.url() !== base) await voltarBase(pagina, base);
      return true;
    }

    try {
      const cookie = (await listarCandidatos(pagina)).find((c) => /aceitar|aceito|concordo|entendi|ok,?\s*continuar/i.test(c.texto));
      if (cookie) await executarClique(cookie);

      /* abas da tela atual */
      const abas = (await listarCandidatos(pagina)).filter((c) => c.eAba).sort((a, b) => pontuar(b) - pontuar(a));
      for (const aba of abas) {
        if (cliques >= MAX_CLIQUES) break;
        await executarClique(aba);
      }

      await pagina.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      await pagina.evaluate(() => {
        const b = [...document.querySelectorAll('button, [role="button"], summary')].find((el) => {
          const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          return /menu|abrir navega|hamburguer|☰|≡/.test(t);
        });
        if (b) b.click();
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));

      for (const rota of ROTEIRO) {
        if (cliques >= MAX_CLIQUES) break;
        const lista = await listarCandidatos(pagina);
        const cand = escolherDaRota(lista, rota, usados, base);
        if (cand) await executarClique(cand);
      }

      const resto = (await listarCandidatos(pagina))
        .filter((c) => c.noNav || c.eAba)
        .filter((c) => !c.href || mesmaOrigem(c.href, base) || c.href.startsWith('/') || c.href.startsWith('#'))
        .sort((a, b) => pontuar(b) - pontuar(a));
      for (const cand of resto) {
        if (cliques >= MAX_CLIQUES) break;
        await executarClique(cand);
      }
    } catch (e) {
      avisos.push(e.message || String(e));
    }

    if (passos.length < 1) throw new Error('não foi possível abrir o site para printar');
  } finally {
    gravandoQuadros = false;
    clearInterval(timerQuadros);
    await new Promise((r) => setTimeout(r, 400));
    await navegador.close().catch(() => {});
  }

  return {
    url: parsed.href,
    titulo: parsed.hostname,
    passos,
    video: null,
    quadros,
    avisos
  };
}

module.exports = { testarUrl, montarSeletor, ePerigoso, PERIGOSOS, ROTEIRO, casarRoteiro, escolherDaRota, normalizar };
