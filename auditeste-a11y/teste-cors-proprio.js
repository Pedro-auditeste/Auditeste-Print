/* Trava o bug real de producao: PONTE_ORIGENS desatualizada nao pode
 * bloquear o Print chamando ele mesmo.
 *
 * Reproduz exatamente o que aconteceu: o servico no ar tinha PONTE_ORIGENS
 * apontando para um ambiente antigo (audiprint.up.railway.app), e o
 * navegador chamando o proprio host (audi-print-production...) recebia
 * "Access-Control-Allow-Origin: null" e travava.
 *
 *   node teste-cors-proprio.js
 */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

const PORTA = 8993;
const BASE = 'http://127.0.0.1:' + PORTA;
const HOST_DAQUI = 'audi-print-production.up.railway.app';   // quem esta respondendo
const ORIGEM_ANTIGA = 'https://audiprint.up.railway.app';    // o que ficou esquecido em PONTE_ORIGENS
const ORIGEM_HOSTIL = 'https://site-qualquer.example';       // terceiro nao relacionado

let n = 0;
const caso = (nome, ok) => { assert.ok(ok, nome); n++; console.log('  ok   ' + nome); };

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA), HOST: '0.0.0.0',
      COFRE_BANCO: ':memory:', AGENTE_API_KEY: '', PONTE_TOKEN: '',
      // o cenario real: RAILWAY_PUBLIC_DOMAIN e' o proprio host, mas
      // PONTE_ORIGENS ficou apontando so para o ambiente antigo
      RAILWAY_PUBLIC_DOMAIN: HOST_DAQUI,
      PONTE_ORIGENS: ORIGEM_ANTIGA,
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.resume(); proc.stderr.resume();

  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/ping'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }

  try {
    const pedir = origem => fetch(BASE + '/ping', { headers: { Origin: origem } });

    const proprio = await pedir('https://' + HOST_DAQUI);
    caso('CRITERIO: o proprio host e liberado mesmo fora de PONTE_ORIGENS',
      proprio.headers.get('access-control-allow-origin') === 'https://' + HOST_DAQUI);

    const antiga = await pedir(ORIGEM_ANTIGA);
    caso('a origem que ESTA na lista continua liberada',
      antiga.headers.get('access-control-allow-origin') === ORIGEM_ANTIGA);

    const hostil = await pedir(ORIGEM_HOSTIL);
    caso('CRITERIO: origem de fora, sem relacao nenhuma, continua bloqueada',
      hostil.headers.get('access-control-allow-origin') === 'null');

    console.log('\n' + n + ' casos, tudo certo\n');
  } finally {
    proc.kill();
  }
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
