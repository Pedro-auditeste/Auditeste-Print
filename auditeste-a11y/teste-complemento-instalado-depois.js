/* Instalar (ou atualizar) o complemento com a aba do sistema já aberta grava
 * do mesmo jeito, sem ninguém precisar recarregar a página.
 *
 *   node teste-complemento-instalado-depois.js
 *
 * O Chrome só põe o content script nas abas abertas DEPOIS da instalação. Até
 * 11/11/2026, quem instalava o complemento e ia direto testar na aba que já
 * estava aberta não gravava interação nenhuma: o Print caía calado para o
 * print da tela, e os passos saíam sem xpath, sem id e sem HTML. Funcionava
 * na máquina de quem já tinha o complemento havia tempo e falhava na máquina
 * de quem acabara de instalar.
 *
 * Atualização tem o mesmo defeito por outro caminho: a cópia antiga do content
 * script fica viva na aba, sem conseguir falar com o complemento novo. Depois
 * de recarregar o complemento, o clique tem de virar UM passo: nem zero (só a
 * cópia morta ouvindo), nem dois (as duas gravando).
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const EXT = path.join(__dirname, '..', 'audi-print-scanner');
const PORTA = 8966;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sistema</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1 id="tit">Pedidos</h1>
  <button id="salvar" type="button" style="padding:14px 28px">Salvar pedido</button>
  <script>salvar.addEventListener('click', () => { tit.textContent = 'Pedido salvo'; });</script>
</body></html>`;

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA, '127.0.0.1');

  /* Sem --load-extension: o navegador sobe SEM o complemento, como o da
   * pessoa que ainda vai instalar. */
  const nav = await puppeteer.launch({
    headless: false, executablePath: caminhoChrome(), defaultViewport: null,
    pipe: true, enableExtensions: true,
    args: ['--no-sandbox', '--window-size=1100,760', '--enable-unsafe-extension-debugging']
  });

  try {
    const aba = await nav.newPage();
    await aba.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'load' });

    const idExt = await nav.installExtension(EXT);
    await esperar(2500);   // onInstalled roda e alcança as abas abertas

    const noPopup = async (fn, ...args) => {
      const pop = await nav.newPage();
      await pop.goto(`chrome-extension://${idExt}/popup.html`, { waitUntil: 'domcontentloaded' });
      try { return await pop.evaluate(fn, ...args); } finally { await pop.close().catch(() => {}); }
    };
    const iniciar = () => noPopup(async (porta) => {
      const [a] = await chrome.tabs.query({ url: 'http://127.0.0.1:' + porta + '/*' });
      await chrome.runtime.sendMessage({ tipo: 'AUDI_INICIAR', tabId: a.id, capturarPrints: false });
    }, PORTA);
    const passosGravados = () => noPopup(async () => {
      const s = (await chrome.storage.local.get('sessoesAudiPrint')).sessoesAudiPrint || {};
      const sessao = Object.values(s).find((x) => x && x.ativa) || Object.values(s)[0];
      return sessao ? (sessao.passos || []).map((p) => ({ acao: p.acao, id: p.elementoId, xpath: p.elemento, html: p.html })) : [];
    });
    const clicar = async () => {
      await aba.bringToFront();
      await aba.hover('#salvar');
      await esperar(400);
      await aba.click('#salvar');
      await esperar(3000);
    };

    /* 1. Instalado agora, aba aberta antes, nenhum F5. */
    await iniciar();
    await clicar();
    let passos = await passosGravados();
    assert.strictEqual(passos.length, 1,
      'aba aberta antes da instalação: esperava 1 passo, veio ' + passos.length
      + ' (o content script não chegou na aba que já estava aberta)');
    assert.strictEqual(passos[0].id, 'salvar', 'o passo veio sem o id do elemento');
    assert.ok(/@id="salvar"/.test(passos[0].xpath), 'o passo veio sem xpath: ' + passos[0].xpath);
    assert.ok(/<button/.test(passos[0].html), 'o passo veio sem o HTML do elemento');
    console.log('  OK   instalou com a aba aberta: o clique virou passo com id, xpath e HTML, sem recarregar');

    /* 2. Complemento recarregado (o que a loja faz ao atualizar), mesma aba, nenhum F5. */
    await noPopup(() => { setTimeout(() => chrome.runtime.reload(), 50); }).catch(() => {});
    await esperar(3500);
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = nav.targets().find((t) => t.type() === 'service_worker' && t.url().includes(idExt));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'o complemento não voltou depois de recarregar');
    await iniciar();
    await clicar();
    passos = await passosGravados();
    assert.strictEqual(passos.length, 1,
      'depois de atualizar o complemento: esperava 1 passo, veio ' + passos.length
      + (passos.length ? ' (a cópia antiga e a nova gravaram juntas)' : ' (só a cópia morta estava ouvindo)'));
    assert.strictEqual(passos[0].id, 'salvar');
    console.log('  OK   complemento atualizado: o clique virou um passo só, sem recarregar a aba');

    console.log('\nRESULTADO: PASSOU');
  } finally {
    await nav.close().catch(() => {});
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
