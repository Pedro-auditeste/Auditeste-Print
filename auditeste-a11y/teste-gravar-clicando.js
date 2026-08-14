/* Grava clicando: abre um Chrome, clica de verdade e confere id/HTML/URL.
 *
 *   node teste-gravar-clicando.js
 *
 * Abre janela de verdade. Em container sem tela, ele se pula sozinho.
 */
const assert = require('assert');
const http = require('http');
const gravador = require('./gravador.js');

const PORTA_SITE = 8952;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1 id="titulo">Loja de teste</h1>
  <button id="entrarSite" style="padding:14px 28px">Entrar</button>
  <script>
    document.getElementById('entrarSite').addEventListener('click', () => {
      document.getElementById('titulo').textContent = 'Bem-vindo ao Painel';
      document.body.style.background = '#e8f4ff';
    });
  </script>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (gravador.semJanela()) {
    console.log('PULADO: esta máquina não tem janela (container).');
    return;
  }

  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  let id = null;
  try {
    const s = await gravador.abrir(`http://127.0.0.1:${PORTA_SITE}/`);
    id = s.id;
    assert.ok(id, 'não devolveu id de sessão');
    assert.strictEqual(gravador.passos(id, 0).total, 0, 'começou com passos');
    console.log('  OK   janela aberta, sessão vazia');

    // Clique real no DOM: é o que passa pelo listener injetado.
    await gravador.paginaDe(id).click('#entrarSite');

    for (let i = 0; i < 40; i++) {
      if (gravador.passos(id, 0).total > 0) break;
      await esperar(500);
    }

    const r = gravador.passos(id, 0);
    assert.ok(r.total >= 1, 'o clique não virou passo');
    const p = r.passos[0];
    console.log('  ' + JSON.stringify({
      titulo: p.titulo,
      elemento: p.elemento,
      rotulo: p.rotulo,
      html: (p.html || '').slice(0, 42),
      imagens: p.imagens.length,
      urlAntes: p.urlAntes
    }, null, 2));

    assert.strictEqual(p.elemento, '#entrarSite', 'seletor errado: ' + p.elemento);
    assert.match(p.html, /<button id="entrarSite"/, 'HTML do elemento não veio');
    assert.strictEqual(p.rotulo, 'Entrar', 'rótulo errado: ' + p.rotulo);
    assert.strictEqual(p.acao, 'Clicar', 'ação errada');
    assert.strictEqual(p.imagens.length, 2, 'faltou print antes/depois');
    assert.match(p.urlAntes, /127\.0\.0\.1/, 'URL antes vazia');
    assert.ok(p.imagens[0].dataUrl.startsWith('data:image/jpeg;base64,'), 'print antes inválido');
    assert.ok(p.imagens[1].dataUrl.length > 2000, 'print depois veio vazio');
    console.log('  OK   clique virou passo com id, HTML, URL e dois prints');

    // 'desde' evita reenviar as imagens a cada consulta do Print.
    const so2 = gravador.passos(id, 1);
    assert.strictEqual(so2.total, r.total, 'total mudou sem clique novo');
    assert.strictEqual(so2.passos.length, r.total - 1, '"desde" não recortou');
    console.log('  OK   consulta incremental por "desde"');

    console.log('\nRESULTADO: PASSOU');
  } finally {
    if (id) await gravador.fechar(id);
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
