const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
const pegar = (re, nome) => {
  const m = re.exec(html);
  if (!m) throw new Error('não achei ' + nome);
  return m[0];
};
const fnMarcar = pegar(/  function marcarQa\(passo, dados\)\{[\s\S]*?\n  \}/, 'marcarQa');
const fnEsc = pegar(/  const esc = t => .*/, 'esc');
// Ancorado no molde que realmente tem meta-qa: ha varios innerHTML no arquivo.
const molde = pegar(/el\.innerHTML = `[^`]*meta-qa[^`]*`;/, 'molde do passo')
  .replace(/^el\.innerHTML = `/, '').replace(/`;$/, '');

(async () => {
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await nav.newPage();
  await p.setContent('<body></body>');

  const r = await p.evaluate((fnMarcar, fnEsc, molde) => {
    const api = new Function(
      fnEsc + '\n'
      + 'function aplicarAnaliseQa(){}\n'
      + fnMarcar + '\n'
      + 'return marcarQa;'
    )();
    const criar = (auto) => {
      const el = document.createElement('article');
      el.className = 'passo' + (auto ? ' passo-auto' : '');
      el.innerHTML = molde;
      document.body.appendChild(el);
      return el;
    };
    const out = {};

    const a = criar(false);
    api(a, {
      acao: 'Clicar', elemento: '#entrarSite', rotulo: 'Entrar',
      html: '<button id="entrarSite" class="btn">Entrar</button>'
    });
    const qa = a.querySelector('.meta-qa');
    out.extensao = {
      visivel: !qa.hidden,
      seletor: qa.querySelector('code') && qa.querySelector('code').textContent,
      botaoCopiar: !!qa.querySelector('.copiar-sel'),
      htmlNoPre: qa.querySelector('.insp-html pre') && qa.querySelector('.insp-html pre').textContent,
      // Procura o id capturado, nao 'qualquer button': o bloco tem o botao
      // Copiar HTML, que e nosso e deve existir.
      virouBotaoReal: !!qa.querySelector('.insp-html #entrarSite'),
      temCopiarHtml: !!qa.querySelector('.copiar-html')
    };

    const b = criar(true);
    api(b, { timestampAntes: new Date().toISOString() });
    const qb = b.querySelector('.meta-qa');
    out.gravacao = { visivel: !qb.hidden, texto: qb.textContent.trim().slice(0, 75) };

    const c = criar(false);
    api(c, {});
    out.manualVazio = { visivel: !c.querySelector('.meta-qa').hidden };
    return out;
  }, fnMarcar, fnEsc, molde);

  await nav.close();
  console.log(JSON.stringify(r, null, 2));

  const assert = require('assert');
  assert.ok(r.extensao.visivel, 'inspeção da extensão não apareceu');
  assert.strictEqual(r.extensao.seletor, '#entrarSite', 'seletor errado');
  assert.ok(r.extensao.botaoCopiar, 'faltou o botão Copiar');
  assert.match(r.extensao.htmlNoPre, /<button id="entrarSite"/, 'HTML não veio como texto');
  assert.strictEqual(r.extensao.virouBotaoReal, false, 'o HTML virou elemento real — escape falhou');
  assert.ok(r.extensao.temCopiarHtml, 'faltou o botão Copiar HTML');
  assert.ok(r.gravacao.visivel, 'gravação por tela não explicou a ausência do seletor');
  assert.match(r.gravacao.texto, /extensão|Sem seletor/i, 'aviso da gravação sem orientação');
  assert.strictEqual(r.manualVazio.visivel, false, 'passo manual vazio poluiu a tela');
  console.log('\nRESULTADO: PASSOU');
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
