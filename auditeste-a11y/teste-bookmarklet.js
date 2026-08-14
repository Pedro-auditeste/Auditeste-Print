/* Bookmarklet ponta a ponta: roda no site, o clique chega ao Print.
 *
 *   node teste-bookmarklet.js
 *
 * O site de teste tem CSP que só permite inline — como o das lojas grandes —
 * para provar que o bookmarklet sobrevive a ele.
 */
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORTA_PONTE = 8991;
const PORTA_SITE = 8992;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>Loja de teste</h1>
  <button id="btnComprar" class="cta">Comprar</button>
  <div id="decorativo" style="margin-top:20px">área sem ação</div>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // CSP igual ao de loja grande: inline liberado, script externo bloqueado.
  const site = http.createServer((_, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src *"
    });
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
  const base = `http://127.0.0.1:${PORTA_PONTE}`;

  try {
    // 1) O Print gera o codigo e monta o bookmarklet.
    const print = await nav.newPage();
    await print.goto(base + '/', { waitUntil: 'networkidle0' });
    await esperar(1000);

    const preparo = await print.evaluate(async () => {
      document.querySelectorAll('.tela').forEach((el) => el.classList.remove('ativa'));
      document.getElementById('telaGravador').classList.add('ativa');
      document.querySelector('[data-acao="marcarCliques"]').click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelector('[data-acao="gerarCodigoMarca"]').click();
      for (let i = 0; i < 40; i++) {
        const c = document.getElementById('codigoMarca').textContent.trim();
        if (c && c !== '—') return { codigo: c, href: document.getElementById('linkMarcador').href };
        await new Promise((r) => setTimeout(r, 250));
      }
      return { codigo: '', href: '' };
    });

    assert.match(preparo.codigo, /^[A-Z2-9]{8}$/, 'código inesperado: ' + preparo.codigo);
    assert.ok(preparo.href.startsWith('javascript:'), 'o favorito não é bookmarklet');
    console.log('  OK   código ' + preparo.codigo + ' · bookmarklet de '
      + Math.round(preparo.href.length / 1024) + ' KB');

    // 2) O favorito roda no site, com o CSP ligado.
    const loja = await nav.newPage();
    const cspBloqueou = [];
    // So violacao de SCRIPT importa: estilo bloqueado tira o aviso visual,
    // mas a captura continua e e ela que gera a evidencia.
    loja.on('console', (m) => {
      const txt = m.text();
      if (/Content Security Policy/i.test(txt) && !/inline style|style-src/i.test(txt)) cspBloqueou.push(txt);
    });
    await loja.goto(`http://127.0.0.1:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' });

    const codigo = preparo.codigo;
    await loja.evaluate((c) => sessionStorage.setItem('audiCodigo', c), codigo);
    // prompt() não existe em headless: responde sozinho com o código.
    await loja.evaluate((c) => { window.prompt = () => c; }, codigo);
    await loja.evaluate(decodeURIComponent(preparo.href.replace(/^javascript:/, '')));

    const ligou = await loja.evaluate(() => !!window.__audiMarcando);
    assert.ok(ligou, 'o bookmarklet não ligou');
    assert.deepStrictEqual(cspBloqueou, [], 'o CSP bloqueou o script: ' + cspBloqueou.join(' | '));
    console.log('  OK   bookmarklet rodou com CSP ligado');

    // 3) Clique de verdade no botao.
    await loja.click('#btnComprar');
    await esperar(1500);
    await loja.click('#decorativo');
    await esperar(1000);

    const r = await new Promise((ok, no) => {
      http.get(base + '/marca/passos?codigo=' + codigo + '&desde=0', (res) => {
        let s = '';
        res.on('data', (d) => { s += d; });
        res.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } });
      }).on('error', no);
    });

    console.log('  ' + JSON.stringify(r.passos.map((p) => ({
      titulo: p.titulo, elemento: p.elemento, html: (p.html || '').slice(0, 34)
    })), null, 2));

    assert.strictEqual(r.total, 1, 'esperava 1 passo (o decorativo não conta): ' + r.total);
    const p = r.passos[0];
    assert.strictEqual(p.elemento, '#btnComprar', 'seletor errado: ' + p.elemento);
    assert.strictEqual(p.rotulo, 'Comprar', 'rótulo errado: ' + p.rotulo);
    assert.match(p.html, /<button id="btnComprar"/, 'HTML não veio');
    assert.match(p.urlAntes, /127\.0\.0\.1/, 'URL vazia');
    console.log('  OK   clique em "Comprar" chegou com id, HTML e URL');

    // 4) O Print recebe e monta o passo.
    for (let i = 0; i < 30; i++) {
      const n = await print.evaluate(() => document.querySelectorAll('#lista .passo').length);
      if (n > 0) break;
      await esperar(500);
    }
    const noPrint = await print.evaluate(() => {
      const passo = document.querySelector('#lista .passo');
      if (!passo) return null;
      const qa = passo.querySelector('.meta-qa');
      return { seletor: passo.dataset.elemento, caixa: qa && !qa.hidden,
        temHtml: !!(qa && qa.querySelector('.insp-html pre')) };
    });
    assert.ok(noPrint, 'o passo não apareceu no Print');
    assert.strictEqual(noPrint.seletor, '#btnComprar', 'seletor errado no Print');
    assert.ok(noPrint.temHtml, 'o HTML não apareceu no passo');
    console.log('  OK   passo montado no Print com id e HTML');

    console.log('\nRESULTADO: PASSOU');
    await encerrar();
  } catch (e) {
    await encerrar();
    throw e;
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
