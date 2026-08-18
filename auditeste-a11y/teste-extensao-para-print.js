/* Integracao: captura as interacoes por codigo e traz para o Print.
 *
 *   node teste-extensao-para-print.js
 *
 * Sobe uma ponte local, carrega a extensao num Chrome de verdade e faz as
 * quatro interacoes que o QA registra: clicar, preencher, limpar e ler um
 * trecho. Cobra xpath em todas: seletor CSS aqui e regressao.
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA_PONTE = 8931;
const PORTA_SITE = 8932;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>Loja de teste</h1>
  <button id="entrarSite" style="padding:14px 28px;font-size:16px">Entrar</button>
  <label>Cupom <input name="cupom" style="padding:8px;font-size:15px"></label>
  <p id="aviso">Frete calculado para o CEP 04538-133.</p>
  <div id="painel" hidden><h2>Bem-vindo ao Painel</h2></div>
  <script>
    document.getElementById('entrarSite').addEventListener('click', () => {
      document.getElementById('painel').hidden = false;
      document.title = 'Painel';
    });
  </script>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA_PONTE), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(3500);

  const nav = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`
    ]
  });

  const encerrar = async () => {
    await nav.close().catch(() => {});
    ponte.kill();
    site.close();
  };

  try {
    // O id da extensao sai do alvo do service worker.
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = nav.targets().find((t) => t.type() === 'service_worker'
        && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'a extensão não carregou (service worker não apareceu)');
    const idExt = new URL(sw.url()).host;
    console.log('extensão carregada: ' + idExt);

    // 1) Abre o site e liga a sessão pela própria extensão.
    const aba = await nav.newPage();
    await aba.bringToFront();
    await aba.goto(`http://127.0.0.1:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' });

    const popup = await nav.newPage();
    await popup.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
    const tabId = await popup.evaluate(async () => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:*/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id });
      return a.id;
    });
    await popup.close();
    console.log('sessão iniciada na aba ' + tabId);

    // 2) As quatro interacoes, com folga entre elas: o passo so fecha depois
    // que o print "depois" sai.
    await aba.bringToFront();
    await aba.click('#entrarSite');
    await esperar(3000);

    await aba.type('[name="cupom"]', 'PROMO10');
    await aba.click('h1');            // sai do campo: e o blur que dispara o change
    await esperar(3000);

    await aba.click('[name="cupom"]', { clickCount: 3 });
    await aba.keyboard.press('Backspace');
    await aba.click('h1');
    await esperar(3000);

    await aba.evaluate(() => {
      const alvo = document.getElementById('aviso');
      const r = document.createRange();
      r.selectNodeContents(alvo);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      alvo.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await esperar(3000);

    // 3) Abre o Print servido pela ponte local e puxa da extensão.
    const print = await nav.newPage();
    await print.bringToFront();
    await print.goto(`http://127.0.0.1:${PORTA_PONTE}/`, { waitUntil: 'networkidle0' });
    await esperar(1200);

    const apareceu = await print.evaluate(() => {
      const b = document.getElementById('btnPuxarExtensao');
      return !!b && !b.hidden;
    });
    assert.ok(apareceu, 'o botão de trazer a captura não apareceu');
    console.log('botão apareceu (extensão detectada pela página)');

    const r = await print.evaluate(async () => {
      const pedir = (deTab) => new Promise((ok) => {
        const pedido = 'x' + Math.random();
        const fim = setTimeout(() => ok(null), 20000);
        function ouvir(ev){
          if(ev.source !== window) return;
          const d = ev.data;
          if(!d || d.tipo !== 'AUDI_PRINT_RESPONDE' || d.pedido !== pedido) return;
          clearTimeout(fim); window.removeEventListener('message', ouvir); ok(d);
        }
        window.addEventListener('message', ouvir);
        window.postMessage({ tipo: 'AUDI_PRINT_PEDE', pedido, deTab }, location.origin);
      });
      const lista = await pedir(null);
      if (!lista || !lista.evidencias || !lista.evidencias.length) return { lista };
      const cheia = await pedir(lista.evidencias[0].tabId);
      const passos = (cheia.evidencia && cheia.evidencia.passos) || [];
      return {
        quantas: lista.evidencias.length,
        formato: cheia.evidencia.formato,
        passos: passos.map(p => ({
          acao: p.acao, elemento: p.elemento, valor: p.valor,
          titulo: p.titulo, html: (p.html || '').slice(0, 30),
          imagens: (p.imagens || []).length
        }))
      };
    });

    console.log(JSON.stringify(r, null, 2));
    assert.ok(r.quantas >= 1, 'a extensão não devolveu captura nenhuma');
    assert.strictEqual(r.formato, 'audi-print-evidencia-v1', 'formato diferente do importador');

    const acao = (nome) => r.passos.find((p) => p.acao === nome);
    for (const nome of ['Clicar', 'Preencher', 'Limpar', 'Capturar texto']) {
      assert.ok(acao(nome), 'não registrou a interação ' + nome
        + ' (veio: ' + r.passos.map((p) => p.acao).join(', ') + ')');
    }
    for (const p of r.passos) {
      assert.ok(p.elemento.startsWith('/'), 'seletor não é xpath: ' + p.elemento);
      assert.strictEqual(p.imagens, 2, 'não vieram os dois prints em ' + p.acao);
    }
    assert.match(acao('Clicar').elemento, /@id="entrarSite"/, 'xpath do clique: ' + acao('Clicar').elemento);
    assert.match(acao('Clicar').html, /<button id="entrarSite"/, 'HTML do elemento não veio');
    assert.strictEqual(acao('Preencher').valor, 'PROMO10', 'valor digitado não veio');
    assert.strictEqual(acao('Limpar').valor, '', 'limpar deveria vir sem valor');
    assert.match(acao('Capturar texto').valor, /04538-133/, 'texto lido não veio');


    console.log('\nRESULTADO: PASSOU');
    await encerrar();
  } catch (e) {
    await encerrar();
    throw e;
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
