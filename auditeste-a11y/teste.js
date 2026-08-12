/* Roda as quatro ferramentas de ponta a ponta contra o Audi Print, importa
 * cada saída no próprio Print e gera relatorio-teste.html para conferência
 * humana.
 *
 *   node teste.js
 */
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const ALVO = path.join(RAIZ, '_teste');
const PRINT = 'C:/Users/Auditeste0457/Downloads/evidencias-auditeste.html';
const PORTA = 8899;
const URL_ALVO = `http://localhost:${PORTA}/print.html`;

const TIPOS = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };

function servidor() {
  return http.createServer((req, res) => {
    const nome = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'print.html';
    const arq = path.join(ALVO, nome);
    if (!arq.startsWith(ALVO) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); return res.end('nao encontrado');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(PORTA);
}

/* assincrono de proposito: o servidor HTTP vive neste mesmo processo e
   execFileSync travaria o event loop, deixando o scan sem resposta */
function rodar(args) {
  const inicio = Date.now();
  return new Promise(resolve => {
    execFile('node', args, {
      cwd: RAIZ, encoding: 'utf8', timeout: 300000,
      env: { ...process.env, BASE: URL_ALVO }
    }, (err, stdout, stderr) => {
      const saida = ((stdout || '') + (stderr || '')).trim();
      resolve({ ok: !err, saida: saida || (err ? err.message : ''), ms: Date.now() - inicio });
    });
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* extrai (regra, impacto, alvo) de qualquer um dos tres formatos */
function achados(dados) {
  if (dados && Array.isArray(dados.violations)) {
    return dados.violations.flatMap(v => v.nodes.map(n => ({
      regra: v.id, gravidade: v.impact || '-', alvo: [].concat(n.target || []).join(' ')
    })));
  }
  const issues = Array.isArray(dados) ? dados : (dados && Array.isArray(dados.issues) ? dados.issues : null);
  if (issues) return issues.map(i => ({ regra: i.code, gravidade: i.type || '-', alvo: i.selector || '' }));
  if (dados && dados.audits) {
    const cat = dados.categories && dados.categories.accessibility;
    const ids = cat && cat.auditRefs ? cat.auditRefs.map(r => r.id) : Object.keys(dados.audits);
    return ids.map(id => dados.audits[id])
      .filter(a => a && a.score !== null && a.score !== undefined && a.score < 1)
      .flatMap(a => ((a.details && a.details.items) || [{}]).map(it => ({
        regra: a.id, gravidade: '-', alvo: (it.node && (it.node.selector || it.node.snippet)) || ''
      })));
  }
  return [];
}

async function principal() {
  fs.rmSync(ALVO, { recursive: true, force: true });
  fs.mkdirSync(ALVO, { recursive: true });
  fs.rmSync(path.join(RAIZ, 'saida'), { recursive: true, force: true });
  fs.copyFileSync(PRINT, path.join(ALVO, 'print.html'));

  const srv = servidor();
  const etapas = [];
  let tiro;

  try {
    console.log('servindo o Print em ' + URL_ALVO + '\n');

    for (const [rotulo, args] of [
      ['axe-core via Playwright', ['a11y.js', 'axe', URL_ALVO]],
      ['Pa11y', ['a11y.js', 'pa11y', URL_ALVO]],
      ['Lighthouse', ['a11y.js', 'nota', URL_ALVO]],
      ['Playwright + axe (fluxo autenticado)', ['fluxo.js']]
    ]) {
      process.stdout.write(rotulo + ' ... ');
      const r = await rodar(args);
      console.log(r.ok ? `ok (${(r.ms / 1000).toFixed(1)}s)` : 'FALHOU');
      etapas.push({ rotulo, comando: 'node ' + args.join(' '), ...r });
    }

    /* importa cada JSON no Print e conta os passos gerados */
    const jsons = fs.existsSync(path.join(RAIZ, 'saida'))
      ? fs.readdirSync(path.join(RAIZ, 'saida')).filter(f => f.endsWith('.json')) : [];
    jsons.forEach(f => fs.copyFileSync(path.join(RAIZ, 'saida', f), path.join(ALVO, f)));

    const { chromium } = require('playwright');
    const nav = await chromium.launch();
    const ctx = await nav.newContext();
    const pag = await ctx.newPage();
    await pag.goto(URL_ALVO, { waitUntil: 'load' });
    await pag.click('#entrarSite');
    await pag.waitForTimeout(1200);
    await pag.evaluate(() => {
      document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
      document.getElementById('telaGravador').classList.add('ativa');
    });

    for (const etapa of etapas) {
      const meus = jsons.filter(f => etapa.rotulo.startsWith('Playwright +') ? f.startsWith('fluxo-')
        : f.startsWith(etapa.rotulo.startsWith('axe') ? 'axe-' : etapa.rotulo === 'Pa11y' ? 'pa11y-' : 'lighthouse-'));
      etapa.arquivos = [];
      for (const nome of meus) {
        await pag.evaluate(() => { document.getElementById('lista').innerHTML = ''; });
        await pag.setInputFiles('#arqA11y', path.join(ALVO, nome));
        await pag.waitForTimeout(600);
        const passos = await pag.evaluate(() => document.querySelectorAll('#lista .passo').length);
        const dados = JSON.parse(fs.readFileSync(path.join(ALVO, nome), 'utf8'));
        etapa.arquivos.push({ nome, passos, achados: achados(dados) });
      }
    }

    /* print da tela com o maior conjunto importado */
    const maior = etapas.flatMap(e => e.arquivos || []).sort((a, b) => b.passos - a.passos)[0];
    if (maior) {
      await pag.evaluate(() => { document.getElementById('lista').innerHTML = ''; });
      await pag.setInputFiles('#arqA11y', path.join(ALVO, maior.nome));
      await pag.waitForTimeout(800);
      await pag.setViewportSize({ width: 1100, height: 1400 });
      tiro = (await pag.screenshot({ fullPage: false })).toString('base64');
    }
    await nav.close();

  } finally {
    srv.close();
  }

  /* ---------- relatorio ---------- */
  const totalPassos = etapas.flatMap(e => e.arquivos || []).reduce((n, a) => n + a.passos, 0);
  const falhas = etapas.filter(e => !e.ok).length;

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teste do toolkit de acessibilidade · Auditeste</title>
<style>
  :root{--navy:#0d3446;--green:#76c043;--ink:#1e2a30;--muted:#5b6b73;--line:#e3e7e5;--bg:#f3f4f3;--rec:#d84f4f;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
  header{background:var(--navy);color:#fff;border-bottom:4px solid var(--green);padding:26px 20px}
  header .in{max-width:1000px;margin:0 auto}
  header h1{font-size:1.5rem;font-weight:800}
  header p{color:#a9c6d3;font-size:.9rem;margin-top:4px}
  main{max-width:1000px;margin:0 auto;padding:26px 20px 50px}
  .placar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px}
  .n{background:#fff;border-radius:12px;padding:14px 18px;border-left:5px solid var(--green);box-shadow:0 2px 10px rgba(13,52,70,.07)}
  .n b{display:block;font-size:1.7rem;color:var(--navy);line-height:1.1}
  .n span{font-size:.8rem;color:var(--muted);font-weight:600}
  .n.ruim{border-left-color:var(--rec)}
  section{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(13,52,70,.07);margin-bottom:16px;overflow:hidden}
  section > h2{font-size:1.05rem;color:var(--navy);padding:14px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
  .selo{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:3px 12px}
  .ok{background:#eef6e6;color:#4c8420}
  .nok{background:#fdecec;color:var(--rec)}
  .corpo{padding:16px 20px}
  pre{background:#0d3446;color:#d7e6ed;border-radius:8px;padding:12px 14px;font-size:.8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
  pre.cmd{background:#eef1ef;color:var(--navy);font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:.83rem}
  th{text-align:left;color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid var(--line);padding:6px 8px}
  td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  td.alvo{color:var(--muted);font-family:Consolas,monospace;font-size:.76rem;word-break:break-all}
  .g{font-weight:700;font-size:.72rem;text-transform:uppercase}
  .g.critical,.g.error{color:var(--rec)}.g.serious{color:#c8631f}.g.moderate,.g.warning{color:#9a8218}.g.minor{color:var(--muted)}
  .arq{font-size:.78rem;color:var(--muted);margin-top:14px;padding-top:10px;border-top:1px dashed var(--line)}
  .arq b{color:var(--navy)}
  figure{margin:0;padding:16px 20px 20px}
  figure img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  figcaption{font-size:.8rem;color:var(--muted);margin-top:8px}
  footer{max-width:1000px;margin:0 auto;padding:0 20px 40px;font-size:.8rem;color:var(--muted)}
</style></head><body>
<header><div class="in">
  <h1>Teste do toolkit de acessibilidade</h1>
  <p>axe-core · Pa11y · Lighthouse · Playwright — executados de ponta a ponta contra o Audi Print</p>
  <p>${new Date().toLocaleString('pt-BR')} · Node ${process.version}</p>
</div></header>
<main>
  <div class="placar">
    <div class="n"><b>${etapas.length - falhas}/${etapas.length}</b><span>Ferramentas rodaram</span></div>
    <div class="n"><b>${etapas.flatMap(e => e.arquivos || []).length}</b><span>JSON gerados</span></div>
    <div class="n"><b>${totalPassos}</b><span>Passos importados no Print</span></div>
    <div class="n${falhas ? ' ruim' : ''}"><b>${falhas}</b><span>Falhas</span></div>
  </div>

  ${etapas.map(e => `
  <section>
    <h2>${esc(e.rotulo)}<span class="selo ${e.ok ? 'ok' : 'nok'}">${e.ok ? 'passou' : 'falhou'} · ${(e.ms / 1000).toFixed(1)}s</span></h2>
    <div class="corpo">
      <pre class="cmd">${esc(e.comando)}</pre>
      <pre>${esc(e.saida)}</pre>
      ${(e.arquivos || []).map(a => `
        <div class="arq"><b>${esc(a.nome)}</b> — importado no Print como <b>${a.passos}</b> passo(s) de evidência</div>
        ${a.achados.length ? `<table>
          <tr><th>Regra</th><th>Gravidade</th><th>Elemento</th></tr>
          ${a.achados.slice(0, 12).map(v => `<tr><td>${esc(v.regra)}</td><td class="g ${esc(v.gravidade)}">${esc(v.gravidade)}</td><td class="alvo">${esc(v.alvo)}</td></tr>`).join('')}
        </table>${a.achados.length > 12 ? `<div class="arq">e mais ${a.achados.length - 12} …</div>` : ''}` : ''}
      `).join('')}
    </div>
  </section>`).join('')}

  ${tiro ? `<section><h2>O resultado dentro do Audi Print</h2>
    <figure><img src="data:image/png;base64,${tiro}" alt="Tela do Audi Print com as violações importadas como passos de evidência">
    <figcaption>Violações importadas viram passos numerados, com gravidade, regra e o seletor do elemento — prontos para salvar no projeto e exportar.</figcaption></figure>
  </section>` : ''}
</main>
<footer>Gerado por <b>teste.js</b>. Alvo: o próprio Audi Print servido em localhost — arquivo único, sem dependência.</footer>
</body></html>`;

  const destino = path.join(RAIZ, 'relatorio-teste.html');
  fs.writeFileSync(destino, html, 'utf8');
  fs.rmSync(ALVO, { recursive: true, force: true });

  console.log(`\n${etapas.length - falhas}/${etapas.length} ferramentas, ${totalPassos} passos importados`);
  console.log('relatorio: ' + destino);
  if (falhas) process.exit(1);
}

principal().catch(err => { console.error('falhou:', err); process.exit(1); });
