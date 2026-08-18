/* CLI de acessibilidade da Auditeste.
 *
 *   node a11y.js axe   <url> [url...]    axe-core via Puppeteer/Chrome
 *   node a11y.js pa11y <url> [url...]    Pa11y (Chrome)
 *   node a11y.js nota  <url> [url...]    Lighthouse (Chrome)
 *
 * Os tres motores usam o MESMO Chrome (Puppeteer) — evita conflito de
 * versao Playwright/Chromium no Docker/Railway.
 */
const fs = require('fs');
const path = require('path');

const LOCALE_AXE_PT = require('axe-core/locales/pt_BR.json');
const { traduzirIssuePa11y } = require('./traducoes-pa11y.js');

const SAIDA = path.join(__dirname, 'saida');

const FLAGS_DOCKER = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer'
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Auditeste-A11y/1.0';

function caminhoChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* ok */ }
  return null;
}

function exigirChrome(motor) {
  const chrome = caminhoChrome();
  if (!chrome) {
    const err = new Error(
      motor + ': Chrome nao encontrado. Rode: npx puppeteer browsers install chrome'
    );
    err.codigo = 'SEM_CHROME';
    throw err;
  }
  return chrome;
}

async function lancarChrome() {
  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    executablePath: exigirChrome('ponte'),
    headless: true,
    args: FLAGS_DOCKER
  });
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

async function diagnosticarPuppeteer(pagina) {
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

/* ---------- scanners (todos via Puppeteer/Chrome) ---------- */

async function scanAxe(url) {
  const { AxePuppeteer } = require('@axe-core/puppeteer');
  const navegador = await lancarChrome();
  try {
    const pagina = await navegador.newPage();
    await pagina.setUserAgent(USER_AGENT);
    /* GitHub e outros sites bloqueiam script inline via CSP — bypass antes do goto */
    await pagina.setBypassCSP(true);
    await pagina.goto(url, { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    const aviso = await diagnosticarPuppeteer(pagina);
    const r = await new AxePuppeteer(pagina)
      .configure({ locale: LOCALE_AXE_PT })
      .analyze();

    return {
      url,
      ferramenta: 'axe-core',
      via: 'axe-puppeteer',
      gerado: new Date().toISOString(),
      aviso,
      violations: r.violations
    };
  } finally {
    await navegador.close();
  }
}

async function scanPa11y(url) {
  const pa11y = require('pa11y');
  const chrome = exigirChrome('Pa11y');

  const resultado = await pa11y(url, {
    timeout: 90000,
    wait: 1000,
    chromeLaunchConfig: {
      executablePath: chrome,
      ignoreHTTPSErrors: true,
      args: FLAGS_DOCKER
    }
  });

  return {
    ...resultado,
    ferramenta: 'pa11y',
    url: resultado.pageUrl || url,
    gerado: new Date().toISOString(),
    issues: (resultado.issues || []).map(traduzirIssuePa11y)
  };
}

async function scanLighthouse(url) {
  const chromeLauncher = await import('chrome-launcher');
  const { default: lighthouse } = await import('lighthouse');
  const chromePath = exigirChrome('Lighthouse');

  const chrome = await chromeLauncher.launch({
    chromePath,
    chromeFlags: ['--headless=new', ...FLAGS_DOCKER],
    logLevel: 'error'
  });
  try {
    const r = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['accessibility'],
      locale: 'pt',
      logLevel: 'error',
      formFactor: 'desktop',
      screenEmulation: { disabled: true }
    });
    const lhr = r.lhr;
    lhr.ferramenta = 'lighthouse';
    lhr.gerado = new Date().toISOString();
    return lhr;
  } finally {
    try { await chrome.kill(); } catch (e) { /* ok */ }
  }
}

function statusMotores() {
  const chrome = caminhoChrome();
  return {
    axe: { ok: !!chrome, via: 'axe-puppeteer' },
    pa11y: { ok: !!chrome, via: 'puppeteer-chrome' },
    nota: { ok: !!chrome, via: 'puppeteer-chrome', alias: 'lighthouse' },
    chrome: chrome || null
  };
}

/* ---------- CLI ---------- */
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

const COMANDOS = { axe: comAxe, pa11y: comPa11y, nota: comLighthouse, lighthouse: comLighthouse };

async function principal() {
  const [comando, ...urls] = process.argv.slice(2);
  if (!COMANDOS[comando] || !urls.length) {
    console.error('uso: node a11y.js <axe|pa11y|nota|lighthouse> <url> [url...]');
    process.exit(1);
  }
  await COMANDOS[comando](urls);
}

if (require.main === module) {
  principal().catch(err => { console.error('falhou:', err.message); process.exit(1); });
}

module.exports = {
  gravar, nomeArquivo, SAIDA,
  scanAxe, scanPa11y, scanLighthouse,
  statusMotores, caminhoChrome, lancarChrome
};
