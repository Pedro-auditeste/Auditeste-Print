/* Grava em vídeo o caminho inteiro até o Zephyr, para mostrar a alguém.
 *
 *   node demo-video-zephyr.js [saida.webm]
 *
 * Abre o Print num Chrome de verdade, entra no cofre, cria projeto, traz a
 * gravação, salva a evidência e publica no Zephyr, com uma legenda em cima
 * explicando cada etapa. No lugar do Zephyr real entra um local que confere
 * a assinatura do mesmo jeito: gravar um vídeo não pode criar execução na
 * conta da equipe.
 */
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const SAIDA = path.resolve(process.argv[2] || path.join(__dirname, 'demo-zephyr.webm'));
const ACCESS = 'ACCESSKEY-EXEMPLO-9f2a';
const SEGREDO = 'segredo-de-exemplo-nao-use-em-producao';
const CONTA = '557058:11d1e9f3-conta-exemplo';
const P_ZEPHYR = 8977;
const P_COFRE = 8976;
const BASE = 'http://127.0.0.1:' + P_COFRE;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

const EVIDENCIA = {
  formato: 'audi-print-evidencia-v1',
  url: 'https://loja.exemplo.test/checkout',
  titulo: 'Checkout',
  passos: [{
    titulo: 'Clicou em "Finalizar compra"', obs: '', acao: 'Clicar',
    elemento: '//*[@id="btnFinalizar"]', rotulo: 'Finalizar compra',
    html: '<button id="btnFinalizar">Finalizar compra</button>',
    urlAntes: 'https://loja.exemplo.test/checkout',
    urlDepois: 'https://loja.exemplo.test/erro',
    imagens: [{ dataUrl: PIXEL, legenda: 'Antes' }, { dataUrl: PIXEL, legenda: 'Depois' }]
  }]
};

/* ---------- Zephyr de mentira, com a mesma conferencia de assinatura ---------- */
const chamadas = [];
const zephyr = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const caminho = u.pathname.replace(/^\/connect/, '');
  const query = [...u.searchParams.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const p = [];
  req.on('data', d => p.push(d));
  req.on('end', () => {
    const corpo = Buffer.concat(p);
    const [cab, carga, assin] = (req.headers.authorization || '').replace(/^JWT /, '').split('.');
    const ok = assin === crypto.createHmac('sha256', SEGREDO).update(cab + '.' + carga).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      && JSON.parse(Buffer.from(carga, 'base64').toString('utf8')).qsh
        === crypto.createHash('sha256').update([req.method, caminho, query].join('&')).digest('hex');
    const responder = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!ok) return responder(401, { errorDesc: 'assinatura inválida' });
    chamadas.push({ metodo: req.method, caminho, bytes: corpo.length });
    if (caminho === '/public/rest/api/1.0/cycles/search') return responder(200, { 77: { name: 'Ciclo' } });
    if (caminho.startsWith('/public/rest/api/1.0/executions/add/cycle/')) return responder(200, {});
    if (caminho.startsWith('/public/rest/api/1.0/executions/search/cycle/')) {
      return responder(200, { searchObjectList: [{ execution: { id: 40211, issueId: 10101 } }] });
    }
    if (caminho.startsWith('/public/rest/api/1.0/executions/')) return responder(200, { ok: true });
    if (caminho === '/public/rest/api/1.0/attachment') return responder(200, { id: 'anexo-1' });
    responder(404, { errorDesc: 'rota desconhecida' });
  });
});

const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(ok => zephyr.listen(P_ZEPHYR, '127.0.0.1', ok));

  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'video-zephyr-')), 'cofre.db');
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  banco.abrir(arq);
  const t = banco.criarTenant('Cliente Demonstração', 90);
  const u = banco.criarUsuario('qa@auditeste.com', contas.hashSenha('senha-bem-longa-9'));
  banco.vincular(t.id, u.id, 'admin');
  banco.fechar();

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(P_COFRE), HOST: '127.0.0.1', COFRE_BANCO: arq,
      COFRE_SEGREDO: 'segredo-video', AGENTE_API_KEY: '', PONTE_TOKEN: '',
      ZEPHYR_BASE: 'http://127.0.0.1:' + P_ZEPHYR + '/connect',
      ZEPHYR_ACCESS_KEY: ACCESS, ZEPHYR_SECRET_KEY: SEGREDO, ZEPHYR_ACCOUNT_ID: CONTA,
      ZEPHYR_PROJETO_ID: '10000', ZEPHYR_VERSAO_ID: '-1', ZEPHYR_CICLO_ID: '77'
    }),
    stdio: 'ignore'
  });
  for (let i = 0; ; i++) {
    try { const r = await fetch(BASE + '/ping'); if (r.ok) break; } catch (e) { /* subindo */ }
    if (i > 120) throw new Error('o cofre não subiu');
    await espera(250);
  }

  const navegador = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--window-size=1280,860', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 800 }
  });
  const pagina = (await navegador.pages())[0] || await navegador.newPage();
  pagina.on('dialog', d => d.accept('10101'));   // o caso de teste, como quem digita

  await pagina.evaluateOnNewDocument((evid) => {
    addEventListener('message', (ev) => {
      const d = ev.data;
      if (ev.source !== window || !d || d.tipo !== 'AUDI_PRINT_PEDE') return;
      const corpo = d.deTab == null
        ? { evidencias: [{ tabId: 7, url: evid.url, titulo: evid.titulo, inicio: new Date().toISOString(),
            ativa: false, encerrada: new Date().toISOString(), importada: false, passos: 1 }] }
        : { evidencia: evid };
      postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
    });
  }, EVIDENCIA);

  /* A legenda vive fora da pagina, num elemento proprio: nao mexe em nada do
   * produto, e some quando a pagina troca (por isso e reposta a cada etapa). */
  const legenda = async (texto, ms) => {
    await pagina.evaluate((t) => {
      let el = document.getElementById('__legenda');
      if (!el) {
        el = document.createElement('div');
        el.id = '__legenda';
        /* No TOPO de proposito: no rodape a legenda cobria o aviso de
         * sucesso, que e justamente o que o video precisa mostrar. */
        el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;'
          + 'background:rgba(13,52,70,.96);color:#fff;font:600 19px system-ui,Segoe UI,sans-serif;'
          + 'padding:14px 24px;border-bottom:4px solid #76c043;letter-spacing:.2px;pointer-events:none;';
        document.body.appendChild(el);
      }
      el.textContent = t;
    }, texto).catch(() => {});
    if (ms) await espera(ms);
  };

  await pagina.goto(BASE + '/cofre.html', { waitUntil: 'domcontentloaded' });
  const gravador = await pagina.screencast({ path: SAIDA, fps: 12 });
  try {
    await legenda('Audi Print · publicar a evidência no Zephyr Squad', 2200);

    await legenda('1. Entrando no cofre da equipe', 1200);
    await pagina.waitForSelector('#email', { visible: true });
    await pagina.type('#email', 'qa@auditeste.com', { delay: 45 });
    await pagina.type('#senha', 'senha-bem-longa-9', { delay: 35 });
    await espera(500);
    await pagina.click('#btnEntrar');
    await pagina.waitForSelector('#telaProjetos:not([hidden])', { timeout: 15000 });
    await espera(900);

    await legenda('2. Abrindo o Print', 1400);
    await pagina.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await legenda('2. Abrindo o Print');
    await pagina.click('#entrarSite');
    await pagina.waitForSelector('#telaProjetos.ativa');
    await espera(800);

    await legenda('3. Criando o projeto do cliente', 900);
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.type('#campoNome', 'Loja Exemplo · Checkout', { delay: 40 });
    await espera(600);
    await pagina.click('#btnConfirmarModal');
    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await espera(900);

    await legenda('4. Gravando: os passos vêm do complemento, com xpath e id', 900);
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await pagina.waitForSelector('[data-acao="novaGravacao"]');
    await pagina.evaluate(() => { document.getElementById('capturarPrintsPasso').checked = true; });
    await pagina.click('[data-acao="novaGravacao"]');
    await pagina.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
    await legenda('4. Gravando: os passos vêm do complemento, com xpath e id');
    await pagina.click('[data-acao="puxarExtensao"]');
    await pagina.waitForSelector('.passo', { timeout: 15000 });
    await espera(1500);

    await legenda('5. Marcando o resultado do teste', 700);
    /* Ambiente, tipo e resultado sao <select>: textContent nao muda select,
     * e foi por isso que o primeiro video saiu com o ambiente em branco. */
    await pagina.evaluate(() => {
      const por = (campo, valor) => {
        const el = document.querySelector('#ficha [data-campo="' + campo + '"]');
        if (!el) return;
        if (el.tagName === 'SELECT') {
          const o = [...el.options].find(x => x.textContent.trim().toLowerCase() === valor.toLowerCase());
          if (o) { el.value = o.value || o.textContent; el.dispatchEvent(new Event('change', { bubbles: true })); }
        } else {
          el.textContent = valor;
        }
      };
      por('executor', 'Pedro Rodrigues');
      por('modulo', 'Checkout');
      por('demanda', 'LOJA-4412');
      por('versao', '4.2.1');
      por('ambiente', 'Homologação');
      por('resultado', 'Reprovado');
    });
    await espera(1200);

    await legenda('6. Salvando a evidência no projeto', 700);
    await pagina.click('[data-acao="salvar"]');
    await pagina.waitForSelector('[data-abrir]', { timeout: 20000 });
    await espera(1600);

    await legenda('7. Abrindo a evidência salva', 700);
    await pagina.click('[data-abrir]');
    await pagina.waitForSelector('#telaRegistro.ativa', { timeout: 15000 });
    await pagina.waitForSelector('[data-acao="publicarZephyr"]:not([hidden])', { timeout: 15000 });
    await espera(1400);

    await legenda('8. Publicar no Zephyr: o botão só aparece se o servidor tiver as chaves', 2000);
    await pagina.evaluate(() => {
      const b = document.querySelector('[data-acao="publicarZephyr"]');
      if (b) b.scrollIntoView({ block: 'center' });
    });
    await espera(800);
    await pagina.click('[data-acao="publicarZephyr"]');
    await espera(1500);   // o caso de teste e respondido pelo dialog acima

    await legenda('9. Confirmando o que vai ser publicado', 2000);
    await pagina.evaluate(() => {
      const b = [...document.querySelectorAll('.fundo-modal.aberto button')]
        .find(x => /publicar/i.test(x.textContent));
      if (b) b.click();
    });

    await pagina.waitForFunction(
      () => /Publicado no Zephyr/.test(document.querySelector('.aviso-toast .aviso-texto')?.textContent || ''),
      { timeout: 25000 });
    await legenda('10. Publicado: execução criada no Zephyr, com a evidência anexada', 3200);

    await legenda('Foram ' + chamadas.length + ' chamadas assinadas ao Zephyr. A chave nunca passou pelo navegador.', 3800);
  } finally {
    await gravador.stop().catch(() => {});
    await navegador.close().catch(() => {});
    proc.kill();
    zephyr.close();
  }

  console.log('\nvídeo: ' + SAIDA + '  (' + (fs.statSync(SAIDA).size / 1048576).toFixed(1) + ' MB)');
  console.log('chamadas ao Zephyr: ' + chamadas.map(c => c.metodo + ' ' + c.caminho.split('/').pop()).join(', '));
})();
