/* Ajustes de tela que vieram do retorno de uso do Print (planilha de produto).
 *
 *   node teste-ux-retorno.js
 *
 * Cada caso trava uma coisa que alguém viu na tela e não passava em teste
 * nenhum: o check do formulário de projeto sozinho numa linha, o aviso de onde
 * as evidências ficam enterrado no rodapé, o "Novo projeto" repetido, e o
 * "Restaurar backup" que gravava sem dizer o que ia fazer.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const PORTA = 8998;
const BASE = 'http://127.0.0.1:' + PORTA;
const ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ux-')), 'cofre.db');
const delay = ms => new Promise(r => setTimeout(r, ms));

let falhas = 0, feitos = 0;
async function caso(nome, fn) {
  try { await fn(); feitos++; console.log('  ok     ' + nome); }
  catch (err) { falhas++; console.log('  FALHOU ' + nome + '\n           ' + String(err && err.message).split('\n')[0]); }
}

/* O que um backup de projeto traz: o mesmo formato que "Backup" baixa. */
/* O que o Print anota sozinho quando o teste comeca numa busca do Google: um
 * endereco de centenas de caracteres sem um espaco para quebrar. */
const URL_COMPRIDA = 'Teste em https://www.google.com/search?q=casas+bahia&' + 'sca_esv=2ae1172c4ad4d1ca&sxsrf='.repeat(18);

const BACKUP = {
  formato: 'audi-print-backup', versao: 1, geradoEm: 1,
  projeto: { nome: 'Projeto do backup', cliente: 'Cliente X', logo: null, iaPermitida: false, pasta: null, criadoEm: 1 },
  registros: [{ projetoNome: 'Projeto do backup', criadoEm: 2, video: null,
    ficha: { registro: 'EVD-1', resultado: 'Aprovado', modulo: 'Login', observacoes: URL_COMPRIDA },
    passos: [{ titulo: 'a', imagens: [] }, { titulo: 'b', imagens: [] }] }]
};

(async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORTA), HOST: '127.0.0.1', COFRE_BANCO: ARQUIVO,
      COFRE_SEGREDO: 'segredo-ux', AGENTE_API_KEY: '', PONTE_TOKEN: '' }),
    stdio: 'ignore'
  });
  let nav;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(BASE + '/ping')).ok) break; } catch (_) {}
      if (i > 120) throw new Error('o servidor nao subiu');
      await delay(250);
    }
    nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1280, height: 720 });
    const erros = [];
    pg.on('pageerror', e => erros.push(e.message));
    await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await pg.click('#entrarSite');
    await pg.waitForSelector('[data-acao="novoProjeto"]', { visible: true });

    /* Quantos botoes e atalhos visiveis tem exatamente este rotulo. O cartao de
     * "criar projeto" tem o rotulo no negrito de dentro; o botao, no proprio texto. */
    const visiveisCom = texto => pg.evaluate(t => [...document.querySelectorAll('button, [data-acao]')]
      .filter(el => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => { const b = el.querySelector('b'); return (b ? b.textContent : el.textContent).trim() === t; }).length, texto);

    console.log('\ntela inicial\n');

    await caso('CRITERIO: o aviso de onde as evidencias ficam esta no topo, na primeira tela', async () => {
      const r = await pg.evaluate(() => {
        const a = document.getElementById('avisoOndeFicam');
        const grade = document.getElementById('gradeProjetos');
        return { existe: !!a, noTopo: a && a.getBoundingClientRect().top < grade.getBoundingClientRect().top,
          naTela: a && a.getBoundingClientRect().bottom <= innerHeight, texto: a ? a.textContent : '' };
      });
      assert.ok(r.existe, 'o aviso sumiu');
      assert.ok(r.noTopo, 'o aviso voltou para depois da lista de projetos');
      assert.ok(r.naTela, 'o aviso esta abaixo da primeira tela: ninguem chega ate ele');
      assert.ok(/só neste navegador/.test(r.texto) && /apaga tudo/.test(r.texto) && /HTML/.test(r.texto), r.texto);
    });

    await caso('o aviso existe uma vez so, nao no topo e de novo no rodape', async () => {
      const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
      assert.strictEqual((html.match(/onde as evidências ficam/gi) || []).length, 1);
    });

    await caso('CRITERIO: sem projeto, o convite tem outro rotulo que o botao do topo', async () => {
      /* O convite so entra depois que a lista de projetos volta do banco do
       * navegador: sem esperar, este caso reprovava de vez em quando por medir cedo. */
      await pg.waitForSelector('#gradeProjetos .cartao.novo', { visible: true, timeout: 8000 });
      assert.strictEqual(await visiveisCom('Novo projeto'), 1, 'Novo projeto aparece mais de uma vez');
      assert.strictEqual(await visiveisCom('Criar primeiro projeto'), 1);
    });

    console.log('\nformulario de projeto\n');

    await caso('CRITERIO: o check da descricao automatica fica ao lado do texto, nao sozinho acima', async () => {
      await pg.click('[data-acao="novoProjeto"]');
      await pg.waitForSelector('#campoNome', { visible: true });
      const r = await pg.evaluate(() => {
        const l = document.querySelector('label.linha-opcao');
        const caixa = l.querySelector('input').getBoundingClientRect();
        const texto = l.querySelector('.rot').getBoundingClientRect();
        return { display: getComputedStyle(l).display, mesmaLinha: Math.abs(caixa.top - texto.top) < 12, antesDoTexto: caixa.right <= texto.left };
      });
      assert.strictEqual(r.display, 'flex');
      assert.ok(r.mesmaLinha, 'o check e o texto estao em linhas diferentes');
      assert.ok(r.antesDoTexto, 'o check nao esta a esquerda do texto');
    });

    await caso('criar o primeiro projeto tira o convite: Novo projeto fica so no botao do topo', async () => {
      await pg.type('#campoNome', 'Projeto de teste');
      await pg.click('#btnConfirmarModal');
      await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]', { visible: true });
      await pg.evaluate(() => document.querySelector('[data-acao="irProjetos"], .crumb a, #raizMigalha')?.click());
      await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await pg.click('#entrarSite').catch(() => {});
      await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]', { visible: true });
      assert.strictEqual(await visiveisCom('Novo projeto'), 1);
      assert.strictEqual(await visiveisCom('Criar primeiro projeto'), 0, 'o convite continuou depois de haver projeto');
      assert.strictEqual(await pg.$$eval('#gradeProjetos .cartao.novo', els => els.length), 0);
    });

    console.log('\nrestaurar backup\n');

    const projetos = () => pg.$$eval('#gradeProjetos .cartao[data-projeto] h3', els => els.map(e => e.textContent.trim()));
    const escolherArquivo = () => pg.evaluate(async (backup) => {
      const input = document.getElementById('arqBackup');
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, BACKUP);
    const modalAberto = () => pg.waitForFunction(() => document.getElementById('fundoConfirma').classList.contains('aberto')
      && /Restaurar backup/.test(document.getElementById('tituloConfirma').textContent), { timeout: 8000 });

    await caso('CRITERIO: escolher o arquivo mostra o que vai entrar, e desistir nao grava nada', async () => {
      const antes = await projetos();
      await escolherArquivo();
      await modalAberto();
      const texto = await pg.$eval('#textoConfirma', el => el.textContent);
      assert.ok(/1 evidência\(s\)/.test(texto) && /2 passo\(s\)/.test(texto), texto);
      assert.ok(/Projeto do backup/.test(texto) && /Nada do que já existe/.test(texto), texto);
      assert.ok(!/<\/?b>/.test(texto), 'a marcacao apareceu como texto: ' + texto);
      await pg.click('#btnNao');
      await delay(700);
      assert.deepStrictEqual(await projetos(), antes, 'desistiu e mesmo assim criou projeto');
    });

    await caso('confirmar cria o projeto novo, sem mexer nos que existiam', async () => {
      const antes = await projetos();
      await escolherArquivo();
      await modalAberto();
      await pg.click('#btnSim');
      await pg.waitForFunction(n => document.querySelectorAll('#gradeProjetos .cartao[data-projeto]').length === n, { timeout: 8000 }, antes.length + 1);
      const depois = await projetos();
      assert.ok(depois.includes('Projeto do backup'), depois.join(' | '));
      for (const nome of antes) assert.ok(depois.includes(nome), 'sumiu o projeto ' + nome);
    });

    await caso('CRITERIO: restaurar o mesmo arquivo de novo nao gera dois cartoes com o mesmo nome', async () => {
      await escolherArquivo();
      await modalAberto();
      assert.ok(/Projeto do backup \(restaurado\)/.test(await pg.$eval('#textoConfirma', el => el.textContent)));
      await pg.click('#btnSim');
      await pg.waitForFunction(() => [...document.querySelectorAll('#gradeProjetos .cartao[data-projeto] h3')]
        .some(h => /\(restaurado\)/.test(h.textContent)), { timeout: 8000 });
      const nomes = await projetos();
      assert.strictEqual(new Set(nomes.map(n => n.toLowerCase())).size, nomes.length, 'nomes repetidos: ' + nomes.join(' | '));
    });

    await caso('arquivo que nao e backup continua sendo recusado, sem pedir confirmacao', async () => {
      await pg.evaluate(async () => {
        const input = document.getElementById('arqBackup');
        const dt = new DataTransfer();
        dt.items.add(new File(['{"qualquer":"coisa"}'], 'x.json', { type: 'application/json' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await pg.waitForFunction(() => /não é um backup/.test(document.getElementById('textoConfirma').textContent), { timeout: 8000 });
      assert.ok(!/Restaurar backup/.test(await pg.$eval('#tituloConfirma', el => el.textContent)));
      await pg.click('#btnNao').catch(() => pg.click('#btnSim'));
    });

    await caso('salvar uma evidencia avisa que ela fica so no navegador', () => {
      const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
      assert.ok(/Ela fica só neste navegador: exporte o HTML para compartilhar/.test(html));
    });

    /* ---------- retorno de 12/11/2026: aviso em cima do Salvar, URL vazando do cartao ---------- */

    const cruza = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const medirAviso = () => pg.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const aviso = document.querySelector('.aviso-toast.visivel');
      return aviso ? { aviso: r(aviso), rodape: r(document.querySelector('#telaGravador .rodape-fixo')),
        topo: r(document.querySelector('.topo')), largura: innerWidth } : null;
    });
    /* Um passo chegando do complemento e o aviso mais comum da tela de gravacao. */
    const chegarPasso = n => pg.evaluate(i => window.postMessage({ tipo: 'AUDI_PRINT_PASSO', origem: {},
      passo: { id: 'ux-' + i, titulo: 'Clicou em "Salvar"', acao: 'Clicar', rotulo: 'Salvar', elemento: '//*[@id="salvar"]',
        elementoId: 'salvar', html: '<button id="salvar">Salvar</button>', imagens: [] } }, location.origin), n);

    await caso('CRITERIO: o aviso flutuante nao cobre "Salvar no projeto", nem em janela estreita', async () => {
      await pg.click('#gradeProjetos .cartao[data-projeto]');
      await pg.waitForSelector('[data-acao="novaGravacao"]', { visible: true });
      await pg.click('[data-acao="novaGravacao"]');
      await pg.waitForSelector('#btnIniciar', { visible: true });
      for (const [i, largura] of [1280, 600].entries()) {
        await pg.setViewport({ width: largura, height: 720 });
        await delay(300);
        await chegarPasso(i);
        await pg.waitForSelector('.aviso-toast.visivel', { timeout: 4000 });
        await delay(500);   // o aviso entra deslizando
        /* No fim da pagina a barra de botoes descola da borda de baixo e sobe:
         * era ali que o aviso antigo, preso a 92px do rodape, caia em cima dela. */
        for (const onde of ['topo', 'fim']) {
          await pg.evaluate(o => window.scrollTo(0, o === 'fim' ? document.body.scrollHeight : 0), onde);
          await delay(150);
          const m = await medirAviso();
          assert.ok(m, 'o aviso nao apareceu em ' + largura + 'px');
          const lugar = 'em ' + largura + 'px, no ' + onde + ' da pagina, ';
          assert.ok(!cruza(m.aviso, m.rodape), lugar + 'o aviso ficou em cima da barra de Salvar no projeto');
          assert.ok(m.aviso.top >= m.topo.bottom, lugar + 'o aviso ficou em cima do cabecalho');
          assert.ok(m.aviso.left >= 0 && m.aviso.right <= m.largura, lugar + 'o aviso saiu da tela');
          /* A metade de baixo da tela e onde moram os botoes de acao: a barra
           * de Salvar e os botoes das janelas de confirmacao. O aviso fica fora dela. */
          assert.ok(m.aviso.bottom < 360, lugar + 'o aviso voltou para a metade de baixo da tela, em cima dos botoes de acao');
        }
        await pg.keyboard.press('Escape');
        await delay(400);
      }
      await pg.setViewport({ width: 1280, height: 720 });
    });

    await caso('CRITERIO: endereco comprido na observacao quebra linha, nao vaza do cartao', async () => {
      /* Na evidencia salva, que e onde o cliente le: o campo da tela de gravacao
       * ja quebrava, o da evidencia nao. */
      // Sair da gravacao aberta pergunta antes: aqui a resposta e sempre sim.
      pg.on('dialog', d => d.accept().catch(() => {}));
      await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await pg.click('#entrarSite').catch(() => {});
      await pg.waitForSelector('#gradeProjetos .cartao[data-projeto]', { visible: true });
      await pg.evaluate(() => [...document.querySelectorAll('#gradeProjetos .cartao[data-projeto]')]
        .find(c => c.querySelector('h3').textContent.trim() === 'Projeto do backup').click());
      await pg.waitForSelector('[data-abrir]', { visible: true });
      await pg.click('[data-abrir]');
      await pg.waitForSelector('#conteudoRegistro .ficha .largo .val', { visible: true });
      const m = await pg.evaluate(() => {
        const campo = document.querySelector('#conteudoRegistro .ficha .largo .val');
        /* A caixa do campo nao cresce: quem vaza e o texto. scrollWidth maior
         * que a largura visivel e o sinal de que ele passou da borda. */
        return { texto: campo.scrollWidth, caixa: campo.clientWidth, tem: campo.textContent.length,
          campo: campo.getBoundingClientRect().right, ficha: campo.closest('.ficha').getBoundingClientRect().right };
      });
      assert.ok(m.tem > 300, 'a observacao comprida nao chegou na evidencia');
      assert.ok(m.texto <= m.caixa + 1, 'o texto vazou do campo: ' + m.texto + 'px de texto em ' + m.caixa + 'px de campo');
      assert.ok(m.campo <= m.ficha + 1, 'o campo passou da borda da ficha');
    });

    await caso('nenhum erro de script', () => assert.deepStrictEqual(erros, []));
  } finally {
    if (nav) await nav.close();
    proc.kill();
    await delay(300);
  }
  console.log(falhas ? '\nRESULTADO: FALHOU (' + falhas + ')\n' : '\nRESULTADO: PASSOU (' + feitos + ' casos)\n');
  process.exit(falhas ? 1 : 0);
})().catch(err => { console.error('\nERRO GERAL: ' + err.message + '\n' + err.stack); process.exit(1); });
