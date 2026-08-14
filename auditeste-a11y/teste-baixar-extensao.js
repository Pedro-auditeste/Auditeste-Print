/* Baixa a extensão pela rota, descompacta e carrega num Chrome de verdade.
 *
 *   node teste-baixar-extensao.js
 *
 * Zip que abre não prova nada: o que vale é o Chrome aceitar o pacote.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORTA = 8976;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function baixar(url, destino) {
  return new Promise((ok, erro) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) return erro(new Error('HTTP ' + res.statusCode));
      const cab = {
        tipo: res.headers['content-type'],
        nome: res.headers['content-disposition']
      };
      const arq = fs.createWriteStream(destino);
      res.pipe(arq);
      arq.on('finish', () => arq.close(() => ok(cab)));
    }).on('error', erro);
  });
}

(async () => {
  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(3500);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audi-ext-'));
  const zip = path.join(tmp, 'ext.zip');
  const pasta = path.join(tmp, 'extensao');
  let nav = null;

  try {
    const cab = await baixar(`http://127.0.0.1:${PORTA}/extensao.zip`, zip);
    assert.match(cab.tipo, /zip/, 'Content-Type não é zip: ' + cab.tipo);
    assert.match(cab.nome || '', /attachment/, 'não veio como download');
    const kb = Math.round(fs.statSync(zip).size / 1024);
    assert.ok(kb > 100, 'zip pequeno demais: ' + kb + ' KB');
    console.log('  OK   baixou (' + kb + ' KB, ' + cab.tipo + ')');

    // Descompacta com o proprio Windows: é o que o QA vai fazer.
    fs.mkdirSync(pasta, { recursive: true });
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pasta}' -Force`]);
    const dentro = fs.readdirSync(pasta);
    assert.ok(dentro.includes('manifest.json'), 'sem manifest.json: ' + dentro.join(', '));
    console.log('  OK   descompactou (' + dentro.length + ' arquivos)');

    const manifesto = JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8'));
    assert.strictEqual(manifesto.manifest_version, 3, 'manifest_version inesperada');
    for (const arq of [manifesto.background.service_worker, ...manifesto.content_scripts[0].js]) {
      assert.ok(fs.existsSync(path.join(pasta, arq)), 'faltou no pacote: ' + arq);
    }
    console.log('  OK   manifest aponta só para arquivos presentes');

    // A prova: o Chrome carrega o que foi baixado.
    nav = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', `--disable-extensions-except=${pasta}`, `--load-extension=${pasta}`]
    });
    let sw = null;
    for (let i = 0; i < 40 && !sw; i++) {
      sw = nav.targets().find((t) => t.type() === 'service_worker'
        && t.url().startsWith('chrome-extension://'));
      if (!sw) await esperar(250);
    }
    assert.ok(sw, 'o Chrome não carregou a extensão baixada');
    console.log('  OK   Chrome carregou a extensão: ' + new URL(sw.url()).host);

    console.log('\nRESULTADO: PASSOU');
  } finally {
    if (nav) await nav.close().catch(() => {});
    ponte.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
