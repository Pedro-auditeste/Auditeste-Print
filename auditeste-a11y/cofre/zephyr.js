/* Publicação de evidência no Zephyr Squad Cloud (a antiga ZAPI).
 *
 * POR QUE ISTO MORA NO SERVIDOR, e não no Print.
 *
 * O Squad na nuvem não usa token fixo: cada requisição leva um JWT assinado
 * com a CHAVE SECRETA da conta, e esse JWT amarra o método, o caminho e a
 * query daquela chamada (o "qsh"). Assinar no navegador significaria colocar
 * a chave secreta dentro de uma página, onde qualquer pessoa com o console
 * aberto a copia. Então a página manda a evidência para cá, e quem fala com
 * o Zephyr é este processo.
 *
 * CONFIGURAÇÃO (variáveis de ambiente, nunca no git):
 *   ZEPHYR_ACCESS_KEY    chave de acesso, da aba de API keys do Zephyr
 *   ZEPHYR_SECRET_KEY    chave secreta, do mesmo lugar
 *   ZEPHYR_ACCOUNT_ID    accountId da conta Atlassian que vai assinar
 *   ZEPHYR_PROJETO_ID    id numérico do projeto no Jira
 *   ZEPHYR_VERSAO_ID     opcional, padrão -1 ("Unscheduled")
 *   ZEPHYR_CICLO_ID      opcional, ciclo de destino; sem ele usa o ad hoc
 *   ZEPHYR_BASE          opcional, para apontar a um ambiente de teste
 *   ZEPHYR_STATUS_*      opcional, se a equipe renomeou os status
 *   ZEPHYR_JIRA_URL / ZEPHYR_JIRA_EMAIL / ZEPHYR_JIRA_TOKEN
 *       opcionais, e só servem para traduzir "ABC-123" no id numérico que a
 *       ZAPI exige. Sem eles, quem publica informa o id numérico direto.
 */
const crypto = require('crypto');

const BASE = (process.env.ZEPHYR_BASE || 'https://prod-api.zephyr4jiracloud.com/connect').replace(/\/+$/, '');
const ACCESS_KEY = (process.env.ZEPHYR_ACCESS_KEY || '').trim();
const SECRET_KEY = (process.env.ZEPHYR_SECRET_KEY || '').trim();
const ACCOUNT_ID = (process.env.ZEPHYR_ACCOUNT_ID || '').trim();
const PROJETO_ID = (process.env.ZEPHYR_PROJETO_ID || '').trim();
const VERSAO_ID = (process.env.ZEPHYR_VERSAO_ID || '-1').trim();
const CICLO_ID = (process.env.ZEPHYR_CICLO_ID || '-1').trim();

/* Ids padrão do Squad. Equipe que criou status próprio troca pelo ambiente,
 * em vez de alguém descobrir em produção que "Aprovado" virou "Reprovado". */
const STATUS = {
  passou: Number(process.env.ZEPHYR_STATUS_PASSOU || 1),
  reprovou: Number(process.env.ZEPHYR_STATUS_REPROVOU || 2),
  andamento: Number(process.env.ZEPHYR_STATUS_ANDAMENTO || 3),
  bloqueado: Number(process.env.ZEPHYR_STATUS_BLOQUEADO || 4)
};

const TEMPO_MS = Number(process.env.ZEPHYR_TIMEOUT_MS || 20000);

const configurado = () => !!(ACCESS_KEY && SECRET_KEY && ACCOUNT_ID && PROJETO_ID);

function erro(msg, status) {
  const e = new Error(msg);
  e.status = status || 502;
  return e;
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* A query entra no qsh ORDENADA por nome. Fora de ordem o Zephyr recusa com
 * um erro que não diz "ordem": diz só que a assinatura não confere. */
function queryCanonica(params) {
  return Object.keys(params || {}).filter(k => params[k] !== undefined && params[k] !== null)
    .sort()
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
    .join('&');
}

/** JWT HS256 com o qsh do pedido, no formato que a ZAPI Cloud espera. */
function gerarJwt(metodo, caminho, params, agoraMs) {
  const agora = Math.floor((agoraMs || Date.now()) / 1000);
  const canonico = [metodo.toUpperCase(), caminho, queryCanonica(params)].join('&');
  const carga = {
    sub: ACCOUNT_ID,
    qsh: crypto.createHash('sha256').update(canonico).digest('hex'),
    iss: ACCESS_KEY,
    iat: agora,
    exp: agora + 3600
  };
  const cabecalho = { alg: 'HS256', typ: 'JWT' };
  const base = b64url(JSON.stringify(cabecalho)) + '.' + b64url(JSON.stringify(carga));
  return base + '.' + b64url(crypto.createHmac('sha256', SECRET_KEY).update(base).digest());
}

async function chamar(metodo, caminho, { params, json, corpo, tipo } = {}) {
  if (!configurado()) throw erro('Zephyr não configurado neste servidor.', 503);
  const query = queryCanonica(params);
  const url = BASE + caminho + (query ? '?' + query : '');
  const cabecalhos = {
    Authorization: 'JWT ' + gerarJwt(metodo, caminho, params),
    zapiAccessKey: ACCESS_KEY
  };
  if (json !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (tipo) cabecalhos['Content-Type'] = tipo;

  let r;
  try {
    r = await fetch(url, {
      method: metodo,
      headers: cabecalhos,
      body: json !== undefined ? JSON.stringify(json) : corpo,
      signal: AbortSignal.timeout(TEMPO_MS)
    });
  } catch (err) {
    throw erro('Não alcancei o Zephyr: ' + (err && err.message), 504);
  }

  const texto = await r.text().catch(() => '');
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch (_) { /* nem tudo volta JSON */ }
  if (!r.ok) {
    /* A mensagem do Zephyr vai inteira: é ela que diz se foi assinatura,
     * permissão ou id errado. O que NUNCA pode sair daqui é a chave. */
    const detalhe = (dados && (dados.errorDesc || dados.message)) || texto.slice(0, 300) || '';
    throw erro('Zephyr recusou (' + r.status + ')' + (detalhe ? ': ' + detalhe : ''), 502);
  }
  return dados;
}

/** Leitura inofensiva, só para conferir credencial sem publicar nada. */
async function conferir() {
  const r = await chamar('GET', '/public/rest/api/1.0/cycles/search',
    { params: { projectId: PROJETO_ID, versionId: VERSAO_ID } });
  /* Devolve os ciclos com id e nome: e exatamente o que falta para preencher
   * ZEPHYR_CICLO_ID, e garimpar isso na interface do Jira e sofrido. */
  const ciclos = Object.entries(r && typeof r === 'object' ? r : {})
    .filter(([, v]) => v && typeof v === 'object' && v.name)
    .map(([id, v]) => ({ id, nome: v.name }));
  return { ok: true, projetoId: PROJETO_ID, versaoId: VERSAO_ID, ciclos };
}

/* "ABC-123" não serve para a ZAPI, que quer o id numérico. Traduzir exige o
 * Jira, não o Zephyr, então é opcional: sem credencial do Jira, quem publica
 * informa o id numérico e nada disto roda. */
async function idDoCaso(chave) {
  if (/^\d+$/.test(String(chave).trim())) return String(chave).trim();
  const url = (process.env.ZEPHYR_JIRA_URL || '').replace(/\/+$/, '');
  const email = process.env.ZEPHYR_JIRA_EMAIL || '';
  const token = process.env.ZEPHYR_JIRA_TOKEN || '';
  if (!url || !email || !token) {
    throw erro('Informe o id numérico do caso: a tradução de "' + chave
      + '" precisa das credenciais do Jira (ZEPHYR_JIRA_URL, ZEPHYR_JIRA_EMAIL, ZEPHYR_JIRA_TOKEN).', 400);
  }
  let r;
  try {
    r = await fetch(url + '/rest/api/3/issue/' + encodeURIComponent(chave) + '?fields=id', {
      headers: {
        Authorization: 'Basic ' + Buffer.from(email + ':' + token).toString('base64'),
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(TEMPO_MS)
    });
  } catch (err) {
    throw erro('Não alcancei o Jira: ' + (err && err.message), 504);
  }
  if (r.status === 404) throw erro('O caso ' + chave + ' não existe no Jira.', 400);
  if (!r.ok) throw erro('O Jira recusou a consulta do caso ' + chave + ' (' + r.status + ').', 502);
  const d = await r.json().catch(() => null);
  if (!d || !d.id) throw erro('O Jira respondeu sem o id do caso ' + chave + '.', 502);
  return String(d.id);
}

function statusDe(resultado) {
  const t = String(resultado || '').toLowerCase();
  if (/reprov|falh|erro|fail/.test(t)) return STATUS.reprovou;
  if (/bloque|impedi|block/.test(t)) return STATUS.bloqueado;
  if (/aprov|passou|sucesso|ok|pass/.test(t)) return STATUS.passou;
  return STATUS.andamento;
}

/* Multipart montado na mão: é um corpo de 3 partes, e trazer uma dependência
 * para isso custaria mais manutenção do que as 12 linhas abaixo. */
function multipart(nome, tipo, bytes) {
  const limite = '----audiprint' + crypto.randomBytes(12).toString('hex');
  const cabeca = Buffer.from(
    '--' + limite + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + nome.replace(/["\r\n]/g, '') + '"\r\n'
    + 'Content-Type: ' + tipo + '\r\n\r\n');
  const pe = Buffer.from('\r\n--' + limite + '--\r\n');
  return { tipo: 'multipart/form-data; boundary=' + limite, corpo: Buffer.concat([cabeca, bytes, pe]) };
}

/* Publica UMA evidência contra um caso de teste que já existe no Jira.
 *
 * Criar o caso do zero é outra história (no Squad um caso é uma issue do
 * Jira, com os passos por outra rota), e fazer as duas coisas de uma vez
 * daria um botão que falha pela metade. Aqui a execução é o que interessa:
 * o caso já existe, o que faltava era o resultado e a prova. */
async function publicar({ caso, resultado, comentario, anexoNome, anexoTipo, anexoBytes, cicloId }) {
  if (!String(caso || '').trim()) throw erro('Informe o caso de teste do Zephyr.', 400);
  const issueId = await idDoCaso(caso);
  const ciclo = String(cicloId || CICLO_ID);

  /* 1. o caso entra no ciclo. Se ja estiver la, o Zephyr nao duplica. */
  await chamar('POST', '/public/rest/api/1.0/executions/add/cycle/' + encodeURIComponent(ciclo),
    { json: { issues: [issueId], method: '1', projectId: PROJETO_ID, versionId: VERSAO_ID } });

  /* 2. descobre a execucao recem criada para este caso. */
  const busca = await chamar('GET', '/public/rest/api/1.0/executions/search/cycle/' + encodeURIComponent(ciclo),
    { params: { projectId: PROJETO_ID, versionId: VERSAO_ID, action: 'expand' } });
  const lista = (busca && (busca.searchObjectList || busca.executions)) || [];
  const achada = lista.find(e => String(
    (e.execution && (e.execution.issueId || e.execution.issueKey)) || e.issueId || '') === String(issueId));
  const execucaoId = achada && ((achada.execution && achada.execution.id) || achada.id);
  if (!execucaoId) throw erro('O caso entrou no ciclo, mas não achei a execução dele para gravar o resultado.', 502);

  /* 3. grava o resultado. */
  await chamar('PUT', '/public/rest/api/1.0/executions/' + encodeURIComponent(execucaoId), {
    json: {
      status: { id: statusDe(resultado) },
      cycleId: ciclo, projectId: PROJETO_ID, versionId: VERSAO_ID, issueId,
      comment: String(comentario || '').slice(0, 5000)
    }
  });

  /* 4. anexa a evidencia. O anexo e o ponto do produto: sem ele o Zephyr fica
   *    com "reprovado" e ninguem consegue ver o que aconteceu na tela. */
  let anexado = false;
  if (anexoBytes && anexoBytes.length) {
    const m = multipart(anexoNome || 'evidencia.html', anexoTipo || 'text/html', anexoBytes);
    await chamar('POST', '/public/rest/api/1.0/attachment', {
      params: { entityId: execucaoId, entityName: 'execution' },
      corpo: m.corpo, tipo: m.tipo
    });
    anexado = true;
  }

  return { ok: true, execucaoId: String(execucaoId), issueId, cicloId: ciclo,
    status: statusDe(resultado), anexado };
}

module.exports = {
  configurado, conferir, publicar, statusDe,
  // expostos para o teste conseguir conferir a assinatura sem rede:
  gerarJwt, queryCanonica, multipart, STATUS, BASE
};
