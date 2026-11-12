/* Clicar em "Iniciar gravação" no Print liga a gravação de xpath, id e HTML na
 * aba do sistema testado, pelo caminho de verdade (armar), não pelo popup.
 *
 *   node teste-iniciar-gravacao-arma.js
 *
 * O Print não pode gravar a si mesmo, então ao iniciar ele ARMA o complemento,
 * e a sessão começa na primeira aba de sistema que a pessoa abrir. Até
 * 11/11/2026 nenhum teste passava por esse caminho (todos iniciavam pelo
 * popup), e ele falhava calado em dois casos reais:
 *
 *   1. Sistema testado rodando em localhost ou 127.0.0.1: qualquer endereço
 *      local era tratado como "é o Print", e a sessão nunca começava ali.
 *   2. O "armado" morava só na memória do service worker, que o Chrome
 *      encerra depois de uns 30 s parado. Quem iniciava, preenchia a ficha e
 *      só então ia para o sistema encontrava o complemento desarmado.
 *
 * Nos dois a evidência saía só com o print da tela, sem id e sem HTML.
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const P_PRINT = 8967, P_SISTEMA = 8968;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const pagina = (titulo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1 id="tit">${titulo}</h1>
  <button id="salvar" type="button" style="padding:14px 28px">Salvar pedido</button>
  <script>salvar.addEventListener('click', () => { tit.textContent = 'Pedido salvo'; });</script>
</body></html>`;
const servir = (porta, titulo) => http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pagina(titulo));
}).listen(porta, '127.0.0.1');

let falhas = 0, feitos = 0;
async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n').join('\n           ')); }
}

(async () => {
  const s1 = servir(P_PRINT, 'Print (substituto)');
  const s2 = servir(P_SISTEMA, 'Sistema testado');

  /* sistema.exemplo aponta para esta máquina: é o "site do cliente", com um
   * endereço que não é local aos olhos do complemento. */
  const nav = await puppeteer.launch({
    headless: false, executablePath: caminhoChrome(), defaultViewport: null,
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1100,760',
      '--host-resolver-rules=MAP sistema.exemplo 127.0.0.1']
  });

  try {
    const alvoSw = async () => {
      for (let i = 0; i < 60; i++) {
        const t = nav.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'));
        if (t) return t;
        await esperar(250);
      }
      return null;
    };
    const sw = await alvoSw();
    assert.ok(sw, 'o complemento não carregou');
    const idExt = new URL(sw.url()).host;

    const print = await nav.newPage();
    await print.goto(`http://127.0.0.1:${P_PRINT}/`, { waitUntil: 'load' });

    const noPopup = async (fn, ...args) => {
      const pop = await nav.newPage();
      await pop.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
      try { return await pop.evaluate(fn, ...args); } finally { await pop.close().catch(() => {}); }
    };
    const sessoes = () => noPopup(async () => {
      const s = (await chrome.storage.local.get('sessoesAudiPrint')).sessoesAudiPrint || {};
      return Object.values(s).filter(Boolean).map((x) => ({ ativa: !!x.ativa, url: x.url,
        passos: (x.passos || []).map((p) => ({ id: p.elementoId, xpath: p.elemento, html: p.html })) }));
    });
    /* O que o Print faz ao clicar em Iniciar gravação / Parar. */
    const pedir = (corpo) => print.evaluate((c) => new Promise((ok) => {
      const pedido = 'p' + Math.random().toString(36).slice(2);
      const fim = setTimeout(() => ok(null), 4000);
      window.addEventListener('message', function ouvir(ev) {
        const d = ev.data;
        if (!d || d.tipo !== 'AUDI_PRINT_RESPONDE' || d.pedido !== pedido) return;
        clearTimeout(fim); window.removeEventListener('message', ouvir); ok(d);
      });
      window.postMessage(Object.assign({ tipo: 'AUDI_PRINT_PEDE', pedido }, c), location.origin);
    }), corpo);
    const zerar = async () => {
      await print.bringToFront();
      await pedir({ pararTudo: true });
      await noPopup(async () => { await chrome.storage.local.remove('sessoesAudiPrint'); });
      await print.bringToFront();
      await esperar(300);
    };
    const testarNo = async (aba) => {
      await aba.bringToFront();        // a pessoa vai para a aba do sistema
      await esperar(1500);
      await aba.hover('#salvar');
      await esperar(400);
      await aba.click('#salvar');
      await esperar(3000);
      const s = (await sessoes()).filter((x) => x.passos.length);
      return s.length ? s[0].passos : [];
    };
    const comIdEHtml = (passos, onde) => {
      assert.strictEqual(passos.length, 1, onde + ': esperava 1 passo com id e HTML, veio ' + passos.length
        + ' (a gravação não começou na aba do sistema)');
      assert.strictEqual(passos[0].id, 'salvar', onde + ': o passo veio sem o id');
      assert.ok(/<button/.test(passos[0].html), onde + ': o passo veio sem o HTML');
    };

    console.log('\nIniciar gravação no Print liga o complemento na aba do sistema\n');

    await caso('sistema num endereço de cliente: iniciou no Print, foi para a aba, o clique vira passo', async () => {
      const aba = await nav.newPage();
      await aba.goto(`http://sistema.exemplo:${P_SISTEMA}/`, { waitUntil: 'load' });
      await zerar();
      const r = await pedir({ armar: true, capturarPrints: false });
      assert.ok(r && !r.erro, 'o complemento não respondeu ao armar');
      comIdEHtml(await testarNo(aba), 'endereço de cliente');
      await aba.close();
    });

    await caso('demorou mais de 30 s entre iniciar e ir para o sistema (o Chrome encerra o complemento parado)', async () => {
      const aba = await nav.newPage();
      await aba.goto(`http://sistema.exemplo:${P_SISTEMA}/`, { waitUntil: 'load' });
      await zerar();
      const r = await pedir({ armar: true, capturarPrints: false });
      assert.ok(r && !r.erro, 'o complemento não respondeu ao armar');
      /* Encerrar o service worker aqui é o que o Chrome faz sozinho depois de
       * uns 30 s sem evento: a memória dele some, e ele acorda do zero. */
      const t = await alvoSw();
      const w = await t.worker();
      await w.close();
      await esperar(1200);
      comIdEHtml(await testarNo(aba), 'depois de o complemento dormir');
      await aba.close();
    });

    await caso('sistema rodando nesta máquina (127.0.0.1 em outra porta): também grava', async () => {
      const aba = await nav.newPage();
      await aba.goto(`http://127.0.0.1:${P_SISTEMA}/`, { waitUntil: 'load' });
      await zerar();
      const r = await pedir({ armar: true, capturarPrints: false });
      assert.ok(r && !r.erro, 'o complemento não respondeu ao armar');
      comIdEHtml(await testarNo(aba), 'sistema local');
      await aba.close();
    });

    await caso('a aba do Print nunca vira a sessão, nem outra página do mesmo endereço', async () => {
      const outra = await nav.newPage();
      await outra.goto(`http://127.0.0.1:${P_PRINT}/cofre.html`, { waitUntil: 'load' });
      await zerar();
      await pedir({ armar: true, capturarPrints: false });
      const p1 = await testarNo(outra);
      const p2 = await testarNo(print);
      assert.strictEqual(p1.length + p2.length, 0, 'o complemento gravou dentro do próprio Print');
      await outra.close();
    });
  } finally {
    await nav.close().catch(() => {});
    s1.close(); s2.close();
  }
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (' + feitos + ' casos)\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
