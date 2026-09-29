/* Animacoes do Print, com GSAP (copia local em vendor/: nada vem de fora,
 * como o resto da pagina).
 *
 * So aparencia. Este arquivo nao chama nenhuma funcao do Print: observa a
 * pagina e anima o que aparece. Sem a biblioteca, ou com "reduzir movimento"
 * ligado no sistema, a tela fica exatamente como era.
 *
 * O que ja tinha animacao propria fica de fora de proposito: a abertura, os
 * cartoes de projeto (entrada, filtro e destaque do novo), os numeros do
 * painel, os modais e o aviso flutuante. Animar de novo so brigaria com eles.
 *
 * Regras: anima so transform, opacity e sombra; e nunca deixa conteudo
 * escondido se a animacao nao chegar a rodar (impressao, PDF). O CSS de
 * impressao garante isso com .com-gsap.
 */
(function () {
  'use strict';
  var gsap = window.gsap;
  if (!gsap) return;
  var ST = window.ScrollTrigger;
  if (ST) gsap.registerPlugin(ST);

  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', function () {
    var raiz = document.documentElement;
    raiz.classList.add('com-gsap');
    var desligar = [];

    /* ---------- troca de tela ----------
     * Antes a tela inteira surgia de uma vez. Agora os blocos entram em
     * sequencia, de cima para baixo. A grade de projetos fica de fora: os
     * cartoes dela ja entram sozinhos. */
    var entrouEm = {};
    function entrarTela(tela) {
      entrouEm[tela.id] = Date.now();
      var blocos = Array.prototype.filter.call(tela.children, function (el) {
        return el.offsetParent !== null && el.id !== 'gradeProjetos'
          && !el.classList.contains('rodape-fixo');
      }).slice(0, 9);
      gsap.fromTo(blocos, { y: 16, opacity: 0, transition: 'none' }, {
        y: 0, opacity: 1, duration: .45, ease: 'power3.out', stagger: .055,
        clearProps: 'transform,opacity,transition'
      });
      atualizarLeitura();
    }
    var obsTela = new MutationObserver(function (mud) {
      mud.forEach(function (m) {
        var t = m.target;
        var ficou = t.classList.contains('ativa');
        var estava = (m.oldValue || '').split(/\s+/).indexOf('ativa') >= 0;
        if (ficou && !estava) entrarTela(t);
      });
    });
    document.querySelectorAll('.tela').forEach(function (t) {
      obsTela.observe(t, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
    desligar.push(function () { obsTela.disconnect(); });

    /* A primeira tela ja nasce ativa, atras da abertura. Ela entra quando a
     * abertura comeca a sair, acompanhando o zoom. */
    var abertura = document.getElementById('abertura');
    if (abertura) {
      var obsAbertura = new MutationObserver(function () {
        if (!abertura.classList.contains('saindo')) return;
        obsAbertura.disconnect();
        var ativa = document.querySelector('.tela.ativa');
        if (ativa) gsap.delayedCall(.25, function () { entrarTela(ativa); });
      });
      obsAbertura.observe(abertura, { attributes: true, attributeFilter: ['class'] });
      desligar.push(function () { obsAbertura.disconnect(); });
    }

    /* ---------- itens de lista: evidencias e passos ----------
     * Animam ao chegar na tela (logo depois de trocar de tela) ou quando sao
     * novos de verdade, como o passo que acabou de ser gravado. Re-desenho da
     * mesma lista (apagar um passo, renomear) nao reanima nada: seria piscar
     * a tela inteira a cada clique. */
    var ITENS = '.registro, .passo';
    var vistos = {};
    function chave(el) {
      var d = el.dataset, id = d.registro || d.abrir || '';
      if (!id) { var abrir = el.querySelector('[data-abrir]'); if (abrir) id = abrir.dataset.abrir; }
      if (!id && el.classList.contains('passo')) {
        var n = el.querySelector('.num');
        id = n ? n.textContent : '';
      }
      return el.classList[0] + ':' + id;
    }
    function telaDe(el) { var t = el.closest('.tela'); return t ? t.id : ''; }

    var fila = [], agendado = false;
    function enfileirar(el) {
      fila.push(el);
      if (!agendado) { agendado = true; requestAnimationFrame(despejar); }
    }
    function despejar() {
      agendado = false;
      var lote = fila.splice(0).filter(function (el) { return el.isConnected; });
      if (!lote.length) return;

      var altura = window.innerHeight, agora = Date.now();
      var visiveis = [], abaixo = [], novosNaGravacao = [];
      lote.forEach(function (el) {
        var tela = telaDe(el);
        var conj = vistos[tela] || (vistos[tela] = {});
        var k = chave(el), jaVisto = conj[k];
        conj[k] = true;
        var recemChegou = agora - (entrouEm[tela] || 0) < 900;
        if (jaVisto && !recemChegou) return;
        if (jaVisto === undefined && tela === 'telaGravador' && !recemChegou) novosNaGravacao.push(el);
        (el.getBoundingClientRect().top < altura ? visiveis : abaixo).push(el);
      });

      if (visiveis.length) {
        gsap.fromTo(visiveis, { y: 22, opacity: 0, transition: 'none' }, {
          y: 0, opacity: 1, duration: .5, ease: 'power3.out',
          stagger: Math.min(.07, .6 / visiveis.length), clearProps: 'transform,opacity,transition'
        });
      }
      /* Os de baixo esperam a rolagem chegar neles. */
      if (abaixo.length) {
        if (ST) {
          gsap.set(abaixo, { y: 34, opacity: 0, transition: 'none' });
          ST.batch(abaixo, {
            start: 'top 94%', once: true,
            onEnter: function (grupo) {
              gsap.to(grupo, {
                y: 0, opacity: 1, duration: .55, ease: 'power3.out', stagger: .08,
                clearProps: 'transform,opacity,transition'
              });
            }
          });
        }
      }
      /* Passo recem-gravado ganha um brilho verde que some devagar: da para
       * ver de relance que a captura entrou. */
      novosNaGravacao.forEach(function (el) {
        gsap.fromTo(el, { boxShadow: '0 0 0 3px rgba(118,192,67,.75), 0 10px 26px rgba(118,192,67,.25)', transition: 'none' }, {
          boxShadow: '0 0 0 0px rgba(118,192,67,0), 0 2px 10px rgba(13,52,70,.07)',
          duration: 1.4, ease: 'power2.out', clearProps: 'boxShadow,transition'
        });
      });
      atualizarLeitura();
    }
    var obsLista = new MutationObserver(function (mud) {
      mud.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches(ITENS)) enfileirar(n);
          else if (n.querySelectorAll) n.querySelectorAll(ITENS).forEach(enfileirar);
        });
      });
    });
    obsLista.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    desligar.push(function () { obsLista.disconnect(); });

    /* ---------- barra de leitura ----------
     * Numa evidencia de 30 passos, a barra verde no topo diz quanto falta. So
     * aparece quando a pagina e bem mais alta que a janela. */
    var barra = document.createElement('div');
    barra.className = 'barra-leitura';
    barra.setAttribute('aria-hidden', 'true');
    document.body.appendChild(barra);
    desligar.push(function () { barra.remove(); });
    var leitura = null, esperaLeitura = 0;
    function atualizarLeitura() {
      if (!ST) return;
      clearTimeout(esperaLeitura);
      esperaLeitura = setTimeout(function () {
        var longa = document.documentElement.scrollHeight > window.innerHeight * 1.6;
        barra.classList.toggle('ligada', longa);
        if (!leitura) {
          leitura = gsap.fromTo(barra, { scaleX: 0 }, {
            scaleX: 1, ease: 'none',
            scrollTrigger: { start: 0, end: 'max', scrub: .25 }
          });
        }
        ST.refresh();
      }, 120);
    }

    /* ---------- banner inicial ----------
     * Ao rolar, o texto do banner sobe um pouco mais devagar que a pagina, e o
     * radar verde vai no sentido oposto. Discreto: quem nao repara, nao perde. */
    var banner = document.querySelector('.painel-inicio');
    if (banner && ST) {
      var texto = banner.firstElementChild, radar = banner.querySelector('.pulso');
      var tl = gsap.timeline({
        scrollTrigger: { trigger: banner, start: 'top top+=70', end: 'bottom top', scrub: .4 }
      });
      if (texto) tl.to(texto, { y: 26, opacity: .55, ease: 'none' }, 0);
      if (radar) tl.to(radar, { y: -18, scale: .92, ease: 'none' }, 0);
      desligar.push(function () { tl.scrollTrigger && tl.scrollTrigger.kill(); tl.kill(); });
    }

    atualizarLeitura();
    window.addEventListener('resize', atualizarLeitura);
    desligar.push(function () { window.removeEventListener('resize', atualizarLeitura); });

    return function () {
      desligar.forEach(function (f) { f(); });
      raiz.classList.remove('com-gsap');
    };
  });
})();
