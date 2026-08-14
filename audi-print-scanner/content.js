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
    ).replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  // Rede de seguranca: se o print nunca vier, a marca nao fica presa na tela.
  const MARCA_MAX_MS = 4000;

  /** Marca o elemento em vermelho. Devolve a funcao que tira a marca. */
  function destacar(el) {
    const anterior = el.style.outline;
    const offset = el.style.outlineOffset;
    // outline nao ocupa espaco, entao marcar nao empurra o layout do print.
    el.style.outline = '4px solid #e23c3c';
    el.style.outlineOffset = '3px';
    return () => {
      el.style.outline = anterior;
      el.style.outlineOffset = offset;
    };
  }

  /** Segura a marca vermelha ate o print "antes" sair, e nunca alem disso.
   *  Com timer fixo a marca saia antes da captura e o print vinha sem ela. */
  function segurarAte(tirar, promessa) {
    let feito = false;
    const limpar = () => {
      if (feito) return;
      feito = true;
      clearTimeout(rede);
      try { tirar(); } catch (e) { /* elemento ja saiu da pagina */ }
    };
    const rede = setTimeout(limpar, MARCA_MAX_MS);
    Promise.resolve(promessa).then(limpar, limpar);
    return limpar;
  }

  function registrar(el) {
    const agora = Date.now();
    if (!el || agora - ultimaAcao < 450) return;
    ultimaAcao = agora;
    const seletor = seletorDe(el);
    if (!seletor) return;

    // Ordem importa: o HTML e lido antes da marca, senao guardaria o style
    // injetado; a marca entra antes do envio, senao a captura pode chegar antes.
    const acao = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      seletor,
      rotulo: rotuloDe(el),
      html: el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 1200),
      urlAntes: location.href,
      frameUrl: window === window.top ? '' : location.href
    };

    const tirarMarca = destacar(el);
    // O background so responde depois de tirar o print "antes", entao a marca
    // fica na tela exatamente ate a captura acontecer — nem menos, nem mais.
    segurarAte(tirarMarca, chrome.runtime.sendMessage({ tipo: 'AUDI_ACAO', acao }));
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
