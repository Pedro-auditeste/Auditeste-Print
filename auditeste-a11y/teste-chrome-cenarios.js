/* Teste E2E completo no Chrome: Print → projeto → passos → Gerar cenários.
 * Usa o Chrome do Puppeteer (mesmo da ponte).
 *
 *   node teste-chrome-cenarios.js
 *   node teste-chrome-cenarios.js --visivel   # abre o Chrome na tela
 *
 * Requer a ponte em http://127.0.0.1:8900 (npm run servidor), com a chave do
 * serviço de cenários: "Gerar cenários" pede o Gherkin à ponte, então a
 * página é servida por ela, como nos outros teste-chrome-*. Aberta por
 * file://, a tela não acha ponte nenhuma e a caixa nunca aparece (era assim
 * que este teste ficou parado desde 08/09/2026).
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const VISIVEL = process.argv.includes('--visivel');
const HTML = path.resolve(__dirname, 'publico', 'index.html');
const BASE = (process.env.PONTE_URL || 'http://127.0.0.1:8900').replace(/\/+$/, '');
const ALVO = BASE + '/';
const SAIDA = path.join(__dirname, 'saida');

const R = [];
const ok = (caso, cond, obtido) => {
  R.push({ caso, ok: !!cond, obtido: String(obtido).slice(0, 120) });
  console.log((cond ? '  OK   ' : '  FALHA') + '  ' + caso + '  →  ' + String(obtido).slice(0, 100));
};

(async () => {
  if (!fs.existsSync(HTML)) {
    console.error('HTML não encontrado:', HTML);
    process.exit(1);
  }
  fs.mkdirSync(SAIDA, { recursive: true });

  const info = await fetch(BASE + '/ping').then(r => r.json()).catch(() => null);
  if (!info || !info.ok) {
    console.error('Ponte nao esta no ar em ' + BASE + '. Rode: npm run servidor');
    process.exit(1);
  }
  if (!info.cenarios) {
    console.error('A ponte esta sem a chave do servico de cenarios (AGENTE_API_KEY no .env).');
    process.exit(1);
  }

  console.log('Abrindo Chrome' + (VISIVEL ? ' (visível)' : ' (headless)') + '...');
  console.log('Página:', ALVO);

  const chrome = await Promise.resolve(puppeteer.executablePath()).catch(() => undefined);

  const navegador = await puppeteer.launch({
    headless: VISIVEL ? false : true,
    executablePath: chrome,
    defaultViewport: VISIVEL ? null : { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...(VISIVEL ? ['--start-maximized'] : [])]
  });

  const pagina = await navegador.newPage();
  const erros = [];
  pagina.on('pageerror', e => erros.push(e.message));
  pagina.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });

  try {
    await pagina.goto(ALVO, { waitUntil: 'load', timeout: 30000 });
    await delay(1000);

    /* 1. Splash */
    await pagina.waitForSelector('#entrarSite', { timeout: 10000 });
    await pagina.click('#entrarSite');
    await delay(1200);
    ok('Entra no app (splash)', await pagina.$eval('.tela.ativa', el => el.id) === 'telaProjetos',
      await pagina.$eval('.tela.ativa', el => el.id));

    /* 2. Novo projeto */
    await pagina.click('[data-acao="novoProjeto"]');
    await delay(400);
    await pagina.waitForSelector('#campoNome', { visible: true });
    await pagina.click('#campoNome', { clickCount: 3 });
    await pagina.type('#campoNome', 'Teste Chrome Cenários');
    /* O consentimento e opt-in: sem marcar a caixa, iaLiberada() bloqueia
     * antes do fetch e a descricao nunca chega. Este teste e justamente do
     * caminho autorizado, entao marca. */
    await pagina.click('#campoIA');
    await pagina.click('#btnConfirmarModal');
    await delay(1200);
    const criou = await pagina.$('#gradeProjetos .cartao[data-projeto]');
    ok('Cria projeto no IndexedDB', !!criou, criou ? 'projeto criado' : 'não criou');
    if (!criou) return encerrar(navegador, erros);

    await pagina.click('#gradeProjetos .cartao[data-projeto]');
    await delay(800);
    await pagina.click('[data-acao="novaGravacao"]');
    await delay(800);
    ok('Abre nova gravação', await pagina.$eval('.tela.ativa', el => el.id) === 'telaGravador',
      await pagina.$eval('.tela.ativa', el => el.id));

    /* 3. Preenche ficha */
    await pagina.evaluate(() => {
      const set = (campo, valor) => {
        const el = document.querySelector('#ficha [data-campo="' + campo + '"]');
        if (!el) return;
        if (el.tagName === 'SELECT') el.value = valor;
        else el.textContent = valor;
      };
      set('registro', 'EV-CHROME-001');
      set('executor', 'Teste automatizado');
      set('modulo', 'Login');
      set('ambiente', 'Homologação');
      set('resultado', 'Reprovado');
      set('observacoes', 'Teste E2E Montar cenários no Chrome');
    });

    /* 4. Passo manual funcional */
    await pagina.click('[data-acao="manual"]');
    await delay(500);
    await pagina.evaluate(() => {
      const p = document.querySelector('#lista .passo');
      p.querySelector('.titulo').textContent = 'Acessar tela de login';
      p.querySelector('.obs').textContent = 'Formulário de e-mail e senha visível.';
    });

    await pagina.click('[data-acao="manual"]');
    await delay(400);
    await pagina.evaluate(() => {
      const passos = document.querySelectorAll('#lista .passo');
      const p = passos[passos.length - 1];
      p.querySelector('.titulo').textContent = 'Informar credenciais e clicar em Entrar';
      p.querySelector('.obs').textContent = 'Dashboard carregou após o login.';
    });

    /* A importação manual de JSON de acessibilidade (arqA11y) saiu da tela:
     * quem escaneia hoje usa os botões de scan ao vivo (escanear() -> /scan
     * na ponte), que exigem servidor no ar e não fazem sentido neste teste
     * aberto por file://. Cobertura desse caminho fica para um teste com
     * servidor de verdade; aqui só os passos manuais. */
    const qtdPassos = await pagina.$$eval('#lista .passo', els => els.length);
    ok('Tem os passos funcionais', qtdPassos >= 2, qtdPassos + ' passos');

    /* 6. Salvar no projeto */
    await pagina.click('[data-acao="salvar"]');
    await delay(2500);
    const naLista = await pagina.$('#listaRegistros [data-abrir]');
    ok('Salva evidência no projeto', !!naLista, naLista ? 'registro na lista' : 'não salvou');
    if (!naLista) {
      await pagina.screenshot({ path: path.join(SAIDA, 'falha-salvar.png'), fullPage: true });
      return encerrar(navegador, erros);
    }

    /* 7. Abrir registro */
    await pagina.click('#listaRegistros [data-abrir]');
    await delay(1500);
    ok('Abre registro salvo', await pagina.$eval('.tela.ativa', el => el.id) === 'telaRegistro',
      await pagina.$eval('.tela.ativa', el => el.id));

    /* 8. Gerar cenários: a página só fala com a ponte, nunca direto com fora. */
    const pedidosRede = [];
    pagina.on('request', req => {
      const u = req.url();
      if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) pedidosRede.push(u);
    });

    await pagina.waitForSelector('[data-acao="gerarCenariosIA"]', { visible: true });
    await pagina.click('[data-acao="gerarCenariosIA"]');
    await pagina.waitForFunction(() => {
      const c = document.getElementById('caixaCenarios');
      const e = document.getElementById('estadoCenarios');
      return (c && !c.hidden) || (e && /off/.test(e.className));
    }, { timeout: 130000 }).catch(() => {});

    const gherkin = await pagina.$eval('#caixaCenarios pre', el => el.textContent).catch(() => '');
    const visivel = await pagina.$eval('#caixaCenarios', el => !el.hidden).catch(() => false);

    ok('Caixa de cenários aparece', visivel, visivel ? 'visível' : 'oculta');
    ok('Gherkin tem Funcionalidade', /Funcionalidade:/.test(gherkin), gherkin.slice(0, 80) || '(vazio)');
    ok('Gherkin sem moldura de asteriscos', !!gherkin && !/^\s*\*\*|\*\*\s*$/.test(gherkin), gherkin.slice(0, 20));
    ok('Gherkin tem cenário funcional', /Cenário:/.test(gherkin) && /Quando /.test(gherkin),
      (gherkin.match(/Cenário:/g) || []).length + ' cenário(s)');
    ok('Só falou com a ponte', pedidosRede.length === 0, pedidosRede.length + ' request(s) para fora: ' + pedidosRede.slice(0, 2).join(', '));

    const shot = path.join(SAIDA, 'teste-montar-cenarios-chrome.png');
    await pagina.screenshot({ path: shot, fullPage: true });
    console.log('\nScreenshot: ' + shot);

    if (gherkin) {
      const arq = path.join(SAIDA, 'gherkin-teste-chrome.txt');
      fs.writeFileSync(arq, gherkin, 'utf8');
      console.log('Gherkin salvo: ' + arq);
      console.log('\n--- Gherkin gerado ---\n' + gherkin + '\n----------------------\n');
    }

    if (VISIVEL) {
      console.log('Chrome aberto 5s para inspeção...');
      await delay(5000);
    }
  } catch (err) {
    ok('Execução sem exceção', false, err.message);
    try {
      await pagina.screenshot({ path: path.join(SAIDA, 'falha-excecao.png'), fullPage: true });
    } catch (e) { /* ok */ }
  }

  await encerrar(navegador, erros);
})();

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function encerrar(navegador, erros) {
  await navegador.close();
  const falhas = R.filter(x => !x.ok);
  console.log('\n' + (R.length - falhas.length) + '/' + R.length + ' passaram');
  if (erros.length) {
    console.log('Erros de console (' + erros.length + '):');
    [...new Set(erros)].slice(0, 6).forEach(e => console.log('  ' + String(e).slice(0, 140)));
  }
  process.exit(falhas.length ? 1 : 0);
}
