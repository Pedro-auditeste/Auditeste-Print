(() => {
  let ultimaAcao = 0;
  let gravando = false;

  function escapeCss(valor) {
    return globalThis.CSS?.escape
      ? CSS.escape(valor)
      : String(valor).replace(/([^\w-])/g, '\\$1');
  }

  /* Só serve se apontar para UM elemento: loja grande repete data-testid
   * generico em dezenas de nos, e o script de automacao nao usa isso. */
  function unico(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }

  function seletorDe(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && unico('#' + escapeCss(el.id))) return '#' + escapeCss(el.id);
    for (const atributo of ['data-testid', 'data-qa', 'data-test']) {
      const valor = el.getAttribute(atributo);
      if (!valor) continue;
      for (const cand of [`[${atributo}="${escapeCss(valor)}"]`, `${tag}[${atributo}="${escapeCss(valor)}"]`]) {
        if (unico(cand)) return cand;
      }
    }
    const name = el.getAttribute('name');
    if (name && unico(`${tag}[name="${escapeCss(name)}"]`)) return `${tag}[name="${escapeCss(name)}"]`;

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
  const AMBAR = '#e8901f';
  const VERMELHO = '#e23c3c';

  /* Realce estilo inspetor: uma sobreposicao propria, nunca o style do elemento.
   * Mudar o style do alvo contaminaria o outerHTML capturado e poderia empurrar
   * o layout da pagina testada. A sobreposicao nao recebe clique. */
  let caixa = null;
  let etiqueta = null;
  let alvoAtual = null;
  let travado = false;   // durante a captura o realce nao segue o mouse
  let quadro = 0;

  function criarRealce() {
    if (caixa) return;
    const base = 'position:fixed;z-index:2147483647;pointer-events:none;'
      + 'box-sizing:border-box;display:none;';
    caixa = document.createElement('div');
    caixa.style.cssText = base + 'border-radius:4px;';
    etiqueta = document.createElement('div');
    etiqueta.style.cssText = base
      + 'font:600 12px/1.4 ui-monospace,Consolas,monospace;color:#fff;'
      + 'padding:2px 7px;border-radius:4px;max-width:60vw;overflow:hidden;'
      + 'text-overflow:ellipsis;white-space:nowrap;';
    // documentElement e nao body: sobrevive a paginas que trocam o body.
    document.documentElement.append(caixa, etiqueta);
  }

  function posicionar(el, cor, texto) {
    criarRealce();
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return esconderRealce();
    caixa.style.display = 'block';
    caixa.style.border = '3px solid ' + cor;
    caixa.style.left = r.left + 'px';
    caixa.style.top = r.top + 'px';
    caixa.style.width = r.width + 'px';
    caixa.style.height = r.height + 'px';

    etiqueta.style.display = texto ? 'block' : 'none';
    if (!texto) return;
    etiqueta.textContent = texto;
    etiqueta.style.background = cor;
    // Acima do elemento; se nao couber, por dentro do topo.
    const acima = r.top >= 24;
    etiqueta.style.left = Math.max(2, r.left) + 'px';
    etiqueta.style.top = (acima ? r.top - 22 : r.top + 3) + 'px';
  }

  function esconderRealce() {
    if (!caixa) return;
    caixa.style.display = 'none';
    etiqueta.style.display = 'none';
  }

  function seguir(el) {
    if (travado || !gravando) return;
    if (!el) { alvoAtual = null; return esconderRealce(); }
    alvoAtual = el;
    posicionar(el, AMBAR, seletorDe(el));
  }

  function reposicionar() {
    if (!alvoAtual || !gravando) return;
    if (!alvoAtual.isConnected) { alvoAtual = null; return esconderRealce(); }
    posicionar(alvoAtual, travado ? VERMELHO : AMBAR, seletorDe(alvoAtual));
  }

  /** Trava o realce em vermelho sobre o alvo ate o print sair. */
  function destacar(el) {
    travado = true;
    alvoAtual = el;
    posicionar(el, VERMELHO, seletorDe(el));
    return () => {
      travado = false;
      esconderRealce();
      alvoAtual = null;
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

  /* Realce so existe gravando: fora da sessao a extensao nao pinta nada na
   * pagina do usuario. */
  document.addEventListener('pointerover', (evento) => {
    if (!gravando || travado) return;
    const el = clicavel(evento.composedPath()[0]);
    if (el !== alvoAtual) seguir(el);
  }, true);

  // Um quadro por vez: scroll dispara muito e reposicionar e barato mas nao de graca.
  const pedirReposicao = () => {
    if (!gravando || quadro) return;
    quadro = requestAnimationFrame(() => { quadro = 0; reposicionar(); });
  };
  addEventListener('scroll', pedirReposicao, true);
  addEventListener('resize', pedirReposicao);

  function ligarRealce(ativo) {
    gravando = !!ativo;
    if (!gravando) {
      travado = false;
      alvoAtual = null;
      esconderRealce();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === 'AUDI_SESSAO') ligarRealce(msg.ativa);
  });

  /* Ponte para o Print puxar a gravacao sem exportar e importar arquivo.
   *
   * So nas origens do Print: as sessoes contem prints de outras abas, entao
   * qualquer site poder pedi-las seria vazamento. Se voce hospedar o Print em
   * outro endereco, acrescente-o aqui. */
  const ORIGENS_PRINT = ['https://audiprint.up.railway.app'];

  /** Local e a maquina do proprio usuario, entao qualquer porta serve. */
  function paginaDoPrint() {
    if (ORIGENS_PRINT.includes(location.origin)) return true;
    if (location.protocol === 'file:') return true;
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost'
      || location.hostname === '[::1]';
  }

  if (window === window.top && paginaDoPrint()) {
    window.addEventListener('message', async (ev) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.tipo !== 'AUDI_PRINT_PEDE') return;
      const responder = (corpo) => window.postMessage(
        Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin
      );
      try {
        const r = d.deTab == null
          ? await chrome.runtime.sendMessage({ tipo: 'AUDI_EVIDENCIAS' })
          : await chrome.runtime.sendMessage({ tipo: 'AUDI_EVIDENCIA', deTab: d.deTab });
        responder(r || { erro: 'A extensão não respondeu.' });
      } catch (e) {
        responder({ erro: e.message || 'A extensão não respondeu.' });
      }
    });
    // Anuncia a presenca: o Print mostra o botao so quando ha extensao.
    window.postMessage({ tipo: 'AUDI_EXTENSAO_PRESENTE' }, location.origin);
  }

  // Navegar recarrega o content script no meio da sessao: pergunta como esta.
  chrome.runtime.sendMessage({ tipo: 'AUDI_STATUS' })
    .then((r) => ligarRealce(r && r.sessao && r.sessao.ativa))
    .catch(() => {});
})();
