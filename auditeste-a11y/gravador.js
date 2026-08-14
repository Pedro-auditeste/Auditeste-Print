/* Gravação clicando: a ponte abre um Chrome visível, o analista usa, e cada
 * clique vira passo com seletor, HTML, URL e print antes/depois.
 *
 * Diferente da gravação por tela do Print, aqui existe DOM: o clique é
 * inspecionado de verdade. Diferente da extensão, não precisa instalar nada —
 * mas exige a ponte LOCAL, porque o container da Railway não tem janela.
 */
const crypto = require('crypto');
const { caminhoChrome } = require('./a11y.js');

const ESPERA_DEPOIS_MS = 900;
const ESPERA_MAX_MS = 8000;
const MAX_PASSOS = 60;
const OCIOSO_MS = 30 * 60 * 1000;

const sessoes = new Map();

function semJanela() {
  if (process.env.PONTE_COM_JANELA === '1') return false;
  return process.platform === 'linux' && !process.env.DISPLAY;
}

/* Roda dentro da página, a cada navegação. Mesma prioridade de seletor da
 * extensão: #id -> data-testid -> name -> xpath posicional. */
function injetado() {
  if (window.__audiLigado) return;
  window.__audiLigado = true;

  const escapa = (v) => (window.CSS && CSS.escape)
    ? CSS.escape(v) : String(v).replace(/([^\w-])/g, '\\$1');

  function seletorDe(el) {
    if (el.id) return '#' + escapa(el.id);
    for (const a of ['data-testid', 'data-qa', 'data-test']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${escapa(v)}"]`;
    }
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${escapa(name)}"]`;
    const partes = [];
    let at = el;
    while (at && at.nodeType === 1) {
      let i = 1;
      let irm = at.previousElementSibling;
      while (irm) { if (irm.tagName === at.tagName) i++; irm = irm.previousElementSibling; }
      partes.unshift(`${at.tagName.toLowerCase()}[${i}]`);
      if (at === document.documentElement) break;
      at = at.parentElement;
    }
    return partes.length ? '/' + partes.join('/') : '';
  }

  const clicavel = (o) => (o instanceof Element) ? o.closest([
    'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
    '[role="menuitem"]', 'input', 'select', 'textarea', '[onclick]'
  ].join(',')) : null;

  const rotuloDe = (el) => String(
    el.getAttribute('aria-label') || el.getAttribute('title')
    || el.innerText || el.value || el.getAttribute('placeholder') || el.id || el.tagName
  ).replace(/\s+/g, ' ').trim().slice(0, 200);

  let ultimo = 0;
  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const el = clicavel(ev.composedPath()[0]);
    const agora = Date.now();
    if (!el || agora - ultimo < 450) return;
    const seletor = seletorDe(el);
    if (!seletor) return;
    ultimo = agora;

    // Marca em vermelho para o print "antes" mostrar o que foi clicado.
    const antes = el.style.outline;
    const off = el.style.outlineOffset;
    el.style.outline = '3px solid #e23c3c';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = antes; el.style.outlineOffset = off; }, 1200);

    window.__audiClique({
      seletor,
      rotulo: rotuloDe(el),
      html: el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 1200),
      url: location.href
    });
  }, true);
}

const jpeg = (buf) => 'data:image/jpeg;base64,' + buf.toString('base64');

async function registrar(s, info) {
  if (s.passos.length >= MAX_PASSOS) return;
  s.visto = Date.now();
  let antes = null;
  try { antes = jpeg(await s.pagina.screenshot({ type: 'jpeg', quality: 72 })); } catch (_) { }

  // Espera a tela assentar, com teto para página que nunca para de mexer.
  const limite = Date.now() + ESPERA_MAX_MS;
  let anterior = null;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, ESPERA_DEPOIS_MS));
    let atual = null;
    try { atual = await s.pagina.screenshot({ type: 'jpeg', quality: 40 }); } catch (_) { break; }
    if (anterior && Buffer.compare(anterior, atual) === 0) break;
    anterior = atual;
  }

  let depois = null;
  let urlDepois = info.url;
  try {
    depois = jpeg(await s.pagina.screenshot({ type: 'jpeg', quality: 72 }));
    urlDepois = s.pagina.url();
  } catch (_) { }

  const agora = new Date().toISOString();
  s.passos.push({
    id: crypto.randomUUID(),
    titulo: `Clicou em "${info.rotulo || info.seletor}"`,
    obs: 'Descrição pendente.',
    acao: 'Clicar',
    elemento: info.seletor,
    rotulo: info.rotulo,
    html: info.html,
    timestampAntes: agora,
    timestampDepois: agora,
    urlAntes: info.url,
    urlDepois,
    imagens: [
      antes && { dataUrl: antes, legenda: 'Antes · onde clicou' },
      depois && { dataUrl: depois, legenda: 'Depois · para onde entrou' }
    ].filter(Boolean)
  });
  s.visto = Date.now();
}

async function abrir(url) {
  if (semJanela()) {
    const e = new Error('Esta ponte não tem janela (container). Rode a ponte na sua máquina: npm run servidor.');
    e.semJanela = true;
    throw e;
  }
  const chrome = caminhoChrome();
  if (!chrome) {
    const e = new Error('Chrome não encontrado. Rode: npx puppeteer browsers install chrome');
    e.codigo = 'SEM_CHROME';
    throw e;
  }
  const puppeteer = require('puppeteer');
  const nav = await puppeteer.launch({
    executablePath: chrome,
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const [pagina] = await nav.pages();
  const s = {
    id: crypto.randomUUID(), nav, pagina, passos: [],
    fila: Promise.resolve(), visto: Date.now(), url
  };
  sessoes.set(s.id, s);

  nav.on('disconnected', () => { s.fechada = true; });
  await pagina.exposeFunction('__audiClique', (info) => {
    s.fila = s.fila.then(() => registrar(s, info)).catch(() => { });
  });
  await pagina.evaluateOnNewDocument(injetado);
  await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { id: s.id, url };
}

/** Passos a partir de 'desde', para o Print não rebaixar as imagens toda vez. */
function passos(id, desde) {
  const s = sessoes.get(id);
  if (!s) return { erro: 'sessão não encontrada' };
  s.visto = Date.now();
  const n = Math.max(0, Number(desde) || 0);
  return { total: s.passos.length, fechada: !!s.fechada, passos: s.passos.slice(n) };
}

async function fechar(id) {
  const s = sessoes.get(id);
  if (!s) return { ok: true };
  sessoes.delete(id);
  try { await s.nav.close(); } catch (_) { }
  return { ok: true, passos: s.passos.length };
}

// Janela esquecida aberta não pode segurar Chrome para sempre.
setInterval(() => {
  for (const [id, s] of sessoes) {
    if (Date.now() - s.visto > OCIOSO_MS) fechar(id);
  }
}, 60000).unref();

/** Só para teste: a página da sessão, para simular o clique do analista. */
function paginaDe(id) {
  const s = sessoes.get(id);
  return s && s.pagina;
}

module.exports = { abrir, passos, fechar, semJanela, paginaDe };
