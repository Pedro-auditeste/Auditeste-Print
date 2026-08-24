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
 *   /cenarios — Gherkin + mapeamento por IA (precisa AGENTE_API_KEY)
 *   /descrever — descreve uma captura (precisa AGENTE_API_KEY)
 *
 * Variáveis:
 *   PONTE_TOKEN         obrigatório quando HOST não é loopback (para scans)
 *   AGENTE_API_KEY      habilita Gerar cenários (NVIDIA nvapi-...)
 *   AGENTE_BASE_URL     endpoint (padrão https://integrate.api.nvidia.com/v1)
 *   AGENTE_MODELO       modelo (padrão meta/llama-3.2-11b-vision-instruct)
 *   PONTE_DOMINIOS      allowlist de domínios (o controle mais forte)
 *   PONTE_PRIVADO=1     libera IP privado (só para uso local)
 *   PONTE_MAX           scans simultâneos, padrão 2
 *   PONTE_ORIGENS       origens de CORS, padrão *
 *   CHROME_PATH         caminho explícito do Chrome (opcional)
 */
const { carregarEnvs, resolverChaveAgente, varsAgenteVisiveis } = require('./carregar-env.js');
const envs = carregarEnvs();
const chaveAgenteOrigem = resolverChaveAgente();

const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { scanAxe, scanPa11y, scanLighthouse, statusMotores, caminhoChrome } = require('./a11y.js');
const { gerarCenarios, descreverTela, MODELO, BASE_URL } = require('./agente-cenarios.js');
const { zipExtensao } = require('./extensao.js');
const bancoCofre = require('./cofre/banco.js');
const apiCofre = require('./cofre/api.js');
const contasCofre = require('./cofre/contas.js');

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
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

/* Cabecalhos de seguranca da pagina.
 *
 * Referrer-Policy e same-origin de proposito, nao no-referrer: sem token o
 * portao da ponte cai no Referer (mesmaOrigem), e GET de mesma origem no
 * Chrome nao manda Origin. no-referrer aqui derrubaria os botoes de scan.
 *
 * A CSP fica nos tres diretivos que nao dependem de como a pagina foi
 * escrita. script-src exigiria tirar todo o inline destas 4470 linhas, e
 * uma CSP que precisa de 'unsafe-inline' para o script nao protege de nada.
 *
 * HSTS so quando a requisicao veio por https: o navegador ignora o
 * cabecalho em http, e em 127.0.0.1 mandar isso nao tem sentido nenhum. */
function cabecalhoSeguro(req) {
  const cab = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https') cab['Strict-Transport-Security'] = 'max-age=31536000';
  return cab;
}

function responder(res, status, corpo, origem) {
  res.writeHead(status, cabecalho(origem));
  res.end(JSON.stringify(corpo));
}

function faixaPrivada(ip) {
  const s = String(ip).toLowerCase();
  // ::ffff:127.0.0.1 e IPv4 escrito como IPv6: sem desembrulhar, passava direto.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  const alvo = mapeado ? mapeado[1] : s;

  if (net.isIPv4(alvo)) {
    const [a, b] = alvo.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127)   // CGNAT: rede do provedor, nao e publica
      || a >= 224;
  }
  return alvo === '::1' || alvo === '::'
    || alvo.startsWith('fc') || alvo.startsWith('fd') || alvo.startsWith('fe80');
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
  const ext = path.extname(arquivo);
  const cab = Object.assign(
    { 'Content-Type': TIPOS[ext] || 'application/octet-stream' },
    cabecalhoSeguro(req)
  );
  if (ext === '.html') cab['Cache-Control'] = 'no-store';
  res.writeHead(200, cab);
  // HEAD leva so os cabecalhos. Validador de URL costuma checar por HEAD, e
  // devolver 404 nele faz a pagina parecer inexistente para quem nunca a baixou.
  if (req.method === 'HEAD') return res.end(), true;
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

/* Comparacao de tamanho fixo: com !== o tempo de resposta conta quantos bytes
 * bateram, e isso e por onde um token curto vaza. */
function mesmoSegredo(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    // Compara contra ele mesmo so para gastar o mesmo tempo do caso valido.
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

function tokenInvalido(req, u) {
  if (!TOKEN) {
    if (ehLoopback) return false;
    return !mesmaOrigem(req);
  }
  const enviado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || u.searchParams.get('token') || '';
  return !mesmoSegredo(enviado, TOKEN);
}

function msgToken(req) {
  if (!TOKEN && !ehLoopback && !mesmaOrigem(req)) {
    return 'Acesso negado. Abra o Print nesta mesma URL ou configure PONTE_TOKEN.';
  }
  return 'token inválido ou ausente';
}

/* Cofre de evidencias no servidor.
 *
 * Desligado por padrao, e desligado NAO e erro: sem COFRE_BANCO o Print
 * local continua funcionando exatamente como antes, e so as rotas /api
 * respondem 503 explicando o que falta. Um recurso novo nao pode ser capaz
 * de derrubar o que ja estava no ar.
 *
 * Na Railway o caminho TEM que cair num volume. Em disco efemero, o deploy
 * seguinte apaga a evidencia do cliente sem avisar ninguem. */
const cofreLigado = !!bancoCofre.abrir();

/* Retencao roda no processo, nao em cron externo: o prazo tem que valer
 * mesmo que ninguem lembre de agendar nada. */
const VARRER_MS = Number(process.env.COFRE_VARRER_MS) || 60 * 60 * 1000;
if (cofreLigado) {
  const varrer = () => {
    try {
      const r = bancoCofre.varrerVencidas();
      if (r.evidencias || r.orfaos) {
        console.log(`retencao: ${r.evidencias} evidencia(s) vencida(s), ${r.orfaos} orfao(s)`);
      }
    } catch (err) {
      console.log('retencao FALHOU: ' + err.message);
    }
  };
  varrer();
  setInterval(varrer, VARRER_MS).unref();
}

/* Portao do Print.
 *
 * A regra e uma so, e nao tem chave nova para esquecer ligada: se o cofre
 * esta ligado, entrar no Print exige sessao. Cofre desligado nao tem a quem
 * perguntar quem voce e, entao nao ha portao, e o Print funciona como sempre
 * funcionou. Isso e o que permite ligar o cofre sem trancar ninguem para fora
 * por engano.
 *
 * O portao mora no SERVIDOR de proposito. Checar sessao no JavaScript da
 * pagina seria um aviso, nao um portao: quem quisesse entrar so precisaria
 * abrir o console. Aqui o HTML nem chega em quem nao esta autenticado.
 *
 * COFRE_PRINT_ABERTO=1 e a saida de emergencia: se o login quebrar, os
 * projetos gravados vivem no IndexedDB desta origem e a unica porta para eles
 * e esta pagina. Ficar trancado do lado de fora do proprio dado precisa ter
 * conserto sem deploy. */
const PRINT_ABERTO = process.env.COFRE_PRINT_ABERTO === '1';
const PAGINAS_PROTEGIDAS = new Set(['/', '/index.html']);

function precisaEntrar(req, u) {
  if (!cofreLigado || PRINT_ABERTO) return false;
  if (!PAGINAS_PROTEGIDAS.has(u.pathname)) return false;
  try {
    return !contasCofre.sessaoDe(req);
  } catch (err) {
    // Sem conseguir decidir, nao tranca: indisponibilidade e pior que aberto
    // numa pagina que, por si so, nao guarda dado de cliente nenhum.
    console.log('portao FALHOU: ' + err.message);
    return false;
  }
}

let rodando = 0;

const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || '';
  const u = new URL(req.url, `http://${HOST}:${PORTA}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cabecalho(origem));
    return res.end();
  }

  /* O cofre vem antes das rotas antigas: ele tem o proprio portao (sessao),
   * e passar por tokenInvalido faria a pagina de login exigir estar logado. */
  if (u.pathname.startsWith('/api/')) {
    return void (await apiCofre.tratar(req, res, u, lerCorpo));
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
      cenarios: !!process.env.AGENTE_API_KEY,
    cofre: cofreLigado || bancoCofre.porque(),
    portao: cofreLigado && !PRINT_ABERTO,
    semVolume: cofreLigado && bancoCofre.efemero(),
    bancoEm: cofreLigado ? bancoCofre.onde() : undefined,
      chrome: !!caminhoChrome(),
      modelo: MODELO,
      base: BASE_URL,
      agenteVar: chaveAgenteOrigem || undefined,
      agenteVars: varsAgenteVisiveis(),
      aviso: !process.env.AGENTE_API_KEY && !ehLoopback
        ? ('IA desligada: faltou AGENTE_API_KEY. Vars neste serviço: '
          + (varsAgenteVisiveis().join(', ') || '(nenhuma)')
          + '. Adicione AGENTE_API_KEY (nvapi-...) no card do serviço, Runtime, e Redeploy.')
        : EXPOSTO_SEM_TOKEN
          ? 'Sem PONTE_TOKEN: scans funcionam abrindo o Print nesta URL. Defina PONTE_TOKEN para exigir token.'
          : undefined
    }, origem);
  }

  /* A extensão em .zip: página web não instala extensão (o Chrome tirou isso em
   * 2018), então o Print oferece o download e mostra os três passos. Sem token:
   * é o mesmo código-fonte que já está no repositório público. */
  if (u.pathname === '/extensao.zip') {
    try {
      const zip = zipExtensao();
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="audi-print-extensao.zip"',
        'Content-Length': zip.length,
        'Access-Control-Allow-Origin': ORIGENS === '*' ? '*' : origem
      });
      return res.end(zip);
    } catch (err) {
      console.log('extensao.zip FALHOU: ' + err.message);
      return responder(res, 500, { erro: 'não consegui montar o pacote: ' + err.message }, origem);
    }
  }

  if (u.pathname === '/descrever') {
    if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' }, origem);
    if (tokenInvalido(req, u)) return responder(res, 401, { erro: msgToken(req) }, origem);
    if (rodando >= MAX) {
      return responder(res, 429, { erro: `${MAX} trabalhos já em andamento, tente em instantes` }, origem);
    }
    rodando++;
    try {
      const corpo = await lerCorpo(req);
      const dados = await descreverTela(corpo);
      return responder(res, 200, dados, origem);
    } catch (err) {
      console.log('descrever FALHOU: ' + err.message);
      return responder(res, err.semChave ? 503 : err.pedidoInvalido ? 400 : 500, { erro: err.message }, origem);
    } finally {
      rodando--;
    }
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
      return responder(res, err.semChave ? 503 : err.recusa ? 422 : err.pedidoInvalido ? 400 : 500, { erro: err.message }, origem);
    } finally {
      rodando--;
    }
  }

  if (u.pathname !== '/scan') {
    if (precisaEntrar(req, u)) {
      const volta = '/cofre.html?ir=' + encodeURIComponent(u.pathname + u.search);
      res.writeHead(302, { Location: volta, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && servirArquivo(req, res, u.pathname)) return;
    return responder(res, 404, { erro: 'rota desconhecida' }, origem);
  }

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
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
servidor.headersTimeout = 240000;
servidor.timeout = 300000;

servidor.listen(PORTA, HOST, () => {
  const st = statusMotores();
  console.log(`ponte ouvindo em http://${HOST}:${PORTA}`);
  if (envs.length) console.log('env: ' + envs.join(', '));
  console.log(`cofre: ${cofreLigado ? 'ligado (' + (process.env.COFRE_BANCO || '') + ')' : 'desligado — ' + bancoCofre.porque()}`
    + ` · portao do Print: ${cofreLigado && !PRINT_ABERTO ? 'exige login' : 'aberto'}`);
  if (cofreLigado && bancoCofre.efemero()) {
    console.warn('ATENCAO: o cofre esta em disco efemero. Monte um volume em /dados,');
    console.warn('senao o proximo deploy apaga a evidencia guardada.');
  }
  console.log(`token: ${TOKEN ? 'exigido' : 'não'} · máx ${MAX} simultâneos`
    + ` · allowlist: ${DOMINIOS.length ? DOMINIOS.join(', ') : 'nenhuma'}`
    + ` · rede privada: ${PRIVADO_OK ? 'liberada' : 'bloqueada'}`);
  console.log(`motores: axe=${st.axe.ok ? 'ok' : 'FALHA'} · pa11y=${st.pa11y.ok ? 'ok' : 'FALHA'} · lighthouse=${st.nota.ok ? 'ok' : 'FALHA'}`);
  console.log(`cenários IA: ${process.env.AGENTE_API_KEY ? 'ligado (' + MODELO + ' @ ' + BASE_URL + ')' : 'desligado — defina AGENTE_API_KEY'}`
    + (chaveAgenteOrigem ? ` · var ${chaveAgenteOrigem}` : '')
    + (varsAgenteVisiveis().length ? ` · env [${varsAgenteVisiveis().join(', ')}]` : ' · nenhuma var AGENTE/NVIDIA no processo'));
  if (st.chrome) console.log(`chrome: ${st.chrome}`);
  if (ehLoopback) console.log('deixe aberto e use os botões de scan no Audi Print.\n');
});
