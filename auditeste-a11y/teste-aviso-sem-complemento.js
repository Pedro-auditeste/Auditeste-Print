/* Gravar sem o complemento respondendo avisa na tela, em vez de cair calado
 * para o print sem xpath, sem id e sem HTML.
 *
 *   node teste-aviso-sem-complemento.js
 *
 * Sem rede e sem complemento de verdade: o que o complemento responderia é
 * simulado por postMessage na própria página, que é o canal que ele usa.
 *
 * O caso que motivou: na máquina de quem tinha acabado de instalar o
 * complemento, a gravação saía só com o print da tela e a barra continuava
 * dizendo "cada interação vira um passo com xpath e id".
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const PORTA = 8996;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aviso-complemento-')), 'cofre.db');
const delay = ms => new Promise(r => setTimeout(r, ms));

let falhas = 0, feitos = 0;
async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n').join('\n           ')); }
}

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO,
      COFRE_SEGREDO: 'segredo-aviso', AGENTE_API_KEY: '', PONTE_TOKEN: '' }),
    stdio: 'ignore'
  });
  let nav;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(BASE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o servidor nao subiu');
      await delay(250);
    }
    nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1280, height: 800 });
    await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    // Sair da tela com gravação aberta pergunta antes: aqui a resposta é sempre sim.
    pg.on('dialog', d => d.accept().catch(() => {}));

    /* Antes de qualquer script do Print: a "tela compartilhada" é um canvas, e
     * o complemento simulado responde (ou não) conforme window.__complemento. */
    await pg.evaluateOnNewDocument(() => {
      window.__complemento = 'ausente';
      window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || d.tipo !== 'AUDI_PRINT_PEDE') return;
        const responder = (corpo) => window.postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
        if (window.__complemento === 'vivo') responder({ ok: true, armado: true });
        if (window.__complemento === 'orfa-e-nova') {
          responder({ erro: 'Extension context invalidated.' });      // a cópia antiga responde primeiro
          setTimeout(() => responder({ ok: true, armado: true }), 150); // a nova, logo depois
        }
      });
      document.addEventListener('DOMContentLoaded', () => {
        const c = document.createElement('canvas');
        c.width = 640; c.height = 360;
        const g = c.getContext('2d');
        setInterval(() => { g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 360); }, 200);
        navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(8);
      });
    });

    const abrirGravador = async (modo) => {
      await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(700);
      if (await pg.$eval('#entrarSite', el => el.offsetParent !== null).catch(() => false)) await pg.click('#entrarSite');
      await pg.waitForSelector('[data-acao="novoProjeto"]', { visible: true });
      if (!(await pg.$('#gradeProjetos .cartao[data-projeto]'))) {
        await pg.click('[data-acao="novoProjeto"]');
        await pg.waitForSelector('#campoNome', { visible: true });
        await pg.type('#campoNome', 'Projeto do aviso');
        await pg.click('#btnConfirmarModal');
        await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]', { visible: true });
      }
      await delay(400);
      await pg.click('#gradeProjetos .cartao[data-projeto]');
      await pg.waitForSelector('[data-acao="novaGravacao"]', { visible: true });
      await pg.click('[data-acao="novaGravacao"]');
      await pg.waitForSelector('#btnIniciar', { visible: true });
      await pg.evaluate((m) => { window.__complemento = m; }, modo);
      await pg.click('#btnIniciar');
      await pg.waitForFunction(() => document.getElementById('barraRec').dataset.estado === 'gravando', { timeout: 8000 });
      await delay(3600);   // o pedido de armar espera a resposta por até 3 s
    };
    const tela = () => pg.evaluate(() => ({
      aviso: !document.getElementById('avisoSemComplemento').hidden,
      texto: document.getElementById('avisoSemComplemento').textContent,
      status: document.getElementById('statusIA').textContent
    }));

    console.log('\nGravar sem o complemento\n');

    await caso('complemento ausente: o aviso aparece e a barra para de prometer xpath e id', async () => {
      await abrirGravador('ausente');
      const t = await tela();
      assert.ok(t.aviso, 'o aviso não apareceu');
      assert.ok(/sem xpath, sem id e sem o HTML/.test(t.texto), 'o aviso não diz o que vai faltar: ' + t.texto);
      assert.ok(/recarregue/i.test(t.texto), 'o aviso não diz o que fazer');
      assert.ok(/só a tela/.test(t.status), 'a barra continua prometendo xpath e id: ' + t.status);
    });

    await caso('chegou um passo do complemento: o aviso some sozinho', async () => {
      await pg.evaluate(() => window.postMessage({ tipo: 'AUDI_PRINT_PASSO', origem: {},
        passo: { id: 'p1', titulo: 'Clicou em "Salvar"', acao: 'Clicar', rotulo: 'Salvar', elemento: '//*[@id="salvar"]',
          elementoId: 'salvar', html: '<button id="salvar">Salvar</button>', imagens: [] } }, location.origin));
      await delay(600);
      const t = await tela();
      assert.ok(!t.aviso, 'o aviso continuou na tela com o complemento gravando');
      assert.ok(/xpath e id/.test(t.status), 'a barra não voltou ao normal: ' + t.status);
    });

    await caso('complemento respondendo: nenhum aviso', async () => {
      await abrirGravador('vivo');
      const t = await tela();
      assert.ok(!t.aviso, 'avisou sem motivo');
      assert.ok(!/só a tela/.test(t.status), 'a barra diz que falta o complemento: ' + t.status);
    });

    await caso('complemento atualizado com a aba aberta: a cópia antiga responde erro antes, e vale a resposta da nova', async () => {
      await abrirGravador('orfa-e-nova');
      const t = await tela();
      assert.ok(!t.aviso, 'a resposta de erro da cópia antiga venceu a da nova');
    });
  } finally {
    if (nav) await nav.close();
    proc.kill();
    await delay(300);
  }
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (' + feitos + ' casos)\n');
  process.exit(falhas ? 1 : 0);
})().catch(err => { console.error('\nERRO GERAL: ' + err.message + '\n' + err.stack); process.exit(1); });
