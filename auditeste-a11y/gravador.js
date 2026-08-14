/* Sessão de navegação remota: a ponte abre a página num Chrome headless e o
 * Print mostra a tela. O analista clica na imagem, a coordenada volta para cá,
 * e aqui existe DOM — então o clique é inspecionado: seletor, rótulo, HTML e
 * URL, com print antes e depois.
 *
 * É o único caminho que serve ao cliente usando o Print hospedado: getDisplayMedia
 * não vê clique, a extensão exige instalar, e página HTTPS não alcança ponte local
 * (conteúdo misto). Headless roda no container sem problema.
 */
const crypto = require('crypto');
const { caminhoChrome } = require('./a11y.js');

const LARGURA = 1366;
const ALTURA = 768;
const ESPERA_DEPOIS_MS = 800;
const ESPERA_MAX_MS = 6000;
const MAX_PASSOS = 60;
const MAX_SESSOES = 4;
const OCIOSO_MS = 15 * 60 * 1000;

const sessoes = new Map();

const jpeg = (buf) => 'data:image/jpeg;base64,' + buf.toString('base64');

function pegar(id) {
  const s = sessoes.get(id);
  if (!s) {
    const e = new Error('Sessão não encontrada ou já encerrada. Abra o navegador de novo.');
    e.expirada = true;
    throw e;
  }
  s.visto = Date.now();
  return s;
}

async function foto(pagina, qualidade) {
  return jpeg(await pagina.screenshot({ type: 'jpeg', quality: qualidade || 70 }));
}

/* Roda na página: descreve o elemento sob o ponto, na mesma prioridade de
 * seletor da extensão, e marca em vermelho para sair no print "antes". */
function inspecionarPonto(x, y) {
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

  const alvoDe = (o) => (o instanceof Element) ? (o.closest([
    'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
    '[role="menuitem"]', 'input', 'select', 'textarea', '[onclick]'
  ].join(',')) || o) : null;

  const bruto = document.elementFromPoint(x, y);
  const el = alvoDe(bruto);
  if (!el) return null;

  const rotulo = String(
    el.getAttribute('aria-label') || el.getAttribute('title')
    || el.innerText || el.value || el.getAttribute('placeholder') || el.id || el.tagName
  ).replace(/\s+/g, ' ').trim().slice(0, 200);

  /* Le o HTML ANTES de marcar: pintar primeiro gravaria o meu style="outline"
   * dentro da evidencia tecnica que o QA leva para o script. */
  const dados = {
    seletor: seletorDe(el),
    rotulo,
    html: el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 1200),
    tag: el.tagName.toLowerCase(),
    /* Clicavel de verdade, ou com cara de clicavel: cursor:pointer e como UI
     * moderna sinaliza isso, e pega card em div com listener delegado, que a
     * lista de tags sozinha perderia. */
    interativo: el.matches([
      'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
      '[role="menuitem"]', 'input', 'select', 'textarea', '[onclick]'
    ].join(',')) || (() => {
      let at = el;
      for (let i = 0; at && i < 4; i++, at = at.parentElement) {
        if (getComputedStyle(at).cursor === 'pointer') return true;
      }
      return false;
    })(),
    url: location.href
  };

  /* Sai por chamada explicita, nao por timer: um timer removeria a marca no
   * meio do proximo passo e a tela "mudaria" por causa da minha tinta. */
  const antes = el.style.outline;
  const off = el.style.outlineOffset;
  el.style.outline = '3px solid #e23c3c';
  el.style.outlineOffset = '2px';
  window.__audiDesmarcar = () => {
    try { el.style.outline = antes; el.style.outlineOffset = off; } catch (_) { }
    window.__audiDesmarcar = null;
  };

  return dados;
}

async function assentar(pagina) {
  const limite = Date.now() + ESPERA_MAX_MS;
  let anterior = null;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, ESPERA_DEPOIS_MS));
    let atual;
    try { atual = await pagina.screenshot({ type: 'jpeg', quality: 35 }); } catch (_) { return; }
    if (anterior && Buffer.compare(anterior, atual) === 0) return;
    anterior = atual;
  }
}

async function abrir(url) {
  const chrome = caminhoChrome();
  if (!chrome) {
    const e = new Error('Chrome não encontrado. Rode: npx puppeteer browsers install chrome');
    e.codigo = 'SEM_CHROME';
    throw e;
  }
  if (sessoes.size >= MAX_SESSOES) {
    throw new Error(`${MAX_SESSOES} navegações já abertas. Encerre uma antes de abrir outra.`);
  }

  const puppeteer = require('puppeteer');
  const nav = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const pagina = await nav.newPage();
  await pagina.setViewport({ width: LARGURA, height: ALTURA });
  // Sem UA de Chrome real, loja grande serve pagina de "navegador nao suportado".
  await pagina.setUserAgent(process.env.PONTE_UA
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
       + ' (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
  await pagina.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  const s = {
    id: crypto.randomUUID(), nav, pagina, passos: [], visto: Date.now(), ocupada: false
  };
  sessoes.set(s.id, s);
  return {
    id: s.id, largura: LARGURA, altura: ALTURA,
    url: pagina.url(), titulo: await pagina.title().catch(() => ''),
    tela: await foto(pagina)
  };
}

async function tela(id) {
  const s = pegar(id);
  return { tela: await foto(s.pagina), url: s.pagina.url(), total: s.passos.length };
}

async function clicar(id, x, y) {
  const s = pegar(id);
  if (s.ocupada) return { ocupada: true };
  if (s.passos.length >= MAX_PASSOS) return { erro: `Limite de ${MAX_PASSOS} passos.` };
  s.ocupada = true;
  try {
    const px = Math.max(0, Math.min(LARGURA - 1, Math.round(x)));
    const py = Math.max(0, Math.min(ALTURA - 1, Math.round(y)));

    const urlAntes = s.pagina.url();
    const info = await s.pagina.evaluate(inspecionarPonto, px, py);
    const antes = await foto(s.pagina);
    // A marca cumpriu o papel no print "antes"; some antes do clique agir.
    await s.pagina.evaluate(() => { if (window.__audiDesmarcar) window.__audiDesmarcar(); })
      .catch(() => { });

    await s.pagina.mouse.click(px, py);
    await assentar(s.pagina);

    const depois = await foto(s.pagina);
    const urlDepois = s.pagina.url();
    const agora = new Date().toISOString();

    // Area morta nao vira passo e nao polui a evidencia.
    if (!info || !info.seletor || !info.interativo) {
      s.ocupada = false;
      return { semAlvo: true, tela: depois, url: urlDepois };
    }

    const passo = {
      id: crypto.randomUUID(),
      titulo: `Clicou em "${info.rotulo || info.seletor}"`,
      obs: 'Descrição pendente.',
      acao: info.tag === 'input' || info.tag === 'textarea' ? 'Preencher' : 'Clicar',
      elemento: info.seletor,
      rotulo: info.rotulo,
      html: info.html,
      timestampAntes: agora,
      timestampDepois: new Date().toISOString(),
      urlAntes,
      urlDepois,
      imagens: [
        { dataUrl: antes, legenda: '1 ANTES — onde clicou' },
        { dataUrl: depois, legenda: '2 DEPOIS — para onde entrou' }
      ]
    };
    s.passos.push(passo);
    s.ocupada = false;
    return { passo, tela: depois, url: urlDepois, total: s.passos.length };
  } catch (err) {
    s.ocupada = false;
    throw err;
  }
}

async function rolar(id, dy) {
  const s = pegar(id);
  await s.pagina.evaluate((d) => window.scrollBy(0, d), Number(dy) || 0);
  await new Promise((r) => setTimeout(r, 350));
  return { tela: await foto(s.pagina), url: s.pagina.url() };
}

async function digitar(id, texto) {
  const s = pegar(id);
  await s.pagina.keyboard.type(String(texto || '').slice(0, 200), { delay: 25 });
  await new Promise((r) => setTimeout(r, 350));
  return { tela: await foto(s.pagina), url: s.pagina.url() };
}

function passos(id, desde) {
  const s = sessoes.get(id);
  if (!s) return { erro: 'sessão não encontrada' };
  s.visto = Date.now();
  const n = Math.max(0, Number(desde) || 0);
  return { total: s.passos.length, passos: s.passos.slice(n) };
}

async function fechar(id) {
  const s = sessoes.get(id);
  if (!s) return { ok: true };
  sessoes.delete(id);
  try { await s.nav.close(); } catch (_) { }
  return { ok: true, passos: s.passos.length };
}

// Sessão esquecida não pode segurar Chrome e memória para sempre.
setInterval(() => {
  for (const [id, s] of sessoes) {
    if (Date.now() - s.visto > OCIOSO_MS) fechar(id);
  }
}, 60000).unref();

module.exports = { abrir, tela, clicar, rolar, digitar, passos, fechar, LARGURA, ALTURA };
