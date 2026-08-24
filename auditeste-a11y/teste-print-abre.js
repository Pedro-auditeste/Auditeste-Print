/* Fumaca: o Print abre sem erro de JS e com as pecas essenciais.
 *
 *   node teste-print-abre.js
 *
 * Pega regressao de remocao — foi assim que descobri que um corte largo demais
 * tinha levado a busca de projetos junto.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ESSENCIAIS = [
  'campoBusca', 'gradeProjetos', 'listaRegistros', 'blocoRecentes', 'recentes',
  'semResultado', 'btnIniciar', 'btnCapturar', 'btnPausar', 'btnParar',
  'telaGravador', 'statusIA', 'gravarVideo'
];

(async () => {
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await nav.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  /* Ping na ponte falha quando ela nao esta rodando, e isso nao e erro da
   * pagina — o teste passava so porque havia uma ponte no ar por acaso. */
  const ruidoDeRede = (txt) => /ERR_CONNECTION_REFUSED|Failed to load resource|net::ERR/i.test(txt);
  p.on('console', (m) => {
    if (m.type() === 'error' && !ruidoDeRede(m.text())) erros.push(m.text());
  });

  await p.goto(pathToFileURL(path.join(__dirname, 'publico', 'index.html')).href,
    { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  const r = await p.evaluate((ids) => {
    const loja = document.getElementById('lojaExtensao');
    /* Simula o complemento se anunciando: os dois convites para instalar
     * precisam sumir juntos, senao quem ja instalou continua sendo mandado
     * instalar de novo. */
    // '*' e nao location.origin: aberta por file:// a origem e a string
    // "null", e postMessage com esse alvo nao entrega a mensagem.
    window.postMessage({ tipo: 'AUDI_EXTENSAO_PRESENTE' }, '*');
    return {
      faltando: ids.filter((id) => !document.getElementById(id)),
      telas: document.querySelectorAll('.tela').length,
      rotuloIniciar: (document.getElementById('btnIniciar') || {}).textContent,
      sobrouTesteAutomatico: !!document.querySelector(
        '#urlTesteIa, #urlTesteIaHome, #urlTesteIaProjeto, .caixa-link, #estadoTesteIa'
      ),
      lojaHref: loja ? loja.getAttribute('href') : null,
      lojaAlvo: loja ? loja.getAttribute('target') : null,
      lojaRel: loja ? loja.getAttribute('rel') : null
    };
  }, ESSENCIAIS);

  await new Promise((espera) => setTimeout(espera, 300));
  const esconderam = await p.evaluate(() =>
    ['lojaExtensao', 'btnBaixarExtensao'].filter((id) => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    }));

  await nav.close();
  console.log(JSON.stringify(r, null, 2));
  console.log('erros de JS: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  console.log('loja: ' + r.lojaHref);

  assert.deepStrictEqual(r.faltando, [], 'sumiram elementos essenciais');
  assert.ok(r.telas >= 3, 'faltam telas: ' + r.telas);
  // O que importa: nao promete teste automatico, e diz que e a tela.
  assert.ok(!/teste/i.test(r.rotuloIniciar), 'botão ainda fala em teste: ' + r.rotuloIniciar);
  assert.match(r.rotuloIniciar, /grav/i, 'botão não fala em gravar: ' + r.rotuloIniciar);
  assert.strictEqual(r.sobrouTesteAutomatico, false, 'sobrou peça do teste automático');
  assert.strictEqual(erros.length, 0, 'a página deu erro de JS');

  /* O id da extensao publicada. Errar um caractere manda todo mundo para uma
   * pagina de "nao encontrado" na Chrome Web Store, e ninguem descobre pelo
   * codigo: o botao continua bonito e continua clicavel. */
  assert.strictEqual(r.lojaHref,
    'https://chromewebstore.google.com/detail/nllfmnhjlgchmenpnanjkdiojgkikfln',
    'o link da loja mudou ou saiu: ' + r.lojaHref);
  assert.strictEqual(r.lojaAlvo, '_blank', 'o link da loja tira o QA da gravação em andamento');
  assert.match(String(r.lojaRel), /noopener/, 'link externo sem noopener');
  assert.deepStrictEqual(esconderam, [],
    'com o complemento instalado, ainda sobrou convite para instalar: ' + esconderam.join(', '));

  console.log('\nRESULTADO: PASSOU');
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
