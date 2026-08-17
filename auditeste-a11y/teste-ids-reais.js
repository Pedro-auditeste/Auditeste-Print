/* Ids reais pelo link: o catálogo vem do DOM e a IA só pode escolher dele.
 *
 *   node teste-ids-reais.js
 *
 * Não usa a NVIDIA: simula a escolha da IA para testar a trava, que é o que
 * separa id de verdade de invenção.
 */
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const { casarComCatalogo, controlesValidos } = require('./agente-cenarios.js');

const PORTA_PONTE = 8996;
const PORTA_SITE = 8997;

const SITE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja</title></head>
<body style="font-family:system-ui;padding:40px">
  <h1>Garantia estendida</h1>
  <button id="btn-comprar-agora" class="cta verde">Comprar</button>
  <a href="/mais" data-qa="link-ver-mais">Ver mais</a>
  <input id="campo-busca" type="text" placeholder="Buscar">
  <label><input type="radio" name="garantia" value="36"> + 36 meses</label>
  <div id="so-texto">Subtotal R$ 1.765,98</div>
</body></html>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const site = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SITE);
  }).listen(PORTA_SITE, '127.0.0.1');

  const ponte = spawn(process.execPath, ['servidor.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { PORT: String(PORTA_PONTE), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await esperar(3500);

  const pedir = (corpo) => new Promise((ok, no) => {
    const dados = JSON.stringify(corpo);
    const req = http.request({
      host: '127.0.0.1', port: PORTA_PONTE, path: '/elementos', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }
    }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } });
    });
    req.on('error', no);
    req.end(dados);
  });

  let n = 0;
  const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

  try {
    console.log('--- catalogo vem do DOM de verdade ---');
    const cat = await pedir({ url: `http://127.0.0.1:${PORTA_SITE}/` });
    assert.ok(!cat.erro, 'erro: ' + cat.erro);
    const elementos = cat.elementos || [];
    console.log('  ' + elementos.length + ' elemento(s): '
      + elementos.map((e) => e.seletor).join(', '));

    caso('traz o id que a pagina tem', () => {
      const comprar = elementos.find((e) => e.rotulo === 'Comprar');
      assert.ok(comprar, 'não achei o botão Comprar');
      assert.strictEqual(comprar.seletor, '#btn-comprar-agora',
        'seletor não é o id real: ' + comprar.seletor);
      assert.match(comprar.html, /<button id="btn-comprar-agora"/, 'HTML real não veio');
    });

    caso('prefere data-qa quando nao ha id', () => {
      const verMais = elementos.find((e) => e.rotulo === 'Ver mais');
      assert.ok(verMais, 'não achei Ver mais');
      assert.match(verMais.seletor, /data-qa="link-ver-mais"/, 'seletor: ' + verMais.seletor);
    });

    caso('texto sem acao nao entra no catalogo', () => {
      assert.ok(!elementos.some((e) => e.seletor === '#so-texto'),
        'div de texto entrou como elemento clicável');
    });

    console.log('--- a IA so pode escolher da lista ---');

    const iComprar = elementos.findIndex((e) => e.rotulo === 'Comprar');
    const daIa = [
      { rotulo: 'Comprar', tipo: 'botao', localizador: "getByRole('button', { name: 'Comprar' })", n: iComprar },
      { rotulo: 'Fantasma', tipo: 'botao', localizador: "getByText('Fantasma')", n: 999 },
      { rotulo: 'Sem indice', tipo: 'botao', localizador: "getByText('Sem indice')" }
    ];
    const r = controlesValidos(casarComCatalogo(daIa, elementos));

    caso('o escolhido recebe id e HTML reais', () => {
      const c = r.find((x) => x.rotulo === 'Comprar');
      assert.ok(c, 'perdeu o Comprar');
      assert.strictEqual(c.elemento, '#btn-comprar-agora', 'id não veio do catálogo: ' + c.elemento);
      assert.match(c.html, /<button id="btn-comprar-agora"/, 'HTML não veio do catálogo');
    });

    caso('indice fora da lista nao vira id', () => {
      const c = r.find((x) => x.rotulo === 'Fantasma');
      assert.ok(c, 'sumiu o item');
      assert.strictEqual(c.elemento, '', 'inventou id para índice inexistente: ' + c.elemento);
    });

    caso('sem indice fica so com o localizador por texto', () => {
      const c = r.find((x) => x.rotulo === 'Sem indice');
      assert.strictEqual(c.elemento, '', 'inventou id sem a IA apontar');
      assert.match(c.localizador, /getByText/, 'perdeu o localizador');
    });

    console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
  } finally {
    ponte.kill();
    site.close();
  }
})().catch((e) => { console.error('FALHA: ' + e.message); process.exit(1); });
