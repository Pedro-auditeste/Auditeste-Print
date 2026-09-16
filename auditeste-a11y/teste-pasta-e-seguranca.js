/* Pasta de destino e pagina publica de seguranca, no Chrome de verdade.
 *
 *   node teste-pasta-e-seguranca.js
 *
 * A pasta usada aqui e real: o armazenamento privado de arquivos do Chrome
 * devolve o MESMO tipo de objeto que o seletor de pasta devolve. O que nao da
 * para automatizar e o dialogo do sistema operacional, entao so ele e trocado:
 * a escrita, a permissao, a gravacao do identificador no banco local e a
 * leitura do arquivo depois sao todas de verdade.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORTA = 8986;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-pasta-')), 'cofre.db');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XbY4WQAAAABJRU5ErkJggg==';

const EVIDENCIA = {
  formato: 'audi-print-evidencia-v1',
  url: 'https://exemplo.test/login',
  titulo: 'Exemplo',
  passos: [{
    titulo: 'Clicou em "Entrar"', obs: '', acao: 'Clicar',
    elemento: '//*[@id="btn-entrar"]', rotulo: 'Entrar',
    html: '<button id="btn-entrar">Entrar</button>',
    urlAntes: 'https://exemplo.test/login', urlDepois: 'https://exemplo.test/painel',
    imagens: [{ dataUrl: PIXEL, legenda: 'Antes' }, { dataUrl: PIXEL, legenda: 'Depois' }]
  }]
};

let falhas = 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function caso(nome, fn) {
  try { await fn(); console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO,
      COFRE_SEGREDO: 'segredo-pasta', AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: 'ignore'
  });
  let navegador = null;
  try {
    for (let i = 0; ; i++) {
      try { const r = await fetch(BASE + '/ping'); if (r.ok) break; } catch (e) { /* subindo */ }
      if (i > 120) throw new Error('o servidor não subiu');
      await delay(250);
    }

    navegador = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const pagina = await navegador.newPage();
    const erros = [];
    pagina.on('pageerror', e => erros.push(e.message));
    // Na segunda gravacao o Print pergunta qual trazer: responde como a pessoa.
    pagina.on('dialog', d => d.accept('1'));

    await pagina.evaluateOnNewDocument((evid) => {
      // So o dialogo do sistema e trocado: a pasta devolvida e real.
      window.showDirectoryPicker = async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('rede-da-empresa', { create: true });
      // Complemento de mentira, igual ao de teste-pares-ui.js.
      addEventListener('message', (ev) => {
        const d = ev.data;
        if (ev.source !== window || !d || d.tipo !== 'AUDI_PRINT_PEDE') return;
        const corpo = d.deTab == null
          ? { evidencias: [{ tabId: 7, url: evid.url, titulo: evid.titulo, inicio: new Date().toISOString(),
              ativa: false, encerrada: new Date().toISOString(), importada: false, passos: 1 }] }
          /* Passo novo a cada pedido: o Print descarta passo que ja trouxe
           * (chaveDoPasso), e a segunda gravacao do teste precisa de um novo. */
          : { evidencia: Object.assign({}, evid, { passos: evid.passos.map(p => Object.assign({}, p, {
              id: 'passo-' + Date.now() + '-' + Math.random(), timestampDepois: new Date().toISOString() })) }) };
        postMessage(Object.assign({ tipo: 'AUDI_PRINT_RESPONDE', pedido: d.pedido }, corpo), location.origin);
      });
    }, EVIDENCIA);

    console.log('\npasta de destino\n');

    await caso('o formulario do projeto mostra a pasta como recomendada', async () => {
      await pagina.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await pagina.click('#entrarSite');
      await pagina.waitForSelector('#telaProjetos.ativa');
      await pagina.click('[data-acao="novoProjeto"]');
      await pagina.waitForSelector('#campoNome', { visible: true });
      const nome = await pagina.$eval('#nomePasta', el => el.textContent);
      assert.ok(/só neste navegador/.test(nome), 'sem pasta deveria dizer que fica no navegador: ' + nome);
      const dica = await pagina.$eval('#dicaPasta', el => el.textContent);
      assert.ok(/Recomendado/.test(dica) && /rede/.test(dica), 'a dica tem de recomendar a rede: ' + dica);
    });

    await caso('escolher a pasta mostra o nome dela e libera "Não usar pasta"', async () => {
      await pagina.type('#campoNome', 'Projeto com pasta');
      await pagina.click('#btnEscolherPasta');
      await pagina.waitForFunction(() => /rede-da-empresa/.test(document.getElementById('nomePasta').textContent));
      assert.strictEqual(await pagina.$eval('#btnTirarPasta', el => el.hidden), false);
      await pagina.click('#btnConfirmarModal');
      await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
    });

    await caso('CRITERIO: a pasta sobrevive a recarregar a pagina', async () => {
      await pagina.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await pagina.click('#entrarSite');
      await pagina.waitForSelector('#gradeProjetos .cartao[data-projeto]');
      const nome = await pagina.evaluate(() => new Promise((ok, falha) => {
        const req = indexedDB.open('auditeste_evidencias');
        req.onerror = () => falha(req.error);
        req.onsuccess = () => {
          const t = req.result.transaction('projetos', 'readonly').objectStore('projetos').getAll();
          t.onsuccess = () => ok(t.result.map(p => p.pasta && p.pasta.name).filter(Boolean));
        };
      }));
      assert.deepStrictEqual(nome, ['rede-da-empresa'], 'o projeto perdeu a pasta: ' + JSON.stringify(nome));
    });

    await caso('CRITERIO: salvar a evidencia grava o HTML dela dentro da pasta', async () => {
      await pagina.click('#gradeProjetos .cartao[data-projeto]');
      await pagina.waitForSelector('[data-acao="novaGravacao"]');
      await pagina.evaluate(() => { document.getElementById('capturarPrintsPasso').checked = true; });
      await pagina.click('[data-acao="novaGravacao"]');
      await pagina.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
      await pagina.click('[data-acao="puxarExtensao"]');
      await pagina.waitForSelector('.passo .imagens figure', { timeout: 15000 });
      await pagina.click('[data-acao="salvar"]');
      await pagina.waitForFunction(
        () => /gravada na pasta rede-da-empresa\//.test(document.querySelector('.aviso-toast .aviso-texto')?.textContent || ''),
        { timeout: 20000 });

      const achado = await pagina.evaluate(async () => {
        const raiz = await (await navigator.storage.getDirectory()).getDirectoryHandle('rede-da-empresa');
        const subpastas = [];
        for await (const [nome, h] of raiz.entries()) if (h.kind === 'directory') subpastas.push(nome);
        const dir = await raiz.getDirectoryHandle(subpastas[0]);
        const html = await (await (await dir.getFileHandle('evidencia.html')).getFile()).text();
        return { subpastas, tamanho: html.length,
          temPasso: html.includes('Entrar'), temImagem: html.includes('data:image') };
      });
      assert.strictEqual(achado.subpastas.length, 1, 'esperava 1 subpasta: ' + achado.subpastas);
      assert.ok(/^EVD-\d{8}-\d{3}$/.test(achado.subpastas[0]), 'a subpasta devia ter o nome do registro: ' + achado.subpastas[0]);
      assert.ok(achado.temPasso, 'o HTML gravado nao tem o passo');
      assert.ok(achado.temImagem, 'o HTML gravado nao tem os prints embutidos');
    });

    await caso('sem permissao na pasta, a evidencia salva e a pessoa e avisada', async () => {
      /* Simula a TI tirando o acesso: a pasta recusa escrita. O registro no
       * navegador nao pode se perder por causa da copia. */
      await pagina.evaluate(() => {
        FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new Error('acesso negado pela rede'));
      });
      await pagina.waitForSelector('[data-acao="novaGravacao"]');
      // A opcao de print nasce desmarcada a cada gravacao nova.
      await pagina.evaluate(() => { document.getElementById('capturarPrintsPasso').checked = true; });
      await pagina.click('[data-acao="novaGravacao"]');
      await pagina.waitForSelector('[data-acao="puxarExtensao"]:not([hidden])');
      await pagina.click('[data-acao="puxarExtensao"]');
      await pagina.waitForSelector('.passo .imagens figure', { timeout: 15000 });
      await delay(2500); // deixa a importacao terminar os avisos dela
      await pagina.click('[data-acao="salvar"]');
      await pagina.waitForFunction(() => /não foi gravada: acesso negado pela rede/.test(
        document.querySelector('.fundo-modal.aberto')?.innerText || ''), { timeout: 20000 });
      const registros = await pagina.evaluate(() => new Promise(ok => {
        const req = indexedDB.open('auditeste_evidencias');
        req.onsuccess = () => {
          const t = req.result.transaction('registros', 'readonly').objectStore('registros').count();
          t.onsuccess = () => ok(t.result);
        };
      }));
      assert.strictEqual(registros, 2, 'a segunda evidencia devia estar salva no navegador mesmo sem a pasta');
    });

    console.log('\npagina publica de seguranca\n');

    await caso('a pagina mostra o estado vivo que o servidor informa, sem inventar verde', async () => {
      const ping = await (await fetch(BASE + '/ping')).json();
      await pagina.goto(BASE + '/seguranca.html', { waitUntil: 'domcontentloaded' });
      await pagina.waitForFunction(() => document.querySelectorAll('#agoraLista li').length === 3);
      const classes = await pagina.$$eval('#agoraLista li', els => els.map(e => e.className));
      assert.deepStrictEqual(classes, [
        'nao',                                           // aqui e http, sem HTTPS
        ping.cifra === true ? 'ok' : 'nao',
        ping.cofre === true && ping.semVolume === false ? 'ok' : 'nao'
      ], 'a pagina divergiu do /ping: ' + JSON.stringify(classes));
    });

    await caso('a pagina nao cita IA em nenhum texto visivel', async () => {
      const texto = await pagina.evaluate(() => document.body.innerText);
      assert.ok(!/\bI\.?A\b|NVIDIA|intelig[êe]ncia artificial|\bGPT\b|llama/i.test(texto), 'citou IA na tela');
    });

    await caso('o login do cofre e a politica de privacidade levam a pagina', async () => {
      for (const p of ['/cofre.html', '/privacidade.html']) {
        await pagina.goto(BASE + p, { waitUntil: 'domcontentloaded' });
        assert.ok(await pagina.$('a[href="/seguranca.html"]'), p + ' sem link para /seguranca.html');
      }
    });

    await caso('nenhum erro de script', async () => {
      assert.deepStrictEqual(erros, []);
    });
  } catch (e) {
    falhas++;
    console.error('FALHOU:', e.message);
  } finally {
    if (navegador) await navegador.close().catch(() => {});
    proc.kill();
    console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (9 casos)\n');
    process.exit(falhas ? 1 : 0);
  }
})();
