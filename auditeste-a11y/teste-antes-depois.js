/* O print "antes" mostra mesmo a tela ANTES do efeito da interação.
 *
 *   node teste-antes-depois.js
 *
 * A página muda de cor de forma síncrona no pointerdown, então um "antes"
 * tirado tarde sai colorido e o par fica trocado. Era o que acontecia: o
 * "antes" só era pedido depois do clique, e até a mensagem chegar ao service
 * worker o Chrome já tinha repintado. Agora existe um print de reserva, tirado
 * quando o mouse pousa no elemento.
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA = 8962;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sonda</title></head>
<body id="corpo" style="margin:0;background:#ffffff;font-family:system-ui;padding:40px">
  <h1 id="tit">Estado A</h1>
  <button id="b1" style="padding:20px 40px;font-size:20px">Passo um</button>
  <button id="b2" style="padding:20px 40px;font-size:20px">Passo dois</button>
  <script>
    b1.addEventListener('pointerdown', () => { corpo.style.background = '#ff0000'; tit.textContent = 'Estado B'; });
    b2.addEventListener('pointerdown', () => { corpo.style.background = '#0000ff'; tit.textContent = 'Estado C'; });
  </script>
</body></html>`;

const nome = ([r, g, b]) => (r > 200 && g > 200 && b > 200 ? 'BRANCO'
  : r > 150 && g < 100 && b < 100 ? 'VERMELHO'
  : b > 150 && r < 100 ? 'AZUL' : `rgb(${r},${g},${b})`);

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA, '127.0.0.1');

  const nav = await puppeteer.launch({
    headless: false, executablePath: caminhoChrome(), defaultViewport: null,
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1100,760']
  });

  try {
    let sw = null;
    for (let i = 0; i < 60 && !sw; i++) {
      sw = nav.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'o complemento não carregou');
    const idExt = new URL(sw.url()).host;

    const aba = await nav.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });

    const pop = await nav.newPage();
    await pop.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    await pop.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id });
    });
    await pop.close();
    await aba.bringToFront();

    // Ritmo de gente: pousa o mouse, clica, olha o resultado, vai para o proximo.
    const clicar = async (sel) => { await aba.hover(sel); await esperar(600); await aba.click(sel); };
    await clicar('#b1');
    await esperar(1500);
    await clicar('#b2');
    await esperar(6000);

    const inspetor = await nav.newPage();
    await inspetor.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    const passos = await inspetor.evaluate(async () => {
      const s = (await chrome.storage.local.get('sessoesAudiPrint')).sessoesAudiPrint || {};
      const sessao = Object.values(s).find((x) => (x.passos || []).length);
      if (!sessao) return null;
      const ler = (dataUrl) => new Promise((ok) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(30, img.height - 30, 1, 1).data;   // fundo puro
          ok([d[0], d[1], d[2]]);
        };
        img.onerror = () => ok([0, 0, 0]);
        img.src = dataUrl;
      });
      const fora = [];
      for (const p of sessao.passos) {
        fora.push({ titulo: p.titulo, antes: await ler(p.imagens[0].dataUrl), depois: await ler(p.imagens[1].dataUrl) });
      }
      return fora;
    });

    assert.ok(passos && passos.length === 2, 'esperava 2 passos, veio ' + (passos ? passos.length : 0));

    const esperado = [
      { antes: 'BRANCO', depois: 'VERMELHO' },
      { antes: 'VERMELHO', depois: 'AZUL' }
    ];
    passos.forEach((p, i) => {
      const a = nome(p.antes);
      const d = nome(p.depois);
      console.log('  passo ' + (i + 1) + ': ' + p.titulo + '  antes=' + a + '  depois=' + d);
      assert.strictEqual(a, esperado[i].antes,
        'o print "antes" do passo ' + (i + 1) + ' saiu ' + a + ', ou seja, já com o efeito da interação');
      assert.strictEqual(d, esperado[i].depois,
        'o print "depois" do passo ' + (i + 1) + ' saiu ' + d);
    });
    console.log('\n  OK   antes e depois na ordem certa nos 2 passos');
    console.log('\nRESULTADO: PASSOU');
  } finally {
    await nav.close().catch(() => {});
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
