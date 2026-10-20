/* Contraste de texto (WCAG AA) nas telas que o cliente ve.
 *
 *   node teste-contraste.js
 *
 * O Print vende nota de acessibilidade, e o retorno de uso apontou contraste
 * baixo. Medido, o problema era outro do que se suspeitava: texto verde sobre
 * branco (3,11:1) em todo botao de contorno, e texto BRANCO sobre o verde dos
 * botoes principais do cofre (2,24:1). O teste mede cada texto visivel contra o
 * fundo de verdade (camadas translucidas compostas, placeholder incluido) e
 * reprova abaixo de 4,5:1, ou 3:1 para texto grande.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const PORTA = 8999;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'contraste-')), 'cofre.db');
const delay = ms => new Promise(r => setTimeout(r, ms));
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

let falhas = 0, feitos = 0;
async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n').join('\n           ')); }
}

/* Roda dentro da pagina. Devolve o que esta abaixo do minimo, do pior para o melhor. */
function medir(raizSeletor) {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const taxa = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  /* Fundo sólido: compõe as camadas translúcidas. Fundo em degradê: devolve
   * grad=true, porque "a primeira cor do degradê" errava (tela dividida em
   * escuro e claro): esses textos vão para a amostragem de pixel, lá fora. */
  const fundoDe = el => {
    const camadas = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) return { grad: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { camadas.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = camadas.length - 1; i >= 0; i--) base = over(camadas[i], base);
    return { cor: base };
  };
  /* As marcas da medição anterior ficariam no DOM, e o número 0 da tela nova
   * apontaria para o texto 0 da tela velha: fotografava o elemento errado. */
  document.querySelectorAll('[data-medir-grad]').forEach(e => e.removeAttribute('data-medir-grad'));
  const achados = {};
  const gradiente = [];
  /* Com uma janela aberta, só ela conta: o que está atrás do fundo escurecido
   * não é lido, e medi-lo reprovaria a página por causa do véu da janela. */
  const raiz = (raizSeletor && document.querySelector(raizSeletor)) || document.body;
  for (const el of raiz.querySelectorAll('*')) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const cs = getComputedStyle(el);
    const proprio = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1).map(n => n.textContent.trim()).join(' ');
    const ph = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.placeholder && !el.value ? el.placeholder : '';
    if (!proprio && !ph) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    let fg = parse(cs.color); if (!fg) continue;
    const fb = fundoDe(el);
    if (fb.grad) {
      const px0 = parseFloat(cs.fontSize), neg0 = parseInt(cs.fontWeight) >= 700;
      const n = gradiente.length;
      el.setAttribute('data-medir-grad', n);
      gradiente.push({ n, fg, minimo: (px0 >= 24 || (px0 >= 18.66 && neg0)) ? 3 : 4.5, texto: (proprio || ph).slice(0, 30) });
      continue;
    }
    const bg0 = fb.cor;
    const bgProprio = parse(cs.backgroundColor);
    const bg = ph && bgProprio && bgProprio.a > 0 ? over(bgProprio, bg0) : bg0;
    if (ph) { const pc = getComputedStyle(el, '::placeholder'); fg = parse(pc.color) || fg; }
    fg = over(fg, bg);
    const t = taxa(fg, bg), px = parseFloat(cs.fontSize), neg = parseInt(cs.fontWeight) >= 700;
    const minimo = (px >= 24 || (px >= 18.66 && neg)) ? 3 : 4.5;
    if (t < minimo) {
      const rgb = c => 'rgb(' + [c.r, c.g, c.b].map(Math.round).join(',') + ')';
      const chave = rgb(fg) + '|' + rgb(bg) + '|' + px;
      const a = achados[chave] = achados[chave] || { taxa: +t.toFixed(2), minimo, texto: rgb(fg), fundo: rgb(bg), n: 0, exemplos: [] };
      a.n++; if (a.exemplos.length < 2) a.exemplos.push((proprio || ph).slice(0, 30));
    }
  }
  return { achados: Object.values(achados), gradiente };
}

/* Texto sobre degradê: esconde o texto, fotografa a caixa dele e mede contra a
 * cor média dos pixels que sobraram. É o fundo que o olho vê, não um palpite. */
const lumNode = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const taxaNode = (a, b) => { const l1 = lumNode(a), l2 = lumNode(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

async function medirTela(pg, raizSeletor) {
  /* Termina as animações de entrada: medir no meio de um fade mede o fundo
   * errado, e o resultado passaria a depender de quanto tempo se esperou. As
   * infinitas (pulsos) não terminam e são ignoradas. */
  await pg.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (_) { /* infinita */ } } });
  await delay(150);
  const { achados, gradiente } = await pg.evaluate(medir, raizSeletor || null);
  const lista = achados.slice();
  for (const g of gradiente) {
    /* A captura é do PRÓPRIO elemento: um recorte por coordenada errava quando a
     * janela (posição fixa) mudava de lugar ao rolar a página até o texto. */
    const alvo = await pg.$('[data-medir-grad="' + g.n + '"]');
    await pg.evaluate(n => {
      const el = document.querySelector('[data-medir-grad="' + n + '"]');
      el.dataset.corAntes = el.style.color || '';
      el.style.setProperty('color', 'transparent', 'important');
    }, g.n);
    let bg = null;
    try {
      const b64 = await alvo.screenshot({ encoding: 'base64' });
      bg = await pg.evaluate(async (dados) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + dados; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0; const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        return { r: r / n, g: gg / n, b: b / n };
      }, b64);
    } finally {
      await pg.evaluate(n => { const el = document.querySelector('[data-medir-grad="' + n + '"]'); el.style.removeProperty('color'); if (el.dataset.corAntes) el.style.color = el.dataset.corAntes; }, g.n);
    }
    if (!bg) continue;
    const fg = { r: g.fg.r * g.fg.a + bg.r * (1 - g.fg.a), g: g.fg.g * g.fg.a + bg.g * (1 - g.fg.a), b: g.fg.b * g.fg.a + bg.b * (1 - g.fg.a) };
    const t = taxaNode(fg, bg);
    if (t < g.minimo) {
      const rgb = c => 'rgb(' + [c.r, c.g, c.b].map(Math.round).join(',') + ')';
      lista.push({ taxa: +t.toFixed(2), minimo: g.minimo, texto: rgb(fg), fundo: rgb(bg) + ' (pixel)', n: 1, exemplos: [g.texto] });
    }
  }
  return lista.sort((a, b) => a.taxa - b.taxa);
}

const resumo = achados => achados.map(a => a.taxa + ':1 (minimo ' + a.minimo + ') ' + a.texto + ' sobre ' + a.fundo
  + ' em ' + a.n + ' texto(s), ex.: "' + a.exemplos.join('", "') + '"').join('\n');

(async () => {
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(ARQUIVO);
  const t = banco.criarTenant('Equipe de contraste', 90);
  banco.vincular(t.id, banco.criarUsuario('qa@contraste.com', contas.hashSenha('senha-bem-longa-9')).id, 'admin');
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO,
      COFRE_SEGREDO: 'segredo-contraste', AGENTE_API_KEY: '', PONTE_TOKEN: '' }),
    stdio: 'ignore'
  });
  let nav;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(BASE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o servidor nao subiu');
      await delay(250);
    }
    nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1280, height: 800 });
    /* Sem movimento: a camada de animação do Print respeita isso e mostra o estado final. */
    await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    const sem = async (nome, antes, raiz) => {
      if (antes) await antes();
      await delay(700);
      const a = await medirTela(pg, raiz);
      assert.strictEqual(a.length, 0, nome + ' tem texto abaixo do minimo:\n' + resumo(a));
    };

    console.log('\nPrint\n');

    await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await delay(800);
    /* Com movimento reduzido a abertura já vem encerrada: só clica se ela estiver na tela. */
    if (await pg.$eval('#entrarSite', el => el.offsetParent !== null).catch(() => false)) await pg.click('#entrarSite');
    await pg.waitForSelector('[data-acao="novoProjeto"]', { visible: true });

    await caso('tela inicial', () => sem('a tela inicial'));

    await caso('janela de novo projeto', () => sem('a janela de novo projeto', async () => {
      await pg.click('[data-acao="novoProjeto"]');
      await pg.waitForSelector('#campoNome', { visible: true });
    }, '#fundoModal .modal'));

    await caso('tela do projeto e tela da evidencia, com legenda dos prints', async () => {
      await pg.click('#btnCancelarModal').catch(() => {});
      await delay(400);
      await pg.evaluate(async (pixel) => {
        const input = document.getElementById('arqBackup');
        const backup = { formato: 'audi-print-backup', versao: 1, geradoEm: 1,
          projeto: { nome: 'Projeto de contraste', cliente: 'Cliente', logo: null, iaPermitida: false, pasta: null, criadoEm: 1 },
          registros: [{ projetoNome: 'Projeto de contraste', criadoEm: 2, video: null,
            ficha: { registro: 'EVD-1', resultado: 'Aprovado', modulo: 'Login' },
            passos: [{ titulo: 'Clicou em Entrar', acao: 'Clicar', elemento: '//button[@id="entrar"]', html: '<button id="entrar">Entrar</button>',
              imagens: [{ legenda: 'Antes', blob: pixel }, { legenda: 'Depois', blob: pixel }] }] }] };
        const dt = new DataTransfer();
        dt.items.add(new File([JSON.stringify(backup)], 'b.json', { type: 'application/json' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, PIXEL);
      await pg.waitForFunction(() => document.getElementById('fundoConfirma').classList.contains('aberto'), { timeout: 8000 });
      await pg.click('#btnSim');
      await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]', { visible: true });
      await sem('a tela inicial com projeto');
      await pg.click('#gradeProjetos .cartao[data-projeto]');
      await pg.waitForSelector('[data-abrir]', { visible: true });
      await sem('a tela do projeto');
      await pg.click('[data-abrir]');
      await pg.waitForSelector('#conteudoRegistro .passo', { visible: true });
      await sem('a tela da evidencia');
    });

    console.log('\ncofre\n');

    await pg.goto(BASE + '/cofre.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#email', { visible: true });
    /* A entrada faz uma animação de estreia: mede depois que ela acaba. */
    await caso('entrada do cofre, com os placeholders', async () => { await delay(1500); await sem('a entrada do cofre'); });

    await pg.type('#email', 'qa@contraste.com');
    await pg.type('#senha', 'senha-bem-longa-9');
    await pg.click('#btnEntrar');
    await pg.waitForSelector('#telaProjetos:not([hidden])', { visible: true });

    const tela = (botao, voltar) => async () => {
      await pg.click(botao);
      await delay(700);
      const a = await medirTela(pg);
      await pg.evaluate(v => { const b = [...document.querySelectorAll('main > section:not([hidden]) .btn')].find(x => /voltar/i.test(x.textContent)); if (b) b.click(); }, voltar);
      await delay(500);
      assert.strictEqual(a.length, 0, 'texto abaixo do minimo:\n' + resumo(a));
    };

    await caso('cofre: projetos', () => sem('a tela de projetos do cofre'));
    await caso('cofre: Jira e Zephyr', tela('#btnIntegracoes'));
    await caso('cofre: seguranca', tela('#btnSeguranca'));
    await caso('cofre: auditoria', tela('#btnAuditoria'));
    await caso('cofre: segmentos', tela('#btnNovaEquipe'));

    console.log('\npaginas publicas\n');

    for (const pagina of ['/inicio.html', '/seguranca.html', '/privacidade.html']) {
      await caso(pagina, async () => {
        await pg.goto(BASE + pagina, { waitUntil: 'domcontentloaded' });
        await sem(pagina);
      });
    }
  } finally {
    if (nav) await nav.close();
    proc.kill();
    await delay(300);
  }
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (' + feitos + ' casos)\n');
  process.exit(falhas ? 1 : 0);
})().catch(err => { console.error('\nERRO GERAL: ' + err.message + '\n' + err.stack); process.exit(1); });
