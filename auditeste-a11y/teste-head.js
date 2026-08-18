/* Validador de URL checa por HEAD. Responder 404 nele fez a Chrome Web Store
 * recusar a ficha com "não é possível acessar o URL de suporte".
 *
 *   node teste-head.js
 */
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const PORTA = 8977;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function pedir(metodo, caminho) {
  return new Promise((ok, erro) => {
    const req = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => ok({ status: res.statusCode, tipo: res.headers['content-type'] || '', corpo }));
    });
    req.on('error', erro);
    req.end();
  });
}

(async () => {
  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(3500);
  try {
    for (const caminho of ['/', '/privacidade.html', '/index.html']) {
      const h = await pedir('HEAD', caminho);
      assert.strictEqual(h.status, 200, 'HEAD ' + caminho + ' devolveu ' + h.status);
      assert.match(h.tipo, /text\/html/, 'HEAD ' + caminho + ' sem Content-Type de HTML');
      assert.strictEqual(h.corpo, '', 'HEAD não pode trazer corpo');
      const g = await pedir('GET', caminho);
      assert.strictEqual(g.status, 200, 'GET ' + caminho + ' devolveu ' + g.status);
      assert.ok(g.corpo.length > 500, 'GET ' + caminho + ' veio vazio');
      console.log('  OK   ' + caminho.padEnd(20) + ' HEAD 200 sem corpo, GET 200 com ' + g.corpo.length + ' bytes');
    }
    const nada = await pedir('HEAD', '/nao-existe.html');
    assert.strictEqual(nada.status, 404, 'HEAD em arquivo ausente deveria ser 404');
    console.log('  OK   arquivo ausente         HEAD 404');
    console.log('\nRESULTADO: PASSOU');
  } finally {
    ponte.kill();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
