/* CLI de acessibilidade da Auditeste.
 *
 *   node a11y.js axe   <url> [url...]    axe-core via Playwright
 *   node a11y.js pa11y <url> [url...]    Pa11y
 *   node a11y.js nota  <url> [url...]    Lighthouse (nota + relatorio)
 *
 * Cada comando grava um JSON em saida/, no formato nativo da ferramenta —
 * que e exatamente o que o Audi Print importa, sem conversao.
 */
const fs = require('fs');
const path = require('path');

const SAIDA = path.join(__dirname, 'saida');

const FLAGS_DOCKER = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

function chromeDoPlaywright() {
  const { chromium } = require('playwright');
  return chromium.executablePath();
}

function lancarChromium() {
  const { chromium } = require('playwright');
  return chromium.launch({ args: FLAGS_DOCKER });
}

function nomeArquivo(prefixo, url) {
  let host = 'pagina';
  try { host = new URL(url).hostname.replace(/^www\./, '') || 'pagina'; } catch (e) {}
  const t = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return path.join(SAIDA, `${prefixo}-${host}-${t}.json`);
}

function gravar(arquivo, dados) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
  return arquivo;
}

function contar(violations) {
  return violations.reduce((n, v) => n + (v.nodes ? v.nodes.length : 1), 0);
}

/* Espera a pagina assentar antes de medir.
   Em SPA o evento 'load' dispara com o esqueleto vazio: o axe media o
   HTML antes do JS montar a tela e acusava coisas falsas, tipo
   document-title ausente numa home de e-commerce. networkidle e best
   effort — site com analytics ou polling nunca fica ocioso, e ai o
   catch deixa seguir. */
async function assentar(pagina) {
  await pagina.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await pagina.waitForTimeout(1000);
}

/* Sites grandes barram navegador automatizado e servem uma pagina de erro.
   O scan roda, acha violacoes de verdade — daquela pagina de erro. Sem este
   aviso o laudo sairia descrevendo a tela errada. */
async function diagnosticar(pagina) {
  const info = await pagina.evaluate(() => ({
    titulo: document.title || '',
    texto: ((document.body && document.body.innerText) || '').trim().length
  }));
  if (!info.titulo && info.texto < 1500) {
    return 'ATENCAO: a pagina veio sem <title> e com pouquissimo conteudo. '
      + 'O site provavelmente bloqueou o navegador automatizado. O resultado '
      + 'descreve essa pagina de bloqueio, nao o site. Use a extensao no seu '
      + 'Chrome para casos assim.';
  }
  return null;
}

/* ---------- scanners: devolvem os dados, nao gravam nada ----------
   Separados da CLI de proposito: o servidor da ponte (servidor.js) usa
   estas funcoes direto e devolve o JSON para os botoes do Audi Print. */

async function scanAxe(url) {
  const mod = require('@axe-core/playwright');
  const AxeBuilder = mod.default || mod.AxeBuilder || mod;

  const navegador = await lancarChromium();
  try {
    /* AxeBuilder exige pagina vinda de um contexto explicito */
    const contexto = await navegador.newContext();
    const pagina = await contexto.newPage();
    await pagina.goto(url, { waitUntil: 'load', timeout: 60000 });
    await assentar(pagina);
    const aviso = await diagnosticar(pagina);
    const r = await new AxeBuilder({ page: pagina }).analyze();
    return { url, gerado: new Date().toISOString(), aviso, violations: r.violations };
  } finally {
    await navegador.close();
  }
}

async function scanPa11y(url) {
  const pa11y = require('pa11y');
  return await pa11y(url, {
    timeout: 60000,
    chromeLaunchConfig: {
      executablePath: chromeDoPlaywright(),
      args: FLAGS_DOCKER
    }
  });
}

async function scanLighthouse(url) {
  const chromeLauncher = await import('chrome-launcher');
  const { default: lighthouse } = await import('lighthouse');

  const chrome = await chromeLauncher.launch({
    chromePath: chromeDoPlaywright(),
    chromeFlags: ['--headless=new', ...FLAGS_DOCKER]
  });
  try {
    const r = await lighthouse(url, {
      port: chrome.port, output: 'json', onlyCategories: ['accessibility'], logLevel: 'error'
    });
    return r.lhr;
  } finally {
    /* no Windows o kill() estoura EPERM ao apagar o user-data-dir temporario,
       depois do relatorio ja estar gravado. Nao e motivo para falhar o scan. */
    try { await chrome.kill(); } catch (e) { /* o Temp do Windows limpa depois */ }
  }
}

/* ---------- CLI: chama o scanner e persiste ---------- */
async function comAxe(urls) {
  for (const url of urls) {
    const dados = await scanAxe(url);
    const arq = gravar(nomeArquivo('axe', url), dados);
    console.log(`axe  ${url}`);
    console.log(`     ${dados.violations.length} regra(s), ${contar(dados.violations)} elemento(s)  ->  saida/${path.basename(arq)}`);
    if (dados.aviso) console.log(`     ${dados.aviso}`);
  }
}

async function comPa11y(urls) {
  for (const url of urls) {
    const r = await scanPa11y(url);
    const arq = gravar(nomeArquivo('pa11y', url), r);
    const erros = r.issues.filter(i => i.type === 'error').length;
    console.log(`pa11y  ${url}`);
    console.log(`       ${r.issues.length} achado(s), ${erros} erro(s)  ->  saida/${path.basename(arq)}`);
  }
}

async function comLighthouse(urls) {
  for (const url of urls) {
    const lhr = await scanLighthouse(url);
    const arq = gravar(nomeArquivo('lighthouse', url), lhr);
    const nota = Math.round((lhr.categories.accessibility.score || 0) * 100);
    const reprovados = Object.values(lhr.audits).filter(a => a.score !== null && a.score < 1).length;
    console.log(`lighthouse  ${url}`);
    console.log(`            nota de acessibilidade: ${nota}/100, ${reprovados} audit(s) reprovado(s)  ->  saida/${path.basename(arq)}`);
  }
}

const COMANDOS = { axe: comAxe, pa11y: comPa11y, nota: comLighthouse };

async function principal() {
  const [comando, ...urls] = process.argv.slice(2);
  if (!COMANDOS[comando] || !urls.length) {
    console.error('uso: node a11y.js <axe|pa11y|nota> <url> [url...]');
    process.exit(1);
  }
  await COMANDOS[comando](urls);
}

if (require.main === module) {
  principal().catch(err => { console.error('falhou:', err.message); process.exit(1); });
}

module.exports = { gravar, nomeArquivo, SAIDA, scanAxe, scanPa11y, scanLighthouse };
