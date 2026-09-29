/* Animacoes (GSAP) e ajustes de tela pequena.
 *
 *   node teste-animacoes.js
 *
 * O que nao pode quebrar: conteudo escondido que nunca aparece. Passo que
 * espera a rolagem tem de aparecer ao chegar nele, sair inteiro na impressao,
 * e nada disso pode acontecer para quem pediu "reduzir movimento".
 */
const puppeteer = require('puppeteer');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORTA = 8997;
const BASE = 'http://127.0.0.1:' + PORTA;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';
const delay = ms => new Promise(r => setTimeout(r, ms));

const PASSOS = Array.from({ length: 14 }, (_, i) => ({
  titulo: 'Clicou no item ' + (i + 1), obs: '', acao: 'Clicar',
  elemento: '//*[@id="item-' + i + '"]', rotulo: 'Item ' + (i + 1), html: '',
  urlAntes: 'https://exemplo.test/a', urlDepois: 'https://exemplo.test/b',
  imagens: [{ dataUrl: PIXEL, legenda: 'Antes' }, { dataUrl: PIXEL, legenda: 'Depois' }]
}));
const EVID = { formato: 'audi-print-evidencia-v1', url: 'https://exemplo.test/a', titulo: 'Exemplo', passos: PASSOS };

let falhas = 0;
async function caso(nome, fn) {
  try { await fn(); console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}

async function novaPagina(nav, largura, reduzir) {
  const pg = await nav.newPage();
  await pg.setViewport({ width: largura, height: 800 });
  if (reduzir) await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const erros = [];
  pg.on('pageerror', e => erros.push(e.message));
  pg.on('dialog', d => d.accept('1'));
  await pg.evaluateOnNewDocument((evid) => {
    addEventListener('message', (ev) => {
      const d = ev.data;
      if (ev.source !== window || !d || d.tipo !== 'AUDI_PRINT_PEDE') return;
      const corpo = d.deTab == null
        ? { evidencias: [{ tabId: 7, url: evid.url, titulo: evid.titulo, inicio: new Date().toISOString(),
            ativa: false, encerrada: new Date().toISOString(), importada: false, passos: evid.passos.length }] }
        : { evidencia: Object.assign({}, evid, { passos: evid.passos.map((p, i) => Object.assign({}, p, {
            id: 'p' + i + '-' + Date.now() + Math.random(), timestampDepois: new Date().toISOString() })) }) };
      postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
    });
  }, EVID);
  pg.erros = erros;
  return pg;
}

async function ateGravador(pg, nome) {
  await pg.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  /* Com "reduzir movimento" o Print ja pula a abertura sozinho. */
  if (await pg.$eval('#abertura', a => !a.classList.contains('encerrada'))) await pg.click('#entrarSite');
  await pg.waitForSelector('#telaProjetos.ativa');
  await pg.click('[data-acao="novoProjeto"]');
  await pg.waitForSelector('#campoNome', { visible: true });
  await pg.type('#campoNome', nome);
  await pg.click('#btnConfirmarModal');
  await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]');
  await delay(400);
}

(async () => {
  const banco = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anim-')), 'c.db');
  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: banco,
      COFRE_SEGREDO: 'anim', AGENTE_API_KEY: '', PONTE_TOKEN: '' }), stdio: 'ignore' });
  let nav;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(BASE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o servidor nao subiu');
      await delay(250);
    }
    nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    console.log('\nanimacoes\n');

    const pg = await novaPagina(nav, 1280, false);

    await caso('a camada liga com o GSAP local', async () => {
      await pg.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
      const r = await pg.evaluate(() => ({ v: window.gsap && gsap.version, st: !!window.ScrollTrigger,
        classe: document.documentElement.classList.contains('com-gsap') }));
      assert.ok(r.v, 'gsap nao carregou');
      assert.ok(r.st, 'ScrollTrigger nao carregou');
      assert.ok(r.classe, 'a camada nao ligou');
    });

    await caso('trocar de tela anima os blocos e termina limpo', async () => {
      await ateGravador(pg, 'Animacao');
      await pg.click('#gradeProjetos .cartao[data-projeto]');
      await delay(60);
      const durante = await pg.$eval('#telaProjeto', t => {
        const b = Array.from(t.children).find(el => el.offsetParent !== null);
        return Number(getComputedStyle(b).opacity);
      });
      assert.ok(durante < 1, 'o primeiro bloco ja estava inteiro: nao animou (' + durante + ')');
      await delay(1300);
      const sobra = await pg.$$eval('#telaProjeto > *', els => els.filter(e => e.style.opacity || e.style.transform).length);
      assert.strictEqual(sobra, 0, 'a animacao deixou estilo para tras');
    });

    await caso('CRITERIO: passo fora da tela espera a rolagem e aparece ao chegar', async () => {
      await pg.click('[data-acao="novaGravacao"]');
      await pg.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
      await pg.click('[data-acao="puxarExtensao"]');
      await pg.waitForFunction(() => document.querySelectorAll('#telaGravador .passo').length >= 14, { timeout: 15000 });
      await delay(900);
      const antes = await pg.$eval('#telaGravador .passo:last-of-type', el => Number(getComputedStyle(el).opacity));
      assert.ok(antes < 1, 'o ultimo passo ja estava visivel antes de rolar (' + antes + ')');
      globalThis.__opacidadeAntes = antes;
    });

    await caso('CRITERIO: na impressao todos os passos saem inteiros', async () => {
      await pg.emulateMediaType('print');
      const apagados = await pg.$$eval('#telaGravador .passo', els => els.filter(e => getComputedStyle(e).opacity !== '1').length);
      await pg.emulateMediaType('screen');
      assert.strictEqual(apagados, 0, apagados + ' passo(s) sairiam apagados no papel');
    });

    await caso('...e rolar ate o passo o faz aparecer', async () => {
      await pg.$eval('#telaGravador .passo:last-of-type', el => el.scrollIntoView({ block: 'center' }));
      await delay(1200);
      const depois = await pg.$eval('#telaGravador .passo:last-of-type', el => Number(getComputedStyle(el).opacity));
      assert.strictEqual(depois, 1, 'rolou ate o passo e ele continuou apagado (' + depois + ')');
    });

    await caso('passo novo na gravacao ganha o brilho verde', async () => {
      await pg.evaluate(() => scrollTo(0, 0));
      await pg.click('[data-acao="puxarExtensao"]');
      const brilhou = await pg.waitForFunction(() => Array.from(document.querySelectorAll('#telaGravador .passo'))
        .some(p => /118, 192, 67/.test(p.style.boxShadow)), { timeout: 8000 }).then(() => true, () => false);
      assert.ok(brilhou, 'nenhum passo novo brilhou');
    });

    await caso('barra de leitura liga em pagina longa', async () => {
      await delay(400);
      const ligada = await pg.$eval('.barra-leitura', b => b.classList.contains('ligada'));
      assert.ok(ligada, 'pagina com 28 passos e a barra desligada');
    });

    await caso('nenhum erro de script', async () => {
      assert.deepStrictEqual(pg.erros, []);
    });
    await pg.close();

    console.log('\nreduzir movimento\n');
    const calmo = await novaPagina(nav, 1280, true);
    await caso('CRITERIO: com "reduzir movimento", nada anima', async () => {
      await ateGravador(calmo, 'Calmo');
      const classe = await calmo.evaluate(() => document.documentElement.classList.contains('com-gsap'));
      assert.strictEqual(classe, false, 'a camada ligou mesmo com reduzir movimento');
      await calmo.click('#gradeProjetos .cartao[data-projeto]');
      await delay(60);
      const inline = await calmo.$$eval('#telaProjeto > *', els => els.filter(e => e.style.opacity).length);
      assert.strictEqual(inline, 0, 'animou mesmo com reduzir movimento');
    });
    await calmo.close();

    console.log('\ntela de celular (390px)\n');
    const cel = await novaPagina(nav, 390, false);
    const vaza = () => cel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await caso('nada vaza para os lados: projetos, projeto e gravacao', async () => {
      await ateGravador(cel, 'Celular');
      assert.ok(await vaza() <= 0, 'projetos vaza ' + await vaza() + 'px');
      await cel.click('#gradeProjetos .cartao[data-projeto]');
      await delay(700);
      assert.ok(await vaza() <= 0, 'projeto vaza ' + await vaza() + 'px');
      await cel.click('[data-acao="novaGravacao"]');
      await cel.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
      await cel.click('[data-acao="puxarExtensao"]');
      await cel.waitForFunction(() => document.querySelectorAll('#telaGravador .passo').length >= 14, { timeout: 15000 });
      await delay(700);
      assert.ok(await vaza() <= 0, 'gravacao vaza ' + await vaza() + 'px');
    });

    await caso('aviso ocupa a largura e fica acima da barra de botoes', async () => {
      await cel.waitForSelector('.aviso-toast.visivel', { timeout: 8000 });
      await delay(450);
      const m = await cel.evaluate(() => {
        const t = document.querySelector('.aviso-toast').getBoundingClientRect();
        const r = document.querySelector('#telaGravador .rodape-fixo').getBoundingClientRect();
        return { largura: t.width, baseAviso: t.bottom, topoBarra: r.top, barraNaTela: r.top < innerHeight };
      });
      assert.ok(m.largura >= 390 - 30, 'aviso estreito: ' + m.largura + 'px');
      if (m.barraNaTela) assert.ok(m.baseAviso <= m.topoBarra + 2, 'o aviso cobre a barra: ' + JSON.stringify(m));
    });
    await cel.close();
  } catch (e) {
    falhas++;
    console.error('FALHOU:', e.message);
  } finally {
    if (nav) await nav.close().catch(() => {});
    proc.kill();
  }
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (11 casos)\n');
  process.exit(falhas ? 1 : 0);
})();
