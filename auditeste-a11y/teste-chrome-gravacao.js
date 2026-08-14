/* Teste visivel completo: captura por alteracao + gravacao de video + gerar cenarios.
 *
 *   node teste-chrome-gravacao.js
 *
 * Requer a ponte em http://127.0.0.1:8900
 */
const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PONTE_URL || 'http://127.0.0.1:8900';
const SAIDA = path.join(__dirname, 'saida');
const delay = ms => new Promise(r => setTimeout(r, ms));

function ping() {
  return new Promise(ok => {
    const req = http.get(BASE + '/ping', res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ok(null); } });
    });
    req.on('error', () => ok(null));
    req.setTimeout(4000, () => { req.destroy(); ok(null); });
  });
}

async function esperar(pagina, fn, ms, passo = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await delay(passo);
  }
  return false;
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });

  const info = await ping();
  if (!info || !info.ok) {
    console.error('Ponte nao esta no ar em ' + BASE + '. Rode: npm run servidor');
    process.exit(1);
  }
  console.log('Ponte ok · modelo ' + (info.modelo || '') + ' · cenarios=' + !!info.cenarios);
  console.log('Abrindo Chrome visivel...');

  const chromeLocal = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].find(p => p && fs.existsSync(p));

  const navegador = await puppeteer.launch({
    headless: false,
    channel: chromeLocal ? undefined : 'chrome',
    executablePath: chromeLocal,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen'
    ]
  });
  const pagina = await navegador.newPage();
  pagina.setDefaultTimeout(45000);

  await pagina.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      : null;
    navigator.mediaDevices.getDisplayMedia = async (opts) => {
      try {
        if (orig) return await orig(opts);
      } catch (e) { /* cai no canvas */ }
      const c = document.createElement('canvas');
      c.width = 1280;
      c.height = 720;
      const ctx = c.getContext('2d');
      let n = 0;
      const cenas = [
        ['Tela de login', 'Preencha e-mail e senha'],
        ['Campo e-mail preenchido', 'qa@teste.com'],
        ['Campo senha preenchido', '••••••'],
        ['Clique em Entrar', 'Aguardando...'],
        ['Dashboard', 'Maria Santos logada']
      ];
      const draw = () => {
        const cena = cenas[Math.floor(n / 40) % cenas.length];
        ctx.fillStyle = n % 80 < 40 ? '#0d3446' : '#16603f';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 42px Segoe UI, sans-serif';
        ctx.fillText(cena[0], 80, 220);
        ctx.font = '32px Segoe UI, sans-serif';
        ctx.fillText(cena[1], 80, 290);
        ctx.font = '20px Consolas, monospace';
        ctx.fillText('frame ' + n + ' · https://app.exemplo.com', 80, 360);
        n++;
        requestAnimationFrame(draw);
      };
      draw();
      return c.captureStream(8);
    };
  });

  try {
    await pagina.goto(BASE + '/', { waitUntil: 'load' });
    await delay(800);
    const splash = await pagina.$('#entrarSite');
    if (splash) { await splash.click(); await delay(900); }

    await pagina.waitForSelector('[data-acao="novoProjeto"]', { visible: true });
    await pagina.click('[data-acao="novoProjeto"]');
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.click('#campoNome', { clickCount: 3 });
    await pagina.type('#campoNome', 'Teste captura + vídeo', { delay: 30 });
    await pagina.click('#btnConfirmarModal');
    await delay(1000);

    await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await delay(600);
    await pagina.click('[data-acao="novaGravacao"]');
    await delay(800);

    await pagina.evaluate(() => {
      const set = (campo, valor) => {
        const el = document.querySelector('#ficha [data-campo="' + campo + '"]');
        if (!el) return;
        if (el.tagName === 'SELECT') el.value = valor;
        else el.textContent = valor;
      };
      set('registro', 'EV-GRAV-001');
      set('executor', 'Teste E2E');
      set('modulo', 'Login');
      set('ambiente', 'Homologação');
      set('tipo', 'Funcional');
      set('resultado', 'Aprovado');
      set('observacoes', 'Teste completo: alteração de tela + vídeo + descrição do passo.');
    });

    await pagina.click('.aba-captura[data-modo="alteracao"]');
    await pagina.evaluate(() => {
      const v = document.getElementById('gravarVideo');
      if (v) v.checked = true;
      const s = document.getElementById('sensibilidade');
      if (s) s.value = '0.8';
    });

    console.log('Iniciando gravação (tela + vídeo)...');
    await pagina.click('#btnIniciar');

    const gravando = await esperar(pagina, async () => {
      const est = await pagina.$eval('#rotEstado', el => el.textContent).catch(() => '');
      return est === 'Gravando';
    }, 15000);

    if (!gravando) {
      const est = await pagina.$eval('#rotEstado', el => el.textContent).catch(() => '?');
      throw new Error('Não entrou em Gravando. Estado: ' + est);
    }

    console.log('Gravando. Aguardando capturas automáticas...');
    const temPassos = await esperar(pagina, async () => {
      const n = await pagina.$$eval('#lista .passo', els => els.length);
      return n >= 3;
    }, 25000);

    const qtd = await pagina.$$eval('#lista .passo', els => els.length);
    const titulos = await pagina.$$eval('#lista .passo .titulo', els => els.map(e => e.textContent.trim()).filter(Boolean));
    console.log('Passos capturados: ' + qtd);
    titulos.slice(0, 8).forEach((t, i) => console.log('  ' + (i + 1) + '. ' + t));
    if (!temPassos) throw new Error('Poucas capturas automáticas: ' + qtd);

    await delay(5000);
    console.log('Parando gravação...');
    await pagina.click('#btnParar');
    await esperar(pagina, async () => {
      const est = await pagina.$eval('#rotEstado', el => el.textContent).catch(() => '');
      return est === 'Parado';
    }, 8000);
    await delay(2000);

    const temVideo = await pagina.$('#videoAtual video');
    console.log('Vídeo na sessão: ' + (temVideo ? 'sim' : 'não'));

    await pagina.screenshot({ path: path.join(SAIDA, 'demo-gravacao-passos.png'), fullPage: true });

    console.log('Salvando no projeto...');
    await pagina.click('[data-acao="salvar"]');
    await delay(1200);
    const modalAberto = await pagina.$('#fundoConfirma.aberto');
    if (modalAberto) {
      const txtModal = await pagina.$eval('#textoConfirma', el => el.textContent).catch(() => '');
      const titModal = await pagina.$eval('#tituloConfirma', el => el.textContent).catch(() => '');
      console.log('Modal: ' + titModal + ' — ' + String(txtModal).slice(0, 200));
      await pagina.click('#fundoConfirma.aberto #btnSim').catch(() => {});
      await delay(1500);
    }

    const salvou = await esperar(pagina, async () => {
      const tela = await pagina.$eval('.tela.ativa', el => el.id).catch(() => '');
      const abrir = await pagina.$('#listaRegistros [data-abrir]');
      return tela === 'telaProjeto' && !!abrir;
    }, 20000);

    if (!salvou) {
      console.warn('Não arquivou o registro (vídeo pode ter estourado o IndexedDB). Capturas + vídeo já estão na tela para inspeção.');
      console.log('Chrome fica aberto 90s para você ver a gravação.');
      await delay(90000);
      return;
    }

    await pagina.click('#listaRegistros [data-abrir]');
    await delay(1500);
    await pagina.screenshot({ path: path.join(SAIDA, 'demo-gravacao-registro.png'), fullPage: true });

    const videoRegistro = await pagina.$('#conteudoRegistro video');
    const passosReg = await pagina.$$eval('#conteudoRegistro .passo', els => els.length).catch(() => 0);
    console.log('Registro: ' + passosReg + ' passo(s) · vídeo=' + (videoRegistro ? 'sim' : 'não'));

    if (info.cenarios) {
      console.log('Gerando cenários NVIDIA a partir das capturas...');
      await pagina.waitForSelector('[data-acao="gerarCenariosIA"]', { visible: true });
      await pagina.click('[data-acao="gerarCenariosIA"]');
      const gerou = await esperar(pagina, async () => {
        const txt = await pagina.$eval('#caixaCenarios', el => el.hidden ? '' : el.innerText).catch(() => '');
        return /Funcionalidade:|# language: pt|Passo:\s*1/.test(txt);
      }, 120000, 800);
      const gherkin = await pagina.$eval('#textoGherkin', el => el.textContent).catch(() => '');
      const mapa = await pagina.$eval('#textoMapeamento', el => el.textContent).catch(() => '');
      const estado = await pagina.$eval('#estadoCenarios', el => el.textContent).catch(() => '');
      console.log('Cenários: ' + (gerou ? 'ok' : 'falhou') + ' · ' + estado);
      if (gherkin) {
        fs.writeFileSync(path.join(SAIDA, 'demo-gravacao-gherkin.txt'), gherkin, 'utf8');
        console.log('\n--- GHERKIN ---\n' + gherkin.slice(0, 1200) + '\n');
      }
      if (mapa) {
        fs.writeFileSync(path.join(SAIDA, 'demo-gravacao-mapeamento.txt'), mapa, 'utf8');
        console.log('--- MAPEAMENTO ---\n' + mapa.slice(0, 1200) + '\n');
      }
      await pagina.screenshot({ path: path.join(SAIDA, 'demo-gravacao-cenarios.png'), fullPage: true });
    }

    console.log('Chrome fica aberto 90s para você ver.');
    await delay(90000);
  } catch (err) {
    console.error('FALHOU: ' + err.message);
    try { await pagina.screenshot({ path: path.join(SAIDA, 'demo-gravacao-falha.png'), fullPage: true }); } catch (e) {}
    console.log('Chrome fica aberto 45s...');
    await delay(45000);
    process.exitCode = 1;
  } finally {
    await navegador.close().catch(() => {});
  }
})();
