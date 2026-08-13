/* Sobe um HTML local com ids e confirma vídeo + #entrar. */
const assert = require('assert');
const http = require('http');
const { testarUrl } = require('./teste-ia.js');

const home = `<!doctype html><html lang="pt-BR"><body>
<h1 id="titulo-home">Loja QA</h1>
<a id="entrar" href="/login">Entrar</a>
</body></html>`;
const login = `<!doctype html><html lang="pt-BR"><body>
<h1 id="titulo-login">Identificação</h1>
<input id="cpf" name="cpf" />
<button id="btn-continuar" type="button">Continuar</button>
</body></html>`;

const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url.startsWith('/login') ? login : home);
});

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const url = 'http://127.0.0.1:' + port + '/';
  try {
    const r = await testarUrl(url);
    assert.ok(r.passos.length >= 2, 'esperava acessar + clique');
    assert.strictEqual(r.passos[0].acao, 'Acessar');
    const clique = r.passos.find((p) => p.acao === 'Clicar');
    assert.ok(clique, 'esperava um clique');
    assert.strictEqual(clique.elemento, '#entrar');
    assert.ok(/id="entrar"/.test(clique.html || ''), 'html inspecionado');
    assert.ok(clique.imagens && clique.imagens.length >= 2, 'antes/depois');
    assert.ok((r.video && r.video.startsWith('data:video/webm')) || (r.quadros && r.quadros.length >= 2), 'vídeo ou quadros gravados pela IA');
    console.log('OK  passos:', r.passos.map((p) => p.acao + ' ' + p.elemento).join(' | '));
    console.log(r.video ? ('OK  vídeo ' + Math.round((r.video.length * 0.75) / 1024) + ' KB') : ('OK  quadros ' + r.quadros.length));
    console.log('RESULTADO: PASSOU');
  } catch (err) {
    console.error('FALHOU:', err && err.message);
    process.exitCode = 1;
  } finally {
    srv.close();
  }
});
