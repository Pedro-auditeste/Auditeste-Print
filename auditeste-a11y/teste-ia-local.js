/* Site local com menu real + abas: Home, Quem somos, Funcionalidades, Entrar. */
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
<div class="nav-tabs" role="tablist">
  <button id="aba-resumo" role="tab" aria-selected="true" aria-controls="painel-resumo">Resumo</button>
  <button id="aba-detalhes" role="tab" aria-selected="false" aria-controls="painel-detalhes">Detalhes</button>
</div>
<div id="painel-resumo" role="tabpanel"><p>Resumo da página</p></div>
<div id="painel-detalhes" role="tabpanel" hidden><p>Detalhes técnicos</p></div>
<h1 id="titulo">${titulo}</h1>
${extra || ''}
<script>
document.getElementById('aba-resumo').onclick = function(){
  this.setAttribute('aria-selected','true');
  document.getElementById('aba-detalhes').setAttribute('aria-selected','false');
  document.getElementById('painel-resumo').hidden = false;
  document.getElementById('painel-detalhes').hidden = true;
};
document.getElementById('aba-detalhes').onclick = function(){
  this.setAttribute('aria-selected','true');
  document.getElementById('aba-resumo').setAttribute('aria-selected','false');
  document.getElementById('painel-resumo').hidden = true;
  document.getElementById('painel-detalhes').hidden = false;
};
</script>
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
    assert.ok(r.passos[0].imagens.length >= 2, 'home com antes/depois');
    assert.ok(/aba/i.test(titulos), 'clicou em aba: ' + titulos);
    assert.ok(/Quem somos/i.test(titulos), titulos);
    assert.ok(/Funcionalidades/i.test(titulos), titulos);
    assert.ok(/Entrar/i.test(titulos), titulos);
    const quem = r.passos.find((p) => /Quem somos/i.test(p.titulo));
    assert.ok(quem && quem.imagens.length >= 2, 'quem somos com antes/depois');
    assert.ok(quem.elemento === '#nav-quem' || /quem/i.test(quem.elemento), quem.elemento);
    assert.ok(r.passos.every((p) => (p.imagens || []).length >= 2), 'todo passo com 2 prints');
    console.log('OK  passos:', titulos);
    console.log('OK  prints:', r.passos.reduce((n, p) => n + p.imagens.length, 0));
    console.log(r.quadros && r.quadros.length ? ('OK  quadros ' + r.quadros.length) : 'OK  sem quadros extras');
    console.log('RESULTADO: PASSOU');
  } catch (err) {
    console.error('FALHOU:', err && err.message);
    process.exitCode = 1;
  } finally {
    srv.close();
  }
});
