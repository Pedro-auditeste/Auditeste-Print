/* Controles do Marco 1 que dependem só de ler o código, sem navegador.
 *
 * Cada caso aqui existe porque a falha correspondente já esteve viva no
 * sistema. Não é teste de "será que funciona": é trava para não voltar.
 *
 *   node teste-privacidade.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PAGINA = path.join(__dirname, 'publico', 'index.html');
const ESPELHO = path.join(RAIZ, 'audi-print', 'evidencias-auditeste.html');
const CONTENT = path.join(RAIZ, 'audi-print-scanner', 'content.js');
const BACKGROUND = path.join(RAIZ, 'audi-print-scanner', 'background.js');

const ler = f => fs.readFileSync(f, 'utf8');
let falhas = 0;

function caso(nome, fn) {
  try {
    fn();
    console.log('  ok   ' + nome);
  } catch (err) {
    falhas++;
    console.log('  FALHOU ' + nome);
    console.log('         ' + err.message.split('\n')[0]);
  }
}

/* Roda a função exportada pelo content script sem navegador: recorta o
 * trecho do arquivo e avalia. Regex frouxa de propósito no fim (\n  }),
 * porque o corpo tem chaves e um match guloso levaria o arquivo inteiro. */
function extrair(fonte, nomes) {
  const partes = nomes.map((n) => {
    const re = new RegExp('\\n  function ' + n + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}');
    const m = re.exec(fonte);
    assert.ok(m, 'não achei a função ' + n + ' em content.js');
    return m[0];
  });
  return partes.join('\n');
}

console.log('\nprivacidade e retencao\n');

const pagina = ler(PAGINA);
const content = ler(CONTENT);
const background = ler(BACKGROUND);

/* ---------- consentimento ---------- */

caso('projeto sem o campo continua liberado (nao quebra banco antigo)', () => {
  const m = /const iaLiberada = ([^;]+);/.exec(pagina);
  assert.ok(m, 'iaLiberada não encontrada');
  const iaLiberada = new Function('return ' + m[1])();
  assert.strictEqual(iaLiberada(undefined), true, 'sem projeto deveria liberar');
  assert.strictEqual(iaLiberada({}), true, 'projeto da versão antiga deveria continuar liberado');
  assert.strictEqual(iaLiberada({ iaPermitida: true }), true);
  assert.strictEqual(iaLiberada({ iaPermitida: false }), false, 'false explícito tem que bloquear');
});

caso('o bloqueio fica antes do fetch, nao depois', () => {
  const i = pagina.indexOf('const e = new Error(MOTIVO_IA_BLOQUEADA)');
  const j = pagina.indexOf("fetch(alvo.url + '/descrever'");
  assert.ok(i > 0 && j > 0, 'não achei o bloqueio ou o envio');
  assert.ok(i < j, 'o bloqueio precisa vir antes do envio, senão a evidência já saiu');
});

caso('todo envio passa por registrarEnvio', () => {
  for (const rota of ['/descrever', '/cenarios']) {
    const re = new RegExp("registrarEnvio\\('" + rota + "'");
    assert.ok(re.test(pagina), 'nada registra o envio para ' + rota);
  }
});

/* ---------- mascaramento ---------- */

const cs = new Function(
  extrair(content, ['passaLuhn', 'valorSensivel', 'campoSensivel'])
  + '\n' + /const NOME_SENSIVEL = [^\n]+/.exec(content)[0]
  + '\n' + /const AUTO_SENSIVEL = [^\n]+/.exec(content)[0]
  + '\nreturn { campoSensivel, valorSensivel };'
)();

const campo = (attrs) => ({
  type: attrs.type || 'text',
  name: attrs.name || '',
  id: attrs.id || '',
  value: attrs.value || '',
  getAttribute: (k) => attrs[k] || null
});

caso('senha continua mascarada', () => {
  assert.strictEqual(cs.campoSensivel(campo({ type: 'password' }), 'segredo123'), true);
});

caso('CPF em campo de texto comum e mascarado', () => {
  assert.strictEqual(cs.valorSensivel('529.982.247-25'), true, 'CPF com máscara');
  assert.strictEqual(cs.valorSensivel('52998224725'), true, 'CPF sem máscara');
});

caso('CNPJ e mascarado', () => {
  assert.strictEqual(cs.valorSensivel('11.222.333/0001-81'), true);
});

caso('cartao valido e mascarado, numero longo qualquer nao e', () => {
  assert.strictEqual(cs.valorSensivel('4111 1111 1111 1111'), true, 'cartão de teste passa no Luhn');
  assert.strictEqual(cs.valorSensivel('1234567812345670'), true, 'este também passa no Luhn');
  assert.strictEqual(cs.valorSensivel('4111111111111112'), false,
    'número que falha no Luhn não é cartão: mascarar seria perder evidência à toa');
});

caso('campo pelo nome, antes de digitar qualquer coisa', () => {
  assert.strictEqual(cs.campoSensivel(campo({ name: 'txtSenha' }), ''), true);
  assert.strictEqual(cs.campoSensivel(campo({ id: 'documento-cpf' }), ''), true);
  assert.strictEqual(cs.campoSensivel(campo({ 'aria-label': 'Número do cartão' }), ''), true);
  assert.strictEqual(cs.campoSensivel(campo({ autocomplete: 'cc-number' }), ''), true);
});

caso('campo comum nao e mascarado', () => {
  assert.strictEqual(cs.campoSensivel(campo({ name: 'email' }), 'teste@auditeste.com'), false);
  assert.strictEqual(cs.campoSensivel(campo({ name: 'pedido' }), 'PED-99871'), false);
  assert.strictEqual(cs.campoSensivel(campo({ name: 'quantidade' }), '3'), false);
});

caso('o outerHTML tambem perde o value quando o campo e sensivel', () => {
  assert.ok(/function htmlSeguro/.test(content), 'htmlSeguro não existe');
  assert.ok(!/html: el\.outerHTML/.test(content),
    'o outerHTML cru voltou a ser gravado: o value renderizado pelo servidor vaza por ali');
});

/* ---------- ponte da extensao ---------- */

caso('arquivo aberto do disco nao recebe as gravacoes', () => {
  const m = /function paginaDoPrint\(\)\s*\{[\s\S]*?\n  \}/.exec(content);
  assert.ok(m, 'paginaDoPrint não encontrada');
  const corpo = m[0];
  assert.ok(!/location\.protocol === 'file:'\s*\)\s*return true/.test(corpo),
    'file: voltou a ser tratado como página do Print');

  const paginaDoPrint = new Function('location',
    "const ORIGENS_PRINT = ['https://audiprint.up.railway.app'];\n"
    + corpo + '\nreturn paginaDoPrint();');

  assert.strictEqual(paginaDoPrint({ origin: 'file://', protocol: 'file:', hostname: '' }), false,
    'html do disco não pode pedir as evidências');
  assert.strictEqual(paginaDoPrint({ origin: 'https://audiprint.up.railway.app', protocol: 'https:', hostname: 'audiprint.up.railway.app' }), true);
  assert.strictEqual(paginaDoPrint({ origin: 'http://127.0.0.1:8900', protocol: 'http:', hostname: '127.0.0.1' }), true);
  assert.strictEqual(paginaDoPrint({ origin: 'https://loja-do-cliente.com', protocol: 'https:', hostname: 'loja-do-cliente.com' }), false,
    'site testado não pode pedir as evidências');
});

/* ---------- retencao ---------- */

caso('sessao vencida some, gravacao em andamento nunca vence', () => {
  const m = /function vencida\(s, agora\)\s*\{[\s\S]*?\n\}/.exec(background);
  assert.ok(m, 'vencida não encontrada');
  const dias = /const DIAS_GUARDADOS = (\d+);/.exec(background);
  assert.ok(dias, 'DIAS_GUARDADOS não encontrado');

  const vencida = new Function(
    'const DIAS_GUARDADOS = ' + dias[1] + ';\n'
    + 'const PRAZO_MS = DIAS_GUARDADOS * 24 * 60 * 60 * 1000;\n'
    + m[0] + '\nreturn vencida;')();

  const agora = Date.parse('2026-08-21T12:00:00Z');
  const velha = new Date(agora - 30 * 86400000).toISOString();
  const nova = new Date(agora - 3600000).toISOString();

  assert.strictEqual(vencida({ ativa: false, encerrada: velha }, agora), true, 'de 30 dias tem que vencer');
  assert.strictEqual(vencida({ ativa: false, encerrada: nova }, agora), false, 'de 1 hora não vence');
  assert.strictEqual(vencida({ ativa: true, inicio: velha }, agora), false,
    'gravação em andamento não pode ser apagada, mesmo aberta há dias');
  assert.strictEqual(vencida({ ativa: false }, agora), false, 'sem data não dá para afirmar que venceu');
  assert.strictEqual(vencida(null, agora), false);
});

caso('a poda por prazo mora no caminho de leitura', () => {
  const m = /async function todas\(\)\s*\{[\s\S]*?\n\}/.exec(background);
  assert.ok(m, 'todas() não encontrada');
  assert.ok(/vencida\(/.test(m[0]),
    'todas() sem checagem de prazo: sessão vencida volta por qualquer porta de leitura');
});

caso('excluir projeto alcanca a copia guardada no complemento', () => {
  assert.ok(/AUDI_DESCARTAR/.test(background), 'background não trata AUDI_DESCARTAR');
  assert.ok(/descartar\s*\?/.test(content), 'content não repassa o pedido');
  assert.ok(/await descartarNaExtensao\(\)/.test(pagina), 'a exclusão do projeto não chama o descarte');

  const m = /if \(msg\.tipo === 'AUDI_DESCARTAR'\)\s*\{[\s\S]*?\n    \}/.exec(background);
  assert.ok(m, 'handler do AUDI_DESCARTAR não encontrado');
  assert.ok(/s\.ativa/.test(m[0]) && /s\.importada/.test(m[0]),
    'o descarte precisa poupar a gravação em andamento e tocar só no que já foi trazido');
});

/* ---------- espelho ---------- */

caso('o gemeo esta identico', () => {
  assert.strictEqual(ler(ESPELHO), pagina,
    'audi-print/evidencias-auditeste.html ficou para trás: a correção vale só em metade do sistema');
});

/* ---------- cabecalhos ---------- */

const servidor = require('child_process');

console.log('\ncabecalhos da pagina servida\n');

const proc = servidor.spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
  env: Object.assign({}, process.env, { PORT: '8977', HOST: '127.0.0.1', AGENTE_API_KEY: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

const encerrar = (codigo) => { try { proc.kill(); } catch (e) {} process.exit(codigo); };

let subiu = false;
proc.stdout.on('data', (d) => {
  if (subiu || !/ponte ouvindo/.test(String(d))) return;
  subiu = true;
  http.get({ host: '127.0.0.1', port: 8977, path: '/' }, (res) => {
    res.resume();
    const h = res.headers;
    caso('nosniff', () => assert.strictEqual(h['x-content-type-options'], 'nosniff'));
    caso('Referrer-Policy same-origin (no-referrer derrubaria o portao da ponte)', () =>
      assert.strictEqual(h['referrer-policy'], 'same-origin'));
    caso('CSP com frame-ancestors e object-src', () => {
      assert.ok(h['content-security-policy'], 'sem CSP');
      assert.ok(/frame-ancestors 'none'/.test(h['content-security-policy']));
      assert.ok(/object-src 'none'/.test(h['content-security-policy']));
    });
    caso('HSTS fica de fora em http (o navegador ignora, e 127.0.0.1 nao usa tls)', () =>
      assert.strictEqual(h['strict-transport-security'], undefined));

    console.log(falhas ? '\n' + falhas + ' falha(s)\n' : '\ntudo certo\n');
    encerrar(falhas ? 1 : 0);
  }).on('error', (e) => {
    console.log('  FALHOU não consegui falar com o servidor: ' + e.message);
    encerrar(1);
  });
});

setTimeout(() => {
  if (subiu) return;
  console.log('  FALHOU o servidor não subiu em 25s');
  encerrar(1);
}, 25000);
