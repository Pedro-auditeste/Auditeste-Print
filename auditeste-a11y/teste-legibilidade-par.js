/* Mede se o modelo LE o texto do par montado pelo Print.
 *
 *   node teste-legibilidade-par.js
 *
 * Usa a NVIDIA e gasta cota, então fica fora da suíte sem rede. Existe porque
 * "melhorei a imagem" sem medir é achismo: a versão lado a lado lia 1 de 4 e
 * chegava a trocar 1.765,98 por 1.705,98.
 */
require('./carregar-env.js').carregarEnvs();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { caminhoChrome } = require('./a11y.js');

const CHAVE = process.env.AGENTE_API_KEY;
const BASE = (process.env.AGENTE_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
const MODELO = process.env.AGENTE_MODELO || 'meta/llama-3.2-11b-vision-instruct';

/* Texto miúdo e específico: é o primeiro a sumir quando a imagem encolhe. */
const tela = (titulo, cor) => `<body style="margin:0;font:14px system-ui;background:${cor};width:1366px">
  <div style="background:#0d3446;color:#fff;padding:10px 16px;font-size:13px">
    Pedido <b>AB-4471-XZ</b> &nbsp;·&nbsp; Entrega 14/08
  </div>
  <h1 style="padding:14px 16px;font-size:22px;margin:0">${titulo}</h1>
  <div style="padding:0 16px">
    <button id="btnConfirmarPedido" style="font-size:13px;padding:8px 14px">Confirmar pedido</button>
    <p style="font-size:12px;color:#444;max-width:900px">
      Frete calculado para o CEP 04538-133. Rastreio em até 48 horas úteis.
    </p>
    <table style="font-size:12px;border-collapse:collapse">
      <tr><td style="padding:3px 10px;border:1px solid #ccc">Subtotal</td>
          <td style="padding:3px 10px;border:1px solid #ccc">R$ 1.765,98</td></tr>
    </table>
  </div>
</body>`;

const PERGUNTAS = [
  { p: 'Qual é o número do pedido escrito na faixa escura?', ok: /AB-?4471-?XZ/i },
  { p: 'Qual é o CEP citado no parágrafo?', ok: /04538-?133/ },
  { p: 'Qual o valor do Subtotal?', ok: /1\.?765,98/ },
  { p: 'Qual o texto exato do botão?', ok: /confirmar pedido/i },
  { p: 'O que está escrito na faixa do TOPO da imagem?', ok: /1\s*antes/i },
  { p: 'O que está escrito na faixa do MEIO da imagem?', ok: /2\s*depois/i }
];

async function perguntar(imagem, pergunta) {
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + CHAVE, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO, max_tokens: 60, temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: pergunta + ' Responda só o valor, sem explicar.' },
          { type: 'image_url', image_url: { url: imagem } }
        ]
      }]
    }),
    signal: AbortSignal.timeout(90000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('NVIDIA HTTP ' + r.status);
  return String(d.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim();
}

(async () => {
  if (!CHAVE) { console.log('PULADO: sem AGENTE_API_KEY.'); return; }

  // A função real do Print, não uma cópia.
  const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
  const m = /  async function montarParAntesDepois\(blobAntes, blobDepois\)\{[\s\S]*?\n  \}/.exec(html);
  assert.ok(m, 'não achei montarParAntesDepois no index.html');

  const nav = await puppeteer.launch({ executablePath: caminhoChrome(), headless: true, args: ['--no-sandbox'] });
  const p = await nav.newPage();
  await p.setViewport({ width: 1366, height: 460 });
  await p.setContent(tela('Confirmação do pedido', '#ffffff'));
  const antes = await p.screenshot({ type: 'png', encoding: 'base64' });
  await p.setContent(tela('Pedido confirmado', '#eef7ff'));
  const depois = await p.screenshot({ type: 'png', encoding: 'base64' });

  const pagina = await nav.newPage();
  await pagina.setContent('<body></body>');
  const par = await pagina.evaluate(async ({ fonte, a, b }) => {
    const montar = new Function('return ' + fonte.replace(/^\s*async function montarParAntesDepois/, 'async function'))();
    const paraBlob = (b64) => fetch('data:image/png;base64,' + b64).then((r) => r.blob());
    return montar(await paraBlob(a), await paraBlob(b));
  }, { fonte: m[0], a: antes, b: depois });
  await nav.close();

  assert.ok(par && par.startsWith('data:image/jpeg'), 'o par não foi montado');
  const kb = Math.round(par.length * 0.75 / 1024);

  let acertos = 0;
  for (const q of PERGUNTAS) {
    const r = await perguntar(par, q.p);
    const ok = q.ok.test(r);
    if (ok) acertos++;
    console.log('  ' + (ok ? 'OK  ' : 'ERRO') + '  ' + q.p.slice(0, 48).padEnd(50) + r.slice(0, 34));
  }

  console.log('\n  par de ' + kb + ' KB  ·  ' + acertos + '/' + PERGUNTAS.length + ' leituras corretas');
  // Lado a lado marcava 1/4. Menos de 4/6 significa que a legibilidade regrediu.
  assert.ok(acertos >= 4, 'leitura piorou: ' + acertos + '/' + PERGUNTAS.length);
  console.log('\nRESULTADO: PASSOU');
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
