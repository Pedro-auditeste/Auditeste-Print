(() => {
  let ultimaAcao = 0;
  let gravando = false;

  /* Xpath sempre: e o unico seletor que o script de automacao le igual em
   * Selenium, Playwright e Cypress, e o QA pediu um formato so. */
  function aspas(v) {
    if (!v.includes('"')) return '"' + v + '"';
    if (!v.includes("'")) return "'" + v + "'";
    return '';   // os dois tipos de aspas: nao vale o concat(), cai no posicional
  }

  /* So serve se apontar para UM no: loja grande repete data-testid generico em
   * dezenas de elementos, e a automacao pegaria o errado. */
  function unico(xp) {
    try {
      return document.evaluate('count(' + xp + ')', document, null,
        XPathResult.NUMBER_TYPE, null).numberValue === 1;
    } catch (e) { return false; }
  }

  function posicional(el) {
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

  /** Xpath curto e estavel quando da, absoluto quando nao ha por onde ancorar. */
  function seletorDe(el) {
    const tag = el.tagName.toLowerCase();
    const candidatos = [];
    const porAtributo = (nome, valor) => {
      const v = aspas(String(valor));
      if (!v) return;
      candidatos.push(`//*[@${nome}=${v}]`, `//${tag}[@${nome}=${v}]`);
    };
    if (el.id) porAtributo('id', el.id);
    /* placeholder entra na lista porque campo sem id nem name e comum em site
     * feito com Tailwind: sem ele o xpath viraria /html/body/div[1]/div[2]/... */
    for (const atributo of ['data-testid', 'data-qa', 'data-test', 'name', 'aria-label', 'placeholder']) {
      const valor = el.getAttribute(atributo);
      if (valor) porAtributo(atributo, valor);
    }
    const texto = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (texto && texto.length <= 60) {
      const v = aspas(texto);
      if (v) candidatos.push(`//${tag}[normalize-space(.)=${v}]`);
    }
    for (const cand of candidatos) if (unico(cand)) return cand;
    return posicional(el);
  }

  function clicavel(origem) {
    if (!(origem instanceof Element)) return null;
    return origem.closest([
      'a[href]', 'button', 'summary', '[role="button"]', '[role="tab"]',
      '[role="menuitem"]', 'input[type="button"]', 'input[type="submit"]',
      'input[type="checkbox"]', 'input[type="radio"]', '[onclick]'
    ].join(','));
  }

  /* Em campo, o rotulo NUNCA e o value: senao o passo vira "Preencheu PROMO10
   * com PROMO10" e o QA perde de que campo se tratava. */
  function rotuloDe(el) {
    const campo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    const dosLabels = campo && el.labels && el.labels.length ? el.labels[0].innerText : '';
    return String(
      el.getAttribute('aria-label') ||
      dosLabels ||
      el.getAttribute('title') ||
      (campo ? (el.getAttribute('placeholder') || el.getAttribute('name')) : el.innerText) ||
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

  /* Barato de proposito: title e h1, nada de percorrer o DOM. A versao anterior
   * lia a arvore inteira com getComputedStyle a cada interacao e travava a
   * pagina; isto custa microssegundos e ja tira o titulo das maos do modelo. */
  function resumoDaTela() {
    const h1 = document.querySelector('h1');
    return {
      titulo: (document.title || '').slice(0, 160),
      cabecalho: (h1 ? h1.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 160)
    };
  }

  /* O outerHTML e o outro caminho do segredo: mascarar so o campo "valor"
   * deixava passar o value="..." que o servidor do cliente ja tinha
   * renderizado no input. O seletor e a estrutura ficam; o conteudo sai. */
  function htmlSeguro(el) {
    let bruto = el.outerHTML;
    if (campoSensivel(el, el.value)) {
      bruto = bruto.replace(/\svalue\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' value="(oculto)"');
    }
    return bruto.replace(/\s+/g, ' ').trim().slice(0, 1200);
  }

  function registrar(el, tipo, valor) {
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
      tipo: tipo || 'Clicar',
      valor: String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim().slice(0, 300),
      rotulo: rotuloDe(el),
      html: htmlSeguro(el),
      urlAntes: location.href,
      frameUrl: window === window.top ? '' : location.href,
      textoAntes: resumoDaTela()
    };

    const tirarMarca = destacar(el);
    // O background so responde depois de tirar o print "antes", entao a marca
    // fica na tela exatamente ate a captura acontecer — nem menos, nem mais.
    segurarAte(tirarMarca, chrome.runtime.sendMessage({ tipo: 'AUDI_ACAO', acao }));
  }

  document.addEventListener('pointerdown', (evento) => {
    if (evento.button !== 0) return;
    registrar(clicavel(evento.composedPath()[0]), 'Clicar');
  }, true);

  document.addEventListener('keydown', (evento) => {
    if (evento.repeat || !['Enter', ' '].includes(evento.key)) return;
    registrar(clicavel(evento.composedPath()[0]), 'Clicar');
  }, true);

  /* Preencher e limpar sao o mesmo evento: o que separa e o campo ter ficado
   * vazio. O 'change' so dispara quando o valor mudou de verdade, entao entrar
   * e sair do campo sem digitar nao vira passo. */
  /* Campo cujo VALOR nao pode entrar na evidencia.
   *
   * O passo continua existindo e o elemento continua identificado: some so o
   * conteudo digitado. type=password cobria senha e mais nada, e a evidencia
   * atravessa a ponte ate a IA, entao CPF e cartao digitados num input de
   * texto comum saiam inteiros.
   *
   * Duas frentes, porque uma so nao basta: o nome do campo (funciona antes de
   * digitar qualquer coisa) e o formato do valor (funciona quando o campo se
   * chama "documento" e nao diz o que guarda). */
  const NOME_SENSIVEL = /senha|password|passwd|cpf|cnpj|cart[aã]o|cardnumber|creditcard|cvv|cvc|csc|token|secret|apikey|api[-_]?key|chave|pin|rg\b|passaporte|ag[eê]ncia|agencia/i;
  const AUTO_SENSIVEL = /password|cc-number|cc-csc|cc-exp|one-time-code/i;

  /** Luhn: sem isso, todo numero longo viraria "cartao" e a evidencia perderia
   *  codigo de pedido, protocolo e nota fiscal sem motivo. */
  function passaLuhn(digitos) {
    let soma = 0;
    let dobra = false;
    for (let i = digitos.length - 1; i >= 0; i--) {
      let d = digitos.charCodeAt(i) - 48;
      if (dobra) { d *= 2; if (d > 9) d -= 9; }
      soma += d;
      dobra = !dobra;
    }
    return soma % 10 === 0;
  }

  function valorSensivel(valor) {
    const t = String(valor || '').trim();
    if (!t) return false;
    // CPF e CNPJ escritos com ou sem mascara.
    if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(t)) return true;
    if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(t)) return true;
    const so = t.replace(/[\s.-]/g, '');
    if (/^\d{13,19}$/.test(so) && passaLuhn(so)) return true;
    return false;
  }

  function campoSensivel(el, valor) {
    if (el.type === 'password') return true;
    if (AUTO_SENSIVEL.test(el.getAttribute('autocomplete') || '')) return true;
    const rotulos = [
      el.name, el.id, el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), el.getAttribute('data-testid')
    ].filter(Boolean).join(' ');
    if (NOME_SENSIVEL.test(rotulos)) return true;
    return valorSensivel(valor);
  }

  document.addEventListener('change', (evento) => {
    const el = evento.composedPath()[0];
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (!['input', 'textarea', 'select'].includes(tag)) return;
    if (['button', 'submit', 'reset', 'file', 'hidden'].includes(el.type)) return;

    if (el.type === 'checkbox' || el.type === 'radio') {
      return registrar(el, el.checked ? 'Marcar' : 'Desmarcar', el.value || '');
    }
    const valor = tag === 'select'
      ? (el.selectedOptions?.[0]?.text || el.value)
      : el.value;
    // Senha nunca vai para a evidencia: o passo registra o campo, nao o segredo.
    const seguro = campoSensivel(el, valor) ? '' : valor;
    registrar(el, String(valor).trim() ? 'Preencher' : 'Limpar', seguro);
  }, true);

  /* Selecionar texto com o mouse e como o QA diz "li isto aqui": vira um passo
   * de leitura, com o trecho lido e o elemento de onde saiu. */
  const EDITAVEL = 'input, textarea, select, [contenteditable]';

  document.addEventListener('mouseup', (evento) => {
    const origem = evento.composedPath()[0];
    // Arrastar dentro de um campo e o comeco de digitar ou apagar, nao leitura.
    if (origem instanceof Element && origem.closest(EDITAVEL)) return;
    if (document.activeElement && document.activeElement.closest?.(EDITAVEL)) return;
    const sel = document.getSelection();
    const texto = String(sel || '').replace(/\s+/g, ' ').trim();
    if (texto.length < 2 || !sel.anchorNode) return;
    const el = sel.anchorNode.nodeType === Node.ELEMENT_NODE
      ? sel.anchorNode
      : sel.anchorNode.parentElement;
    if (!el || el.closest(EDITAVEL)) return;
    registrar(el, 'Capturar texto', texto);
  }, true);

  document.addEventListener('click', () => {
    chrome.runtime.sendMessage({ tipo: 'AUDI_ACAO_CONCLUIDA' }).catch(() => {});
  }, true);

  /* Realce so existe gravando: fora da sessao a extensao nao pinta nada na
   * pagina do usuario. */
  document.addEventListener('pointerover', (evento) => {
    if (!gravando || travado) return;
    const el = clicavel(evento.composedPath()[0]);
    if (el === alvoAtual) return;
    seguir(el);
    // Pousou num clicavel: pede o print de reserva, que vira o "antes" se o
    // clique vier. Sem isso o "antes" so e tirado depois do efeito do clique.
    if (el) chrome.runtime.sendMessage({ tipo: 'AUDI_PRE' }).catch(() => {});
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

  chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
    if (msg && msg.tipo === 'AUDI_TEXTO') { responder(resumoDaTela()); return true; }
    if (msg && msg.tipo === 'AUDI_SESSAO') ligarRealce(msg.ativa);
    // Passo novo chegando do background: repassa para a pagina do Print.
    if (msg && msg.tipo === 'AUDI_NOVO_PASSO' && window === window.top && paginaDoPrint()) {
      window.postMessage({ tipo: 'AUDI_PRINT_PASSO', passo: msg.passo, origem: msg.origem }, location.origin);
    }
  });

  /* Ponte para o Print puxar a gravacao sem exportar e importar arquivo.
   *
   * So nas origens do Print: as sessoes contem prints de outras abas, entao
   * qualquer site poder pedi-las seria vazamento. Se voce hospedar o Print em
   * outro endereco, acrescente-o aqui. */
  const ORIGENS_PRINT = ['https://audiprint.up.railway.app'];

  /* Local e a maquina do proprio usuario, entao qualquer porta serve.
   *
   * file: saiu daqui de proposito. Ele liberava QUALQUER html aberto do disco,
   * e um arquivo baixado por engano so precisava pedir AUDI_EVIDENCIAS para
   * receber os prints e o HTML de todas as abas gravadas. Para usar o Print
   * local, sirva por 127.0.0.1 (npm run servidor), nao por clique duplo. */
  function paginaDoPrint() {
    if (ORIGENS_PRINT.includes(location.origin)) return true;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
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
        const r = d.descartar
          ? await chrome.runtime.sendMessage({ tipo: 'AUDI_DESCARTAR' })
          : d.pararTudo
          ? await chrome.runtime.sendMessage({ tipo: 'AUDI_PARAR_TUDO' })
          : d.armar
          ? await chrome.runtime.sendMessage({ tipo: 'AUDI_ARMAR' })
          : d.marcar
          ? await chrome.runtime.sendMessage({ tipo: 'AUDI_IMPORTADA', deTab: d.deTab })
          : d.deTab == null
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
