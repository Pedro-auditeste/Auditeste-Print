/* Fluxo do painel "Buscar seletores pelo link", contra uma ponte local.
 *
 *   node teste-painel-seletores.js
 *
 * Cobre o caso que falhou na mao: clicar no botao sem nenhum passo capturado.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORTA_PONTE = 8941;
const PORTA_SITE = 8942;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body>
  <button id="entrarSite">Entrar</button>
  <input id="buscaTopo" type="text" placeholder="Buscar produtos">
  <a href="/cupom" data-testid="link-cupom">Cupom Saldão</a>
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
    const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(`http://127.0.0.1:${PORTA_PONTE}/`, { waitUntil: 'networkidle0' });
    await esperar(1200);

    // Vai para a tela do gravador, onde o painel vive.
    await p.evaluate(() => {
      const t = document.getElementById('telaGravador');
      document.querySelectorAll('.tela').forEach((el) => el.classList.remove('ativa'));
      if (t) t.classList.add('ativa');
    });

    // 1) Sem nenhum passo, o botao deve ABRIR o painel — nao recusar.
    await p.evaluate(() => document.querySelector('[data-acao="buscarSeletores"]').click());
    await esperar(300);
    const abriu = await p.evaluate(() => {
      const pa = document.getElementById('painelSeletores');
      return { visivel: pa && !pa.hidden, temCampo: !!document.getElementById('urlSeletores') };
    });
    assert.ok(abriu.visivel, 'o painel não abriu sem passos');
    assert.ok(abriu.temCampo, 'não há campo para o link');
    console.log('  OK   painel abre sem passos, com campo');

    // 2) Le os ids do site e mostra o catalogo.
    await p.evaluate((u) => {
      document.getElementById('urlSeletores').value = u;
      document.querySelector('[data-acao="lerSeletores"]').click();
    }, `http://127.0.0.1:${PORTA_SITE}/`);
    for (let i = 0; i < 60; i++) {
      const pronto = await p.evaluate(() => !!document.querySelector('#listaSeletores table'));
      if (pronto) break;
      await esperar(500);
    }

    const cat = await p.evaluate(() => {
      const linhas = [...document.querySelectorAll('#listaSeletores tbody tr')].map((tr) => ({
        rotulo: tr.children[0].textContent.trim(),
        seletor: tr.children[1].textContent.trim()
      }));
      return { linhas, temCopiar: !!document.querySelector('#listaSeletores .copiar-sel') };
    });

    console.log('  catálogo: ' + JSON.stringify(cat.linhas));
    assert.ok(cat.linhas.length >= 3, 'catálogo veio curto: ' + cat.linhas.length);
    assert.ok(cat.temCopiar, 'faltou o botão Copiar');
    const porRotulo = Object.fromEntries(cat.linhas.map((l) => [l.rotulo, l.seletor]));
    assert.strictEqual(porRotulo['Entrar'], '#entrarSite', 'seletor do botão errado');
    assert.strictEqual(porRotulo['Cupom Saldão'], '[data-testid="link-cupom"]', 'não priorizou data-testid');
    console.log('  OK   catálogo listado com seletor certo');

    // 3) Fechar esconde o painel.
    await p.evaluate(() => document.querySelector('[data-acao="fecharSeletores"]').click());
    await esperar(200);
    const fechou = await p.evaluate(() => document.getElementById('painelSeletores').hidden);
    assert.ok(fechou, 'o painel não fechou');
    console.log('  OK   painel fecha');

    assert.deepStrictEqual(erros, [], 'a página deu erro de JS');
    console.log('\nRESULTADO: PASSOU');
    await encerrar();
  } catch (e) {
    await encerrar();
    throw e;
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
