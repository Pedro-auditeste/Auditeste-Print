/* Catálogo de elementos interativos de uma página.
 *
 * O Print grava pixels e não enxerga o DOM. Aqui a ponte abre a URL num Chrome
 * de verdade e lista o que dá para clicar, com seletor, rótulo e HTML — o Print
 * casa pelo rótulo que a descrição do print já extraiu e preenche o seletor.
 *
 * Limite conhecido: abre como visitante anônimo. Página atrás de login não é
 * alcançada; nesse caso o caminho é a extensão Chrome.
 */
const { lancarChrome } = require('./a11y.js');

const MAX_ELEMENTOS = 400;
const MAX_HTML = 1200;

/* Mesma lista da extensão (content.js, função clicavel). Se mudar lá, mude
 * aqui: o casamento por rótulo depende de os dois verem os mesmos elementos. */
const CLICAVEIS = [
  'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
  '[role="menuitem"]', 'input[type="button"]', 'input[type="submit"]',
  'input[type="checkbox"]', 'input[type="radio"]', '[onclick]',
  'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
  'input[type="search"]', 'input[type="url"]', 'input[type="tel"]',
  'input[type="number"]', 'select', 'textarea'
].join(',');

/* Roda dentro da página. Repete a prioridade de seletor da extensão:
 * #id -> [data-testid|data-qa|data-test] -> tag[name] -> xpath posicional. */
function coletar(seletorCss, maxEls, maxHtml) {
  const escapa = (v) => (window.CSS && CSS.escape)
    ? CSS.escape(v)
    : String(v).replace(/([^\w-])/g, '\\$1');

  /* So serve se apontar para UM elemento: loja grande repete data-testid
   * generico em dezenas de nos, e o script de automacao nao usa isso. */
  const unico = (sel) => {
    try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; }
  };

  function seletorDe(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && unico('#' + escapa(el.id))) return '#' + escapa(el.id);
    for (const attr of ['data-testid', 'data-qa', 'data-test']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      for (const cand of [`[${attr}="${escapa(v)}"]`, `${tag}[${attr}="${escapa(v)}"]`]) {
        if (unico(cand)) return cand;
      }
    }
    const name = el.getAttribute('name');
    if (name && unico(`${tag}[name="${escapa(name)}"]`)) return `${tag}[name="${escapa(name)}"]`;
    const partes = [];
    let atual = el;
    while (atual && atual.nodeType === 1) {
      let i = 1;
      let irmao = atual.previousElementSibling;
      while (irmao) {
        if (irmao.tagName === atual.tagName) i++;
        irmao = irmao.previousElementSibling;
      }
      partes.unshift(`${atual.tagName.toLowerCase()}[${i}]`);
      if (atual === document.documentElement) break;
      atual = atual.parentElement;
    }
    return partes.length ? '/' + partes.join('/') : '';
  }

  function rotuloDe(el) {
    const porId = el.id && document.querySelector(`label[for="${el.id}"]`);
    return String(
      el.getAttribute('aria-label')
      || el.getAttribute('title')
      || (porId && porId.innerText)
      || el.innerText
      || el.value
      || el.getAttribute('placeholder')
      || el.getAttribute('alt')
      || ''
    ).replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  const vistos = new Set();
  const fora = [];
  for (const el of document.querySelectorAll(seletorCss)) {
    if (fora.length >= maxEls) break;
    const r = el.getBoundingClientRect();
    // Elemento sem caixa é menu fechado, modal oculto, coisa que o QA não clicou.
    if (!r.width || !r.height) continue;
    const seletor = seletorDe(el);
    if (!seletor || vistos.has(seletor)) continue;
    vistos.add(seletor);
    fora.push({
      seletor,
      rotulo: rotuloDe(el),
      tag: el.tagName.toLowerCase(),
      tipo: el.getAttribute('type') || '',
      html: el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, maxHtml)
    });
  }
  return fora;
}

async function catalogar(url, { esperaMs = 2500 } = {}) {
  const navegador = await lancarChrome();
  try {
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1366, height: 900 });
    /* Sem isto, loja grande entrega a página de "navegador não suportado":
     * o UA do headless denuncia e o catálogo volta com 5 links inúteis. */
    await pagina.setUserAgent(process.env.PONTE_UA
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
         + ' (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    await pagina.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Um respiro para o que monta depois do load (SPA, banner, carrossel).
    await new Promise((r) => setTimeout(r, esperaMs));
    const elementos = await pagina.evaluate(coletar, CLICAVEIS, MAX_ELEMENTOS, MAX_HTML);
    return {
      url: pagina.url(),
      titulo: (await pagina.title()) || '',
      elementos,
      truncado: elementos.length >= MAX_ELEMENTOS
    };
  } finally {
    await navegador.close().catch(() => {});
  }
}

module.exports = { catalogar, CLICAVEIS };
