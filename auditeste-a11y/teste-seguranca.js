/* Trava as correções da auditoria de segurança.
 *
 *   node teste-seguranca.js
 *
 * Sem rede: lê o código e exercita as funções puras.
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const path = require('path');

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

const html = fs.readFileSync(path.join(__dirname, 'publico', 'index.html'), 'utf8');
const servidor = fs.readFileSync(path.join(__dirname, 'servidor.js'), 'utf8');

/* --- esc() do Print --- */
const fonteEsc = /const esc = t => [\s\S]*?\}\[c\]\)\);/.exec(html);
assert.ok(fonteEsc, 'não achei esc() no index.html');
const esc = new Function('return ' + fonteEsc[0].replace(/^const esc = /, ''))();

caso('esc escapa aspas, e não só < > &', () => {
  assert.strictEqual(esc('a"b'), 'a&quot;b');
  assert.strictEqual(esc("a'b"), 'a&#39;b');
  assert.strictEqual(esc('<script>'), '&lt;script&gt;');
  assert.strictEqual(esc('a&b'), 'a&amp;b');
});

caso('esc não quebra um atributo com aspas', () => {
  // rótulo real de site: <button title="Ir para 'Meus dados'">
  const attr = `title="${esc('Ir para "Meus dados"')}"`;
  assert.ok(!/title="[^"]*"[^"]/.test(attr.slice(6)), 'o atributo foi fechado no meio');
  assert.ok(!attr.includes('""'), 'aspas cruas sobraram no atributo');
});

caso('esc aceita null e número sem explodir', () => {
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(42), '42');
});

/* --- faixaPrivada, agora em rede-segura.js --- */
const { faixaPrivada } = require('./rede-segura.js');

caso('bloqueia rede interna escrita como IPv6 mapeado', () => {
  assert.strictEqual(faixaPrivada('::ffff:127.0.0.1'), true);
  assert.strictEqual(faixaPrivada('::ffff:10.0.0.5'), true);
  assert.strictEqual(faixaPrivada('::ffff:192.168.1.1'), true);
});

caso('bloqueia CGNAT (100.64/10)', () => {
  assert.strictEqual(faixaPrivada('100.64.0.1'), true);
  assert.strictEqual(faixaPrivada('100.127.255.254'), true);
  assert.strictEqual(faixaPrivada('100.128.0.1'), false);   // já é público
});

caso('continua deixando passar endereço público', () => {
  ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '2606:4700::1111']
    .forEach((ip) => assert.strictEqual(faixaPrivada(ip), false, ip + ' foi bloqueado sem motivo'));
});

/* --- comparação do token --- */
const fonteSeg = servidor.slice(servidor.indexOf('function mesmoSegredo'), servidor.indexOf('function tokenInvalido'));
const mesmoSegredo = new Function('crypto', fonteSeg + ';return mesmoSegredo;')(crypto);

caso('token compara em tempo fixo e não vaza no tamanho', () => {
  assert.strictEqual(mesmoSegredo('abc123', 'abc123'), true);
  assert.strictEqual(mesmoSegredo('abc123', 'abc124'), false);
  assert.strictEqual(mesmoSegredo('', 'abc123'), false);      // tamanhos diferentes
  assert.strictEqual(mesmoSegredo('abc123xxxx', 'abc123'), false);
  assert.strictEqual(mesmoSegredo('', ''), true);
});

/* --- o vídeo não pode mais ser apagado ao trazer a captura --- */
caso('trazer a captura não zera a caixa de vídeo', () => {
  assert.ok(!/aplicarEvidenciaImportada/.test(html), 'a função que apagava o vídeo voltou');
  const fn = html.slice(html.indexOf('function acrescentarPassos'), html.indexOf('function acrescentarPassos') + 1200);
  assert.ok(!/caixaVideo\.innerHTML/.test(fn), 'acrescentarPassos mexe na caixa de vídeo');
  assert.ok(!/lista\.innerHTML\s*=/.test(fn), 'acrescentarPassos limpa a lista');
});

caso('o aviso com destaque não mostra tag crua', () => {
  assert.ok(/alvoTexto\.innerHTML/.test(html), 'informar voltou a ser só textContent');
  assert.ok(/&lt;b&gt;/.test(html), 'o destaque não passa por escape antes');
});

caso('nenhuma funcao do Print declarada duas vezes', () => {
  /* Editar um arquivo de 4 mil linhas por busca e substituicao deixa copia
     para tras: a segunda declaracao vence calada, e a correcao aplicada na
     primeira nunca roda. Ja aconteceu com completarComONavegador. */
  const vistos = new Map();
  const re = new RegExp('\\n  (?:async )?function ([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
  for (const m of html.matchAll(re)) vistos.set(m[1], (vistos.get(m[1]) || 0) + 1);
  const repetidas = [...vistos].filter(([, q]) => q > 1).map(([nome, q]) => nome + ' (' + q + 'x)');
  assert.deepStrictEqual(repetidas, [], 'declaradas mais de uma vez: ' + repetidas.join(', '));
});

caso('a descricao roda mesmo sem passo novo', () => {
  const fn = html.slice(html.indexOf('async function completarComONavegador'),
                        html.indexOf('const trazerSozinho'));
  assert.ok(/finally[\s\S]*gerarDescricoesPendentes/.test(fn),
    'gerarDescricoesPendentes precisa rodar no finally: com todos os passos ja '
    + 'chegados ao vivo, um return antecipado deixava a gravacao sem cenario');
  assert.ok(fn.indexOf('if(!novos) return;') === -1, 'o return que pulava a descricao voltou');
});

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
