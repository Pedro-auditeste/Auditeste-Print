/* Ponta a ponta: abre o Print, abre o site pela ponte, clica NA IMAGEM e
 * confere que o passo chegou com id, HTML e os dois prints.
 *
 *   node teste-clicar-na-tela.js
 *
 * É a jornada do cliente: tudo pelo Print, sem instalar nada.
 */
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORTA_PONTE = 8961;
const PORTA_SITE = 8962;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title>
<style>body{font-family:system-ui;margin:0;padding:40px}
#entrarSite{position:absolute;left:120px;top:220px;width:220px;height:64px;font-size:18px;cursor:pointer}</style>
</head><body>
  <h1 id="titulo">Loja de teste</h1>
  <button id="entrarSite">Entrar</button>
  <script>
    document.getElementById('entrarSite').addEventListener('click', () => {
      document.getElementById('titulo').textContent = 'Bem-vindo ao Painel';
      document.body.style.background = '#e8f4ff';
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

  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const encerrar = async () => { await nav.close().catch(() => {}); ponte.kill(); site.close(); };

  try {
    const p = await nav.newPage();
    await p.setViewport({ width: 1400, height: 1000 });
    const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(`http://127.0.0.1:${PORTA_PONTE}/`, { waitUntil: 'networkidle0' });
    await esperar(1200);

    await p.evaluate(() => {
      document.querySelectorAll('.tela').forEach((el) => el.classList.remove('ativa'));
      document.getElementById('telaGravador').classList.add('ativa');
      document.querySelector('[data-acao="gravarClicando"]').click();
    });
    await esperar(300);
    assert.ok(await p.evaluate(() => !document.getElementById('painelClicando').hidden),
      'o painel não abriu');
    console.log('  OK   painel abriu');

    await p.evaluate((u) => {
      document.getElementById('urlClicando').value = u;
      document.querySelector('[data-acao="abrirClicando"]').click();
    }, `http://127.0.0.1:${PORTA_SITE}/`);

    for (let i = 0; i < 60; i++) {
      const pronto = await p.evaluate(() => {
        const img = document.getElementById('imgRemota');
        return !document.getElementById('telaRemota').hidden && img && img.naturalWidth > 0;
      });
      if (pronto) break;
      await esperar(500);
    }
    const abriu = await p.evaluate(() => {
      const img = document.getElementById('imgRemota');
      return { visivel: !document.getElementById('telaRemota').hidden, largura: img.naturalWidth };
    });
    assert.ok(abriu.visivel, 'a tela remota não apareceu');
    assert.strictEqual(abriu.largura, 1366, 'largura da tela remota inesperada: ' + abriu.largura);
    console.log('  OK   site abriu na tela do Print (' + abriu.largura + 'px)');

    // Clica NA IMAGEM, no ponto onde o botao esta na pagina real (centro: 230,252).
    await p.evaluate(() => {
      const img = document.getElementById('imgRemota');
      const r = img.getBoundingClientRect();
      const fx = r.width / img.naturalWidth, fy = r.height / img.naturalHeight;
      img.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: r.left + 230 * fx,
        clientY: r.top + 252 * fy
      }));
    });

    for (let i = 0; i < 80; i++) {
      if (await p.evaluate(() => document.querySelectorAll('#lista .passo').length > 0)) break;
      await esperar(500);
    }

    const r = await p.evaluate(() => {
      const passo = document.querySelector('#lista .passo');
      if (!passo) return null;
      const qa = passo.querySelector('.meta-qa');
      return {
        titulo: passo.querySelector('.titulo').textContent.trim(),
        seletor: passo.dataset.elemento,
        html: (passo.dataset.html || '').slice(0, 40),
        figuras: passo.querySelectorAll('figure').length,
        caixaVisivel: qa && !qa.hidden,
        caixaTexto: qa ? qa.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) : ''
      };
    });

    console.log('  ' + JSON.stringify(r, null, 2));
    assert.ok(r, 'o clique não virou passo no Print');
    assert.strictEqual(r.seletor, '#entrarSite', 'seletor errado: ' + r.seletor);
    assert.match(r.html, /<button id="entrarSite"/, 'HTML não chegou ao passo');
    assert.strictEqual(r.figuras, 2, 'faltaram os prints antes/depois');
    assert.ok(r.caixaVisivel, 'a caixa do elemento não apareceu');
    assert.ok(!/Sem seletor/i.test(r.caixaTexto), 'ainda mostra "Sem seletor": ' + r.caixaTexto);
    console.log('  OK   passo com id, HTML e dois prints — sem "Sem seletor"');

    await p.evaluate(() => document.querySelector('[data-acao="encerrarClicando"]').click());
    await esperar(1500);
    assert.deepStrictEqual(erros, [], 'a página deu erro de JS');
    console.log('  OK   encerrou sem erro de JS');

    console.log('\nRESULTADO: PASSOU');
    await encerrar();
  } catch (e) {
    await encerrar();
    throw e;
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
