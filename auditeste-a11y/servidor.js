/* Ponte entre o Audi Print e as ferramentas de scan.
 *
 * Página em navegador não executa Node — então os botões do Print chamam
 * este servidor, ele roda o scan e devolve o JSON.
 *
 *   npm run servidor                      local, sem token
 *   HOST=0.0.0.0 PONTE_TOKEN=... npm run servidor    exposto
 *
 * Motores:
 *   /scan?tipo=axe|pa11y|nota|lighthouse&url=https://...
 *   /ping  — healthcheck + status dos motores
 *   /cenarios — Gherkin por IA (precisa ANTHROPIC_API_KEY)
 *
 * Variáveis:
 *   PONTE_TOKEN         obrigatório quando HOST não é loopback (para scans)
 *   ANTHROPIC_API_KEY   habilita Gerar com IA
 *   PONTE_DOMINIOS      allowlist de domínios (o controle mais forte)
 *   PONTE_PRIVADO=1     libera IP privado (só para uso local)
 *   PONTE_MAX           scans simultâneos, padrão 2
 *   PONTE_ORIGENS       origens de CORS, padrão *
 *   CHROME_PATH         caminho explícito do Chrome (opcional)
 */
const { carregarEnvs } = require('./carregar-env.js');
const envs = carregarEnvs();

const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const { scanAxe, scanPa11y, scanLighthouse, statusMotores } = require('./a11y.js');
const { gerarCenarios, MODELO } = require('./cenarios.js');

const LIMITE_CORPO = Number(process.env.PONTE_LIMITE_MB || 25) * 1024 * 1024;

const PORTA = Number(process.env.PORT || process.env.PORTA_PONTE) || 8900;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.PONTE_TOKEN || '';
const MAX = Number(process.env.PONTE_MAX) || 2;
const ORIGENS = process.env.PONTE_ORIGENS || '*';
const DOMINIOS = (process.env.PONTE_DOMINIOS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/* Aliases: o Print usa "nota" para Lighthouse; também aceita "lighthouse". */
const MOTORES = {
  axe: scanAxe,
  pa11y: scanPa11y,
  nota: scanLighthouse,
  lighthouse: scanLighthouse
};

const ROTULOS = {
  axe: 'axe-core',
  pa11y: 'Pa11y',
  nota: 'Lighthouse',
  lighthouse: 'Lighthouse'
};

const ehLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
const EXPOSTO_SEM_TOKEN = !ehLoopback && !TOKEN;

const PRIVADO_OK = process.env.PONTE_PRIVADO === '1' ? true
  : process.env.PONTE_PRIVADO === '0' ? false
  : ehLoopback;

if (EXPOSTO_SEM_TOKEN) {
  console.warn('PONTE_TOKEN não definido — scans liberados só pela mesma origem (Print nesta URL).');
  console.warn('Defina PONTE_TOKEN na Railway para exigir token em todas as chamadas.');
}

function cabecalho(origem) {
  const permitida = ORIGENS === '*' ? '*'
    : (ORIGENS.split(',').map(s => s.trim()).includes(origem) ? origem : 'null');
  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function responder(res, status, corpo, origem) {
  res.writeHead(status, cabecalho(origem));
  res.end(JSON.stringify(corpo));
}

function faixaPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
}

async function recusar(alvo) {
  let u;
  try { u = new URL(alvo); } catch (e) { return `url inválida: ${alvo}`; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `protocolo não permitido: ${u.protocol}`;

  const host = u.hostname.toLowerCase();
  if (DOMINIOS.length && !DOMINIOS.some(d => host === d || host.endsWith('.' + d))) {
    return `domínio fora da allowlist: ${host}`;
  }
  if (PRIVADO_OK) return null;

  let enderecos;
  try {
    enderecos = await dns.lookup(host, { all: true });
  } catch (e) {
    return `não resolveu o domínio: ${host}`;
  }
  if (enderecos.some(e => faixaPrivada(e.address))) {
    return `endereço de rede interna bloqueado: ${host}`;
  }
  return null;
}

const PUBLICO = path.resolve(process.env.PONTE_PUBLICO || path.join(__dirname, 'publico'));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json'
};

function servirArquivo(req, res, pathname) {
  const nome = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const arquivo = path.resolve(PUBLICO, nome);
  if (!arquivo.startsWith(PUBLICO + path.sep) && arquivo !== PUBLICO) return false;
  if (!fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) return false;
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
  return true;
}

function lerCorpo(req) {
  return new Promise((ok, erro) => {
    let bytes = 0;
    const partes = [];
    req.on('data', d => {
      bytes += d.length;
      if (bytes > LIMITE_CORPO) { erro(new Error(`corpo acima de ${LIMITE_CORPO / 1048576} MB`)); req.destroy(); return; }
      partes.push(d);
    });
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (e) { erro(new Error('JSON inválido: ' + e.message)); }
    });
    req.on('error', erro);
  });
}

function hostPublico(req) {
  const bruto = req.headers['x-forwarded-host'] || req.headers.host || '';
  return bruto.split(',')[0].split(':')[0].trim().toLowerCase();
}

/** Sem PONTE_TOKEN, libera scans só do Print hospedado na mesma URL. */
function mesmaOrigem(req) {
  const host = hostPublico(req);
  if (!host) return false;

  const origem = req.headers.origin;
  if (origem) {
    try { return new URL(origem).hostname.toLowerCase() === host; } catch (e) { return false; }
  }

  const ref = req.headers.referer;
  if (ref) {
    try { return new URL(ref).hostname.toLowerCase() === host; } catch (e) { return false; }
  }

  return false;
}

function tokenInvalido(req, u) {
  if (!TOKEN) {
    if (ehLoopback) return false;
    return !mesmaOrigem(req);
  }
  const enviado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || u.searchParams.get('token') || '';
  return enviado !== TOKEN;
}

function msgToken(req) {
  if (!TOKEN && !ehLoopback && !mesmaOrigem(req)) {
    return 'Acesso negado. Abra o Print nesta mesma URL ou configure PONTE_TOKEN.';
  }
  return 'token inválido ou ausente';
}

let rodando = 0;

const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || '';
  const u = new URL(req.url, `http://${HOST}:${PORTA}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cabecalho(origem));
    return res.end();
  }

  if (u.pathname === '/ping' || u.pathname === '/health') {
    const motores = statusMotores();
    return responder(res, 200, {
      ok: true,
      motores: ['axe', 'pa11y', 'nota'],
      aliases: { lighthouse: 'nota' },
      status: motores,
      exigeToken: !!TOKEN,
      modo: TOKEN ? 'token' : (ehLoopback ? 'local' : 'mesma-origem'),
      ocupado: rodando,
      limite: MAX,
      cenarios: !!process.env.ANTHROPIC_API_KEY,
      modelo: MODELO,
      aviso: EXPOSTO_SEM_TOKEN
        ? 'Sem PONTE_TOKEN: scans funcionam abrindo o Print nesta URL. Defina PONTE_TOKEN para exigir token.'
        : undefined
    }, origem);
  }

  if (u.pathname === '/cenarios') {
    if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' }, origem);
    if (tokenInvalido(req, u)) return responder(res, 401, { erro: msgToken(req) }, origem);
    if (rodando >= MAX) {
      return responder(res, 429, { erro: `${MAX} trabalhos já em andamento, tente em instantes` }, origem);
    }

    rodando++;
    const inicio = Date.now();
    process.stdout.write('cenários ... ');
    try {
      const corpo = await lerCorpo(req);
      const dados = await gerarCenarios(corpo);
      console.log(`ok (${((Date.now() - inicio) / 1000).toFixed(1)}s, ${dados.imagens} imagem(ns), ${dados.uso.saida} tokens)`);
      return responder(res, 200, dados, origem);
    } catch (err) {
      console.log('FALHOU: ' + err.message);
      return responder(res, err.semChave ? 503 : err.recusa ? 422 : 500, { erro: err.message }, origem);
    } finally {
      rodando--;
    }
  }

  if (u.pathname !== '/scan') {
    if (req.method === 'GET' && servirArquivo(req, res, u.pathname)) return;
    return responder(res, 404, { erro: 'rota desconhecida' }, origem);
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return responder(res, 405, { erro: 'use GET ou POST' }, origem);
  }
  if (tokenInvalido(req, u)) return responder(res, 401, { erro: msgToken(req) }, origem);

  let tipo = (u.searchParams.get('tipo') || '').toLowerCase().trim();
  let alvo = (u.searchParams.get('url') || '').trim();

  /* POST JSON { tipo, url } — útil para URLs longas */
  if (req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      if (corpo.tipo) tipo = String(corpo.tipo).toLowerCase().trim();
      if (corpo.url) alvo = String(corpo.url).trim();
    } catch (err) {
      return responder(res, 400, { erro: err.message }, origem);
    }
  }

  if (!MOTORES[tipo]) {
    return responder(res, 400, {
      erro: `tipo desconhecido: ${tipo || '(vazio)'}`,
      tipos: ['axe', 'pa11y', 'nota'],
      aliases: { lighthouse: 'nota' }
    }, origem);
  }
  if (!alvo) return responder(res, 400, { erro: 'url ausente' }, origem);

  const motivo = await recusar(alvo);
  if (motivo) return responder(res, 400, { erro: motivo }, origem);

  if (rodando >= MAX) {
    return responder(res, 429, { erro: `${MAX} scans já em andamento, tente em instantes` }, origem);
  }

  rodando++;
  const inicio = Date.now();
  const rotulo = ROTULOS[tipo] || tipo;
  process.stdout.write(`${rotulo.padEnd(12)} ${alvo} ... `);
  try {
    const dados = await MOTORES[tipo](alvo);
    console.log(`ok (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
    responder(res, 200, dados, origem);
  } catch (err) {
    console.log('FALHOU: ' + err.message);
    responder(res, 500, { erro: err.message, motor: rotulo }, origem);
  } finally {
    rodando--;
  }
});

/* Lighthouse pode passar de 60s — sem isso o socket cai no meio do scan. */
servidor.requestTimeout = 0;
servidor.headersTimeout = 120000;
servidor.timeout = 180000;

servidor.listen(PORTA, HOST, () => {
  const st = statusMotores();
  console.log(`ponte ouvindo em http://${HOST}:${PORTA}`);
  if (envs.length) console.log('env: ' + envs.join(', '));
  console.log(`token: ${TOKEN ? 'exigido' : 'não'} · máx ${MAX} simultâneos`
    + ` · allowlist: ${DOMINIOS.length ? DOMINIOS.join(', ') : 'nenhuma'}`
    + ` · rede privada: ${PRIVADO_OK ? 'liberada' : 'bloqueada'}`);
  console.log(`motores: axe=${st.axe.ok ? 'ok' : 'FALHA'} · pa11y=${st.pa11y.ok ? 'ok' : 'FALHA'} · lighthouse=${st.nota.ok ? 'ok' : 'FALHA'}`);
  console.log(`cenários IA: ${process.env.ANTHROPIC_API_KEY ? 'ligado (' + MODELO + ')' : 'desligado — defina ANTHROPIC_API_KEY'}`);
  if (st.chrome) console.log(`chrome: ${st.chrome}`);
  if (ehLoopback) console.log('deixe aberto e use os botões de scan no Audi Print.\n');
});
