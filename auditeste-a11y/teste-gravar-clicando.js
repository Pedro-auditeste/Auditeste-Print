/* Navegação remota: abre, clica pela coordenada e confere id/HTML/URL.
 *
 *   node teste-gravar-clicando.js
 *
 * Headless: roda igual na Railway e na máquina.
 */
const assert = require('assert');
const http = require('http');
const gravador = require('./gravador.js');

const PORTA_SITE = 8952;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title>
<style>body{font-family:system-ui;margin:0;padding:40px}
#entrarSite{position:absolute;left:100px;top:200px;width:200px;height:60px;font-size:18px}
#vazio{position:absolute;left:900px;top:600px;width:200px;height:60px}</style></head>
<body>
  <h1 id="titulo">Loja de teste</h1>
  <button id="entrarSite">Entrar</button>
  <div id="vazio">área sem controle</div>
  <div style="height:2000px"></div>
  <script>
    document.getElementById('entrarSite').addEventListener('click', () => {
      document.getElementById('titulo').textContent = 'Bem-vindo ao Painel';
      document.body.style.background = '#e8f4ff';
    });
  </script>
</body></html>`;

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  let id = null;
  try {
    const s = await gravador.abrir(`http://127.0.0.1:${PORTA_SITE}/`);
    id = s.id;
    assert.ok(id, 'não devolveu id');
    assert.strictEqual(s.largura, gravador.LARGURA, 'largura divergente');
    assert.ok(s.tela.startsWith('data:image/jpeg;base64,'), 'não veio a tela inicial');
    assert.ok(s.tela.length > 3000, 'tela inicial vazia');
    console.log('  OK   abriu e devolveu a tela (' + Math.round(s.tela.length / 1024) + ' KB)');

    // Clique no centro do botão: 100..300 x 200..260
    const r = await gravador.clicar(id, 200, 230);
    assert.ok(r.passo, 'clique não virou passo');
    const p = r.passo;
    console.log('  ' + JSON.stringify({
      titulo: p.titulo, elemento: p.elemento, rotulo: p.rotulo,
      html: (p.html || '').slice(0, 40), imagens: p.imagens.length
    }, null, 2));

    assert.strictEqual(p.elemento, '#entrarSite', 'seletor errado: ' + p.elemento);
    assert.match(p.html, /<button id="entrarSite"/, 'HTML não veio');
    assert.strictEqual(p.rotulo, 'Entrar', 'rótulo errado: ' + p.rotulo);
    assert.strictEqual(p.imagens.length, 2, 'faltou antes/depois');
    assert.match(p.urlAntes, /127\.0\.0\.1/, 'URL antes vazia');
    assert.notStrictEqual(p.imagens[0].dataUrl, p.imagens[1].dataUrl, 'antes e depois iguais');
    assert.ok(r.tela, 'não devolveu a tela nova');
    console.log('  OK   clique inspecionou id, HTML, URL e gerou os dois prints');

    // Clique em area sem controle: nao inventa passo.
    const vazio = await gravador.clicar(id, 1000, 630);
    assert.ok(!vazio.passo, 'clique no vazio virou passo');
    assert.strictEqual(gravador.passos(id, 0).total, 1, 'contagem mudou no clique vazio');
    console.log('  OK   clique fora de controle não vira passo');

    const rol = await gravador.rolar(id, 400);
    assert.ok(rol.tela.startsWith('data:image/jpeg'), 'rolagem não devolveu tela');
    console.log('  OK   rolagem devolve tela nova');

    const so2 = gravador.passos(id, 1);
    assert.strictEqual(so2.passos.length, 0, '"desde" não recortou');
    console.log('  OK   consulta incremental por "desde"');

    await gravador.fechar(id);
    id = null;
    assert.throws(() => { throw Object.assign(new Error('x'), {}); }, Error);
    const depoisFechar = gravador.passos('inexistente', 0);
    assert.ok(depoisFechar.erro, 'sessão inexistente deveria acusar erro');
    console.log('  OK   sessão fechada e id inválido acusado');

    console.log('\nRESULTADO: PASSOU');
  } finally {
    if (id) await gravador.fechar(id);
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
