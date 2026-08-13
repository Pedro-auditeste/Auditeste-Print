/* Site local com menu real: Home, Quem somos, Funcionalidades, Entrar. */
const assert = require('assert');
const http = require('http');
const { testarUrl } = require('./teste-ia.js');

function pag(titulo, extra) {
  return `<!doctype html><html lang="pt-BR"><body>
<nav>
  <a id="nav-home" href="/">Início</a>
  <a id="nav-quem" href="/quem-somos">Quem somos</a>
  <a id="nav-func" href="/funcionalidades">Funcionalidades</a>
  <a id="nav-entrar" href="/login">Entrar</a>
</nav>
<h1 id="titulo">${titulo}</h1>
${extra || ''}
</body></html>`;
}

const paginas = {
  '/': pag('Home'),
  '/quem-somos': pag('Quem somos'),
  '/funcionalidades': pag('Funcionalidades'),
  '/login': pag('Identificação', '<input id="cpf" name="cpf" /><button id="btn-continuar" type="button">Continuar</button>')
};

const srv = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(paginas[u] || paginas['/']);
});

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const url = 'http://127.0.0.1:' + port + '/';
  try {
    const r = await testarUrl(url);
    const titulos = r.passos.map((p) => p.titulo).join(' | ');
    assert.ok(r.passos[0].acao === 'Acessar', 'primeiro passo acessar');
    assert.ok(/Quem somos/i.test(titulos), titulos);
    assert.ok(/Funcionalidades/i.test(titulos), titulos);
    assert.ok(/Entrar/i.test(titulos), titulos);
    const quem = r.passos.find((p) => /Quem somos/i.test(p.titulo));
    assert.ok(quem && quem.imagens.length >= 2, 'quem somos com antes/depois');
    assert.ok(quem.elemento === '#nav-quem' || /quem/i.test(quem.elemento), quem.elemento);
    assert.ok((r.video && r.video.startsWith('data:video/webm')) || (r.quadros && r.quadros.length >= 4), 'vídeo ou quadros');
    console.log('OK  passos:', titulos);
    console.log(r.video ? ('OK  vídeo ' + Math.round((r.video.length * 0.75) / 1024) + ' KB') : ('OK  quadros ' + r.quadros.length));
    console.log('RESULTADO: PASSOU');
  } catch (err) {
    console.error('FALHOU:', err && err.message);
    process.exitCode = 1;
  } finally {
    srv.close();
  }
});
