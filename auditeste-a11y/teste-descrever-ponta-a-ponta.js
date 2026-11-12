/* Prova que /descrever responde de verdade, com print real e token.
 *
 *   PONTE_URL=https://audiprint.up.railway.app PONTE_TOKEN=... node teste-descrever-ponta-a-ponta.js
 *
 * Gasta uma chamada da NVIDIA. Nao roda junto com os testes sem rede.
 */
const puppeteer = require('puppeteer');

const BASE = (process.env.PONTE_URL || 'http://127.0.0.1:8900').replace(/\/+$/, '');
const TOKEN = process.env.PONTE_TOKEN || '';

const alvo = process.env.URL_ALVO || BASE + '/';

(async () => {
  console.log('Tirando dois prints reais de ' + alvo + ' ...');
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pagina = await nav.newPage();
  await pagina.setViewport({ width: 1280, height: 800 });
  await pagina.goto(alvo, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const tirar = async () => 'data:image/jpeg;base64,'
    + await pagina.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' });

  const antes = await tirar();
  // Mexe na tela para o "depois" ser mesmo diferente do "antes".
  await pagina.evaluate(() => {
    const b = document.querySelector('#entrarSite');
    if (b) b.click(); else window.scrollBy(0, 400);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const depois = await tirar();
  await nav.close();

  console.log('antes: ' + Math.round(antes.length / 1024) + ' KB · depois: '
    + Math.round(depois.length / 1024) + ' KB');

  const cab = { 'Content-Type': 'application/json' };
  if (TOKEN) cab.Authorization = 'Bearer ' + TOKEN;

  console.log('Chamando ' + BASE + '/descrever ...');
  const inicio = Date.now();
  const resp = await fetch(BASE + '/descrever', {
    method: 'POST',
    headers: cab,
    body: JSON.stringify({
      imagem: depois,
      antes,
      elemento: '#entrarSite',
      rotulo: 'Entrar',
      urlAntes: alvo,
      urlDepois: alvo,
      tipoTeste: 'Funcional'
    }),
    signal: AbortSignal.timeout(120000)
  });

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  const dados = await resp.json().catch(() => ({}));
  console.log('HTTP ' + resp.status + ' em ' + segundos + 's\n');

  if (!resp.ok) {
    console.log('FALHOU: ' + (dados.erro || 'sem corpo'));
    process.exit(1);
  }

  for (const campo of ['titulo', 'obs', 'legenda_curta', 'descricao_detalhada', 'gherkin', 'alerta_qa']) {
    const v = dados[campo];
    if (v) console.log(campo + ':\n  ' + String(v).replace(/\n/g, '\n  ') + '\n');
  }
  if (Array.isArray(dados.cenarios_alternativos) && dados.cenarios_alternativos.length) {
    console.log('cenarios_alternativos:\n  - ' + dados.cenarios_alternativos.join('\n  - ') + '\n');
  }

  const texto = String(dados.obs || dados.descricao_detalhada || '');
  if (!texto) { console.log('RESULTADO: FALHOU (veio sem descricao)'); process.exit(1); }
  if (/ Depois:/.test(texto) && !/\.\s+Depois:/.test(texto)) {
    console.log('RESULTADO: FALHOU (frase emendada antes de "Depois:")');
    process.exit(1);
  }
  console.log('RESULTADO: PASSOU');
})().catch((e) => { console.error('ERRO: ' + e.message); process.exit(1); });
