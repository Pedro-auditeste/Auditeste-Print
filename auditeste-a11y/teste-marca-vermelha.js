/* Checa o realce estilo inspetor da extensao, num Chrome de verdade.
 *
 *   node teste-marca-vermelha.js
 *
 * Le a logica direto de audi-print-scanner/content.js para nao virar copia.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const fonte = fs.readFileSync(
  path.join(__dirname, '..', 'audi-print-scanner', 'content.js'), 'utf8'
);

// Do aspas ate o fim de segurarAte: e todo o mecanismo do realce.
const inicio = fonte.indexOf('  function aspas');
const fim = fonte.indexOf('  function registrar');
assert.ok(inicio > 0 && fim > inicio, 'não achei o trecho do realce em content.js');
const trecho = fonte.slice(inicio, fim);

const pagina = `<body style="margin:0">
  <div style="height:40px"></div>
  <button id="entrarSite" style="width:140px;height:44px">Entrar</button>
  <div style="height:2000px"></div>
</body>`;

(async () => {
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await nav.newPage();
  await p.setViewport({ width: 800, height: 600 });
  await p.setContent(pagina);

  const r = await p.evaluate(async (trecho) => {
    // gravando/travado sao estado do modulo; o trecho declara travado e alvoAtual.
    const api = new Function('gravando', trecho + `
      return { destacar, segurarAte, seguir, esconderRealce, reposicionar,
               estado: () => ({ travado, alvo: alvoAtual && alvoAtual.id }) };
    `)(true);

    const el = document.getElementById('entrarSite');
    const cx = () => document.documentElement.lastElementChild.previousElementSibling;
    const lidos = () => {
      const divs = [...document.documentElement.children].filter(
        (n) => n.tagName === 'DIV' && n.style.position === 'fixed'
      );
      const borda = divs.find((d) => d.style.border);
      const etq = divs.find((d) => d !== borda);
      return {
        visivel: borda && borda.style.display === 'block',
        cor: borda && borda.style.borderColor,
        etiqueta: etq && etq.style.display === 'block' ? etq.textContent : null,
        topo: borda && borda.style.top
      };
    };
    const out = {};
    void cx;

    // 1) seguir o mouse: âmbar, com o seletor escrito
    api.seguir(el);
    out.hover = lidos();

    // 2) clique: trava em vermelho
    const limpar = api.destacar(el);
    out.clique = lidos();
    out.travadoNoClique = api.estado().travado;

    // 3) enquanto travado, mover o mouse não muda o realce
    api.seguir(document.body);
    out.durante = lidos();

    // 4) o print terminou: realce some
    limpar();
    out.depois = lidos();
    out.travadoDepois = api.estado().travado;

    // 5) rolar a página com alvo ativo reposiciona a caixa
    api.seguir(el);
    const antesDoScroll = lidos().topo;
    window.scrollTo(0, 300);
    api.reposicionar();
    out.scroll = { antes: antesDoScroll, depois: lidos().topo };

    // 6) rede de segurança do segurarAte continua valendo
    let limpou = false;
    api.segurarAte(() => { limpou = true; }, Promise.resolve());
    await new Promise((r2) => setTimeout(r2, 30));
    out.segurarAteLimpou = limpou;
    return out;
  }, trecho);

  await nav.close();
  console.log(JSON.stringify(r, null, 2));

  const hex = (c) => (c || '').replace(/\s/g, '').toLowerCase();
  assert.ok(r.hover.visivel, 'realce não apareceu ao passar o mouse');
  assert.strictEqual(hex(r.hover.cor), 'rgb(232,144,31)', 'hover não está âmbar');
  assert.strictEqual(r.hover.etiqueta, '//*[@id="entrarSite"]', 'etiqueta não traz o seletor');

  assert.strictEqual(hex(r.clique.cor), 'rgb(226,60,60)', 'clique não ficou vermelho');
  assert.ok(r.travadoNoClique, 'não travou durante a captura');
  assert.strictEqual(hex(r.durante.cor), 'rgb(226,60,60)', 'o mouse mexeu no realce travado');

  assert.strictEqual(r.depois.visivel, false, 'realce ficou preso depois do print');
  assert.strictEqual(r.travadoDepois, false, 'continuou travado após o print');

  assert.notStrictEqual(r.scroll.antes, r.scroll.depois, 'não acompanhou a rolagem');
  assert.ok(r.segurarAteLimpou, 'segurarAte não limpou ao resolver');

  console.log('\nRESULTADO: PASSOU');
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
