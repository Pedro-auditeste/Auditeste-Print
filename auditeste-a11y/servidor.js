/* Ponte entre o Audi Print e as ferramentas de scan.
 *
 * Página em navegador não executa Node — então os botões do Print chamam
 * este servidor, ele roda o scan e devolve o JSON.
 *
 *   npm run servidor                      local, sem token
 *   HOST=0.0.0.0 PONTE_TOKEN=... npm run servidor    exposto
 *
 * ── Exposto na internet, isto é um serviço que busca URLs por conta de
 * quem pedir. Sem trava vira SSRF: alguém manda escanear 169.254.169.254
 * e recebe as credenciais da sua instância. Por isso:
 *
 *   PONTE_TOKEN      obrigatório quando HOST não é loopback
 *   PONTE_DOMINIOS   allowlist de domínios (o controle mais forte)
 *   PONTE_PRIVADO=1  libera IP privado (só para uso local)
 *   PONTE_MAX        scans simultâneos, padrão 2
 *   PONTE_ORIGENS    origens de CORS, padrão *
 */
const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const { scanAxe, scanPa11y, scanLighthouse } = require('./a11y.js');
const { gerarCenarios, MODELO } = require('./cenarios.js');

/* imagens em base64 pesam; sem teto um POST pode derrubar a ponte */
const LIMITE_CORPO = Number(process.env.PONTE_LIMITE_MB || 25) * 1024 * 1024;

const PORTA = Number(process.env.PORT || process.env.PORTA_PONTE) || 8900;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.PONTE_TOKEN || '';
const MAX = Number(process.env.PONTE_MAX) || 2;
const ORIGENS = process.env.PONTE_ORIGENS || '*';
const DOMINIOS = (process.env.PONTE_DOMINIOS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const MOTORES = { axe: scanAxe, pa11y: scanPa11y, nota: scanLighthouse };

const ehLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
const EXPOSTO_SEM_TOKEN = !ehLoopback && !TOKEN;

/* Rede privada: bloqueada quando exposta, liberada quando local.
   Em loopback quem chama ja esta na maquina e alcanca tudo sozinho — barrar
   ali nao protege nada e so impede escanear o proprio servidor de dev.
   PONTE_PRIVADO=1 ou =0 manda em cima do padrao. */
const PRIVADO_OK = process.env.PONTE_PRIVADO === '1' ? true
  : process.env.PONTE_PRIVADO === '0' ? false
  : ehLoopback;
if (EXPOSTO_SEM_TOKEN) {
  console.error('AVISO: HOST=' + HOST + ' expõe a ponte, mas PONTE_TOKEN não foi definido.');
  console.error('O servidor sobe (healthcheck OK), porém /scan e /cenarios ficam bloqueados.');
  console.error('Defina PONTE_TOKEN nas variáveis de ambiente da Railway.');
}

/* ---------- CORS ---------- */
function cabecalho(origem) {
  const permitida = ORIGENS === '*' ? '*'
    : (ORIGENS.split(',').map(s => s.trim()).includes(origem) ? origem : 'null');
  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function responder(res, status, corpo, origem) {
  res.writeHead(status, cabecalho(origem));
  res.end(JSON.stringify(corpo));
}

/* ---------- SSRF ---------- */
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

/* Serve o Print pela propria ponte. Hospedado, isso vira uma URL so: o
   analista abre e o Print ja fala com a mesma origem, sem colar endereco. */
const PUBLICO = path.resolve(process.env.PONTE_PUBLICO || path.join(__dirname, 'publico'));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

function servirArquivo(req, res, pathname) {
  const nome = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const arquivo = path.resolve(PUBLICO, nome);
  /* o nome vem da URL: sem esta checagem, ../ le qualquer arquivo do disco */
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

function tokenInvalido(req, u) {
  if (!ehLoopback && !TOKEN) return true;
  if (!TOKEN) return false;
  const enviado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || u.searchParams.get('token') || '';
  return enviado !== TOKEN;
}

/* ---------- concorrencia: um scan sobe um navegador, uma geracao custa
     credito de API. O mesmo teto cobre os dois. ---------- */
let rodando = 0;

const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || '';
  const u = new URL(req.url, `http://${HOST}:${PORTA}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cabecalho(origem));
    return res.end();
  }

  if (u.pathname === '/ping') {
    return responder(res, 200, {
      ok: true, motores: Object.keys(MOTORES),
      exigeToken: !!TOKEN || !ehLoopback, ocupado: rodando, limite: MAX,
      cenarios: !!process.env.ANTHROPIC_API_KEY, modelo: MODELO,
      aviso: EXPOSTO_SEM_TOKEN ? 'PONTE_TOKEN não configurado — scans bloqueados' : undefined
    }, origem);
  }

  if (u.pathname === '/cenarios') {
    if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' }, origem);
    if (tokenInvalido(req, u)) {
    const msg = EXPOSTO_SEM_TOKEN ? 'PONTE_TOKEN não configurado no servidor'
      : 'token inválido ou ausente';
    return responder(res, 401, { erro: msg }, origem);
  }
    if (rodando >= MAX) return responder(res, 429, { erro: `${MAX} trabalhos já em andamento, tente em instantes` }, origem);

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
    /* antes de desistir, tenta servir o Print */
    if (req.method === 'GET' && servirArquivo(req, res, u.pathname)) return;
    return responder(res, 404, { erro: 'rota desconhecida' }, origem);
  }

  if (tokenInvalido(req, u)) {
    const msg = EXPOSTO_SEM_TOKEN ? 'PONTE_TOKEN não configurado no servidor'
      : 'token inválido ou ausente';
    return responder(res, 401, { erro: msg }, origem);
  }

  const tipo = u.searchParams.get('tipo');
  const alvo = u.searchParams.get('url');
  if (!MOTORES[tipo]) return responder(res, 400, { erro: `tipo desconhecido: ${tipo}` }, origem);
  if (!alvo) return responder(res, 400, { erro: 'url ausente' }, origem);

  const motivo = await recusar(alvo);
  if (motivo) return responder(res, 400, { erro: motivo }, origem);

  if (rodando >= MAX) {
    return responder(res, 429, { erro: `${MAX} scans já em andamento, tente em instantes` }, origem);
  }

  rodando++;
  const inicio = Date.now();
  process.stdout.write(`${tipo.padEnd(6)} ${alvo} ... `);
  try {
    const dados = await MOTORES[tipo](alvo);
    console.log(`ok (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
    responder(res, 200, dados, origem);
  } catch (err) {
    console.log('FALHOU: ' + err.message);
    responder(res, 500, { erro: err.message }, origem);
  } finally {
    rodando--;
  }
});

servidor.listen(PORTA, HOST, () => {
  console.log(`ponte ouvindo em http://${HOST}:${PORTA}`);
  console.log(`token: ${TOKEN ? 'exigido' : 'não'} · máx ${MAX} simultâneos`
    + ` · allowlist: ${DOMINIOS.length ? DOMINIOS.join(', ') : 'nenhuma'}`
    + ` · rede privada: ${PRIVADO_OK ? 'liberada' : 'bloqueada'}`);
  if (ehLoopback) console.log('deixe aberto e use os botões de scan no Audi Print.\n');
});
