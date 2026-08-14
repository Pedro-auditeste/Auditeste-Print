(() => {
  let ultimaAcao = 0;

  function escapeCss(valor) {
    return globalThis.CSS?.escape
      ? CSS.escape(valor)
      : String(valor).replace(/([^\w-])/g, '\\$1');
  }

  function seletorDe(el) {
    if (el.id) return '#' + escapeCss(el.id);
    for (const atributo of ['data-testid', 'data-qa', 'data-test']) {
      const valor = el.getAttribute(atributo);
      if (valor) return `[${atributo}="${escapeCss(valor)}"]`;
    }
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;

    const partes = [];
    let atual = el;
    while (atual && atual.nodeType === Node.ELEMENT_NODE) {
      let indice = 1;
      let irmao = atual.previousElementSibling;
      while (irmao) {
        if (irmao.tagName === atual.tagName) indice++;
        irmao = irmao.previousElementSibling;
      }
      partes.unshift(`${atual.tagName.toLowerCase()}[${indice}]`);
      if (atual === document.documentElement) break;
      atual = atual.parentElement;
    }
    return partes.length ? '/' + partes.join('/') : '';
  }

  function clicavel(origem) {
    if (!(origem instanceof Element)) return null;
    return origem.closest([
      'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
      '[role="menuitem"]', 'input[type="button"]', 'input[type="submit"]',
      'input[type="checkbox"]', 'input[type="radio"]', '[onclick]'
    ].join(','));
  }

  function rotuloDe(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText ||
      el.value ||
      el.id ||
      el.tagName
    ).replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  function destacar(el) {
    const anterior = el.style.outline;
    const offset = el.style.outlineOffset;
    el.style.outline = '4px solid #e23c3c';
    el.style.outlineOffset = '3px';
    setTimeout(() => {
      el.style.outline = anterior;
      el.style.outlineOffset = offset;
    }, 750);
  }

  function registrar(el) {
    const agora = Date.now();
    if (!el || agora - ultimaAcao < 450) return;
    ultimaAcao = agora;
    const seletor = seletorDe(el);
    if (!seletor) return;
    destacar(el);
    chrome.runtime.sendMessage({
      tipo: 'AUDI_ACAO',
      acao: {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        seletor,
        rotulo: rotuloDe(el),
        html: el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 500),
        urlAntes: location.href,
        frameUrl: window === window.top ? '' : location.href
      }
    }).catch(() => {});
  }

  document.addEventListener('pointerdown', (evento) => {
    if (evento.button !== 0) return;
    registrar(clicavel(evento.composedPath()[0]));
  }, true);

  document.addEventListener('keydown', (evento) => {
    if (evento.repeat || !['Enter', ' '].includes(evento.key)) return;
    registrar(clicavel(evento.composedPath()[0]));
  }, true);

  document.addEventListener('click', () => {
    chrome.runtime.sendMessage({ tipo: 'AUDI_ACAO_CONCLUIDA' }).catch(() => {});
  }, true);
})();
