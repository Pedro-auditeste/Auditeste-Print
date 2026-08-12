/* Testa o Print aberto por file:// — o unico caminho que a automacao de
 * navegador nao alcanca. Playwright navega para file:// sem problema.
 *
 * Interessa especialmente saber se IndexedDB e localStorage funcionam nesse
 * protocolo: o Chrome trata file:// como origem opaca em varias APIs, e o
 * app inteiro depende dos dois.
 */
const { chromium } = require('playwright');
const path = require('path');

const ALVO = 'file:///C:/Users/Auditeste0457/Downloads/evidencias-auditeste.html';

const R = [];
const ok = (caso, cond, obtido) => R.push({ caso, ok: !!cond, obtido });

(async () => {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();

  const erros = [];
  pagina.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));

  await pagina.goto(ALVO, { waitUntil: 'load', timeout: 30000 });
  await pagina.waitForTimeout(1200);

  /* --- as duas APIs de armazenamento, que o file:// costuma barrar --- */
  const armazenamento = await pagina.evaluate(async () => {
    const res = { localStorage: null, indexedDB: null };
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); res.localStorage = 'ok'; }
    catch (e) { res.localStorage = 'FALHOU: ' + e.name; }
    try {
      await new Promise((ok, erro) => {
        const req = indexedDB.open('__teste_file', 1);
        req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('__teste_file'); ok(); };
        req.onerror = () => erro(req.error || new Error('erro'));
        req.onblocked = () => erro(new Error('bloqueado'));
      });
      res.indexedDB = 'ok';
    } catch (e) { res.indexedDB = 'FALHOU: ' + (e.name || e.message); }
    return res;
  });
  ok('localStorage disponível em file://', armazenamento.localStorage === 'ok', armazenamento.localStorage);
  ok('IndexedDB disponível em file://', armazenamento.indexedDB === 'ok', armazenamento.indexedDB);

  /* --- o banco do proprio app abriu? --- */
  const boot = await pagina.evaluate(() => ({
    telas: document.querySelectorAll('.tela').length,
    entrar: !!document.getElementById('entrarSite'),
    aviso: document.querySelector('.aviso-toast')?.textContent || null
  }));
  ok('boot: 4 telas, sem erro de armazenamento', boot.telas === 4 && !/(indispon|não foi poss)/i.test(boot.aviso || ''),
    boot.telas + ' telas' + (boot.aviso ? ' · aviso: ' + boot.aviso : ''));

  await pagina.click('#entrarSite');
  await pagina.waitForTimeout(1300);
  ok('splash fecha e lista projetos',
    await pagina.evaluate(() => document.querySelector('.tela.ativa')?.id === 'telaProjetos'),
    await pagina.evaluate(() => document.querySelector('.tela.ativa')?.id));

  /* --- criar projeto (grava no IndexedDB) --- */
  await pagina.click('[data-acao="novoProjeto"]');
  await pagina.waitForTimeout(400);
  await pagina.fill('#campoNome', 'Teste file://');
  await pagina.click('#btnConfirmarModal');
  await pagina.waitForTimeout(1000);
  const criou = await pagina.evaluate(() => !!document.querySelector('#gradeProjetos .cartao[data-projeto]'));
  ok('cria projeto e grava no IndexedDB', criou, criou ? 'gravado' : 'não gravou');
  if (!criou) { await encerrar(navegador, erros); return; }

  await pagina.click('#gradeProjetos .cartao[data-projeto]');
  await pagina.waitForTimeout(700);
  await pagina.click('[data-acao="novaGravacao"]');
  await pagina.waitForTimeout(700);

  /* --- caixa de scan: le localStorage e tenta a ponte --- */
  await pagina.evaluate(() => { document.getElementById('caixaScan').open = true; });
  await pagina.waitForTimeout(2500);
  const scan = await pagina.evaluate(() => document.getElementById('estadoPonte').textContent);
  ok('caixa de scan sem ponte não quebra', /Sem ponte/.test(scan), scan.slice(0, 60) + '...');

  /* --- passos + importacao --- */
  await pagina.click('[data-acao="manual"]');
  await pagina.waitForTimeout(400);
  await pagina.evaluate(() => {
    const p = document.querySelector('#lista .passo');
    p.querySelector('.titulo').textContent = 'informo credenciais válidas';
    p.querySelector('.obs').textContent = 'Campo aceitou o e-mail sem erro.';
  });
  await pagina.evaluate(() => {
    const j = JSON.stringify({ violations: [
      { id: 'color-contrast', impact: 'serious', help: 'Contraste insuficiente', nodes: [{ target: ['.btn'] }] }] });
    const dt = new DataTransfer();
    dt.items.add(new File([j], 'axe.json', { type: 'application/json' }));
    const i = document.getElementById('arqA11y');
    i.files = dt.files;
    i.dispatchEvent(new Event('change'));
  });
  await pagina.waitForTimeout(900);
  const passos = await pagina.evaluate(() => document.querySelectorAll('#lista .passo').length);
  ok('importa JSON de acessibilidade', passos === 2, passos + ' passos');

  /* --- salvar e reabrir --- */
  await pagina.evaluate(() => {
    document.querySelector('[data-campo="registro"]').textContent = 'EVD-FILE';
    document.querySelector('[data-campo="modulo"]').textContent = 'Autenticação';
    document.querySelector('[data-campo="resultado"]').value = 'Aprovado';
  });
  await pagina.click('[data-acao="salvar"]');
  await pagina.waitForTimeout(2000);
  await pagina.click('#listaRegistros [data-abrir]');
  await pagina.waitForTimeout(1200);
  ok('salva e reabre o registro',
    await pagina.evaluate(() => document.querySelectorAll('#conteudoRegistro .passo').length === 2),
    await pagina.evaluate(() => document.querySelectorAll('#conteudoRegistro .passo').length + ' passos'));

  /* --- gerador de cenarios, sem rede --- */
  const pedidos = [];
  pagina.on('request', r => { if (!r.url().startsWith('file://')) pedidos.push(r.url()); });
  await pagina.click('[data-acao="gerarCenarios"]');
  await pagina.waitForTimeout(1800);
  const gherkin = await pagina.evaluate(() => document.querySelector('#caixaCenarios pre')?.textContent || '');
  ok('gera cenários sem nenhuma requisição de rede',
    gherkin.includes('Funcionalidade:') && pedidos.length === 0,
    (gherkin.match(/^\s*Cenário:/gm) || []).length + ' cenários · ' + pedidos.length + ' requisições');

  /* --- persistencia real: fecha e reabre a pagina --- */
  await pagina.goto(ALVO, { waitUntil: 'load' });
  await pagina.waitForTimeout(1500);
  await pagina.click('#entrarSite');
  await pagina.waitForTimeout(1300);
  const sobreviveu = await pagina.evaluate(() => document.querySelectorAll('#gradeProjetos .cartao[data-projeto]').length);
  ok('dados sobrevivem ao recarregar a página', sobreviveu >= 1, sobreviveu + ' projeto(s)');

  /* --- export --- */
  await pagina.click('#gradeProjetos .cartao[data-projeto]');
  await pagina.waitForTimeout(800);
  await pagina.click('#listaRegistros [data-abrir]');
  await pagina.waitForTimeout(1200);
  const html = await pagina.evaluate(async () => {
    let capturado = null;
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = async function () {
      if (this.download) capturado = await (await fetch(this.href)).text();
    };
    document.querySelector('[data-acao="exportarHtml"]').click();
    await new Promise(r => setTimeout(r, 2500));
    HTMLAnchorElement.prototype.click = real;
    return capturado;
  });
  ok('exporta HTML com os cenários',
    !!html && /Funcionalidade: Autentica/.test(html),
    html ? Math.round(html.length / 1024) + ' KB' : 'não gerou');

  await encerrar(navegador, erros);
})();

async function encerrar(navegador, erros) {
  await navegador.close();
  const falhas = R.filter(x => !x.ok);
  console.log('');
  R.forEach(x => console.log((x.ok ? '  ok   ' : '  FALHA') + '  ' + x.caso + '  ->  ' + x.obtido));
  console.log('');
  console.log(`${R.length - falhas.length}/${R.length} passaram`);
  if (erros.length) {
    console.log('\nerros de console (' + erros.length + '):');
    [...new Set(erros)].slice(0, 8).forEach(e => console.log('  ' + e.slice(0, 140)));
  } else {
    console.log('console limpo');
  }
  process.exit(falhas.length ? 1 : 0);
}
