/* CLI de acessibilidade da Auditeste.
 *
 *   node a11y.js axe   <url> [url...]    axe-core via Playwright
 *   node a11y.js pa11y <url> [url...]    Pa11y (Puppeteer/Chrome)
 *   node a11y.js nota  <url> [url...]    Lighthouse (nota + relatorio)
 *
 * Cada comando grava um JSON em saida/, no formato nativo da ferramenta —
 * que e exatamente o que o Audi Print importa, sem conversao.
 */
const fs = require('fs');
const path = require('path');

const SAIDA = path.join(__dirname, 'saida');

/* Flags obrigatorias em Docker/Railway (sem sandbox de usuario). */
const FLAGS_DOCKER = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer'
];

/**
 * Resolve o Chrome/Chromium usado por Pa11y e Lighthouse.
 * Ordem: CHROME_PATH → Chrome do Puppeteer → Chromium do Playwright.
 */
function caminhoChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* puppeteer opcional em alguns ambientes */ }
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* playwright obrigatorio para axe */ }
  return null;
}

function lancarPlaywright() {
  const { chromium } = require('playwright');
  return chromium.launch({
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

function exigirChrome(motor) {
  const chrome = caminhoChrome();
  if (!chrome) {
    const err = new Error(
      motor + ': nenhum Chrome/Chromium encontrado. '
      + 'Defina CHROME_PATH ou rode: npx puppeteer browsers install chrome'
    );
    err.codigo = 'SEM_CHROME';
    throw err;
  }
  return chrome;
}

/* Espera a pagina assentar antes de medir.
   Em SPA o evento 'load' dispara com o esqueleto vazio. */
async function assentar(pagina) {
  await pagina.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await pagina.waitForTimeout(1000);
}

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

/* ---------- scanners ---------- */

async function scanAxePlaywright(url) {
  const mod = require('@axe-core/playwright');
  const AxeBuilder = mod.default || mod.AxeBuilder || mod;

  const navegador = await lancarPlaywright();
  try {
    const contexto = await navegador.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Auditeste-A11y/1.0'
    });
    const pagina = await contexto.newPage();
    await pagina.goto(url, { waitUntil: 'load', timeout: 60000 });
    await assentar(pagina);
    const aviso = await diagnosticar(pagina);
    const r = await new AxeBuilder({ page: pagina }).analyze();
    return {
      url,
      ferramenta: 'axe-core',
      via: 'playwright',
      gerado: new Date().toISOString(),
      aviso,
      violations: r.violations
    };
  } finally {
    await navegador.close();
  }
}

/** Fallback: mesmo Chrome do Pa11y/Lighthouse + axe-core injetado na pagina. */
async function scanAxePuppeteer(url) {
  const puppeteer = require('puppeteer');
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const chrome = exigirChrome('axe-core');

  const navegador = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: FLAGS_DOCKER
  });
  try {
    const pagina = await navegador.newPage();
    await pagina.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Auditeste-A11y/1.0'
    );
    await pagina.goto(url, { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    const aviso = await pagina.evaluate(() => {
      const titulo = document.title || '';
      const texto = ((document.body && document.body.innerText) || '').trim().length;
      if (!titulo && texto < 1500) {
        return 'ATENCAO: a pagina veio sem <title> e com pouquissimo conteudo. '
          + 'O site provavelmente bloqueou o navegador automatizado.';
      }
      return null;
    });

    await pagina.evaluate(axeSource);
    const r = await pagina.evaluate(async () => {
      // eslint-disable-next-line no-undef
      return await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    });

    return {
      url,
      ferramenta: 'axe-core',
      via: 'puppeteer',
      gerado: new Date().toISOString(),
      aviso,
      violations: r.violations
    };
  } finally {
    await navegador.close();
  }
}

async function scanAxe(url) {
  try {
    return await scanAxePlaywright(url);
  } catch (err) {
    const msg = err.message || '';
    const playwrightQuebrou = /Executable doesn't exist|browserType\.launch|playwright/i.test(msg);
    if (!playwrightQuebrou) throw err;
    console.warn('axe: Playwright indisponível, usando Chrome do Puppeteer');
    return await scanAxePuppeteer(url);
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
    gerado: new Date().toISOString()
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
      logLevel: 'error',
      formFactor: 'desktop',
      screenEmulation: { disabled: true }
    });
    const lhr = r.lhr;
    lhr.ferramenta = 'lighthouse';
    lhr.gerado = new Date().toISOString();
    return lhr;
  } finally {
    try { await chrome.kill(); } catch (e) { /* Windows EPERM no temp — ok */ }
  }
}

/** Status dos motores para /ping — ajuda a diagnosticar a ponte. */
function statusMotores() {
  const chrome = caminhoChrome();
  let playwrightOk = false;
  try {
    const { chromium } = require('playwright');
    playwrightOk = !!(chromium.executablePath() && fs.existsSync(chromium.executablePath()));
  } catch (e) { playwrightOk = false; }

  return {
    axe: {
      ok: playwrightOk || !!chrome,
      via: playwrightOk ? 'playwright-chromium' : (chrome ? 'puppeteer-chrome (fallback)' : null)
    },
    pa11y: { ok: !!chrome, via: chrome ? 'chrome' : null },
    nota: { ok: !!chrome, via: chrome ? 'chrome' : null, alias: 'lighthouse' },
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
  statusMotores, caminhoChrome
};
