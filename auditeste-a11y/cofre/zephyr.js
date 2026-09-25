/* Publicação de evidência no Zephyr Essential Cloud (API v2).
 *
 * HISTÓRICO, porque isto já foi escrito diferente uma vez.
 *
 * A primeira versão falava com a ZAPI do Zephyr Squad Cloud: assinatura por
 * chamada, chave de acesso mais chave secreta. A SmartBear renomeou o Squad
 * para Zephyr Essential e trocou a API junto. A nova é mais simples: um
 * token só, num cabeçalho, e endpoints de verdade em vez de ids numéricos.
 * Fonte: a especificação pública "Zephyr Essential Cloud API 2.8".
 *
 * POR QUE ISTO MORA NO SERVIDOR, e não no Print.
 *
 * O token dá acesso à API com as permissões de quem o gerou. Numa página, ele
 * estaria visível para qualquer pessoa com o console aberto. Então a página
 * manda a evidência para cá, e quem fala com o Zephyr é este processo.
 *
 * O QUE ESTA API NÃO FAZ: anexar arquivo. A especificação 2.8 não tem nenhum
 * endpoint de anexo, upload ou arquivo. A execução sai com resultado e
 * comentário; a evidência em si continua no Print, na pasta de destino e no
 * cofre. Se um dia aparecer endpoint de anexo, o lugar de mexer é aqui.
 *
 * CONFIGURAÇÃO (variáveis de ambiente, nunca no git):
 *   ZEPHYR_API_TOKEN   token gerado em Configurações pessoais > Apps >
 *                      Zephyr Essential API Access Tokens
 *   ZEPHYR_PROJETO     chave do projeto no Jira (ex.: GOV)
 *   ZEPHYR_CICLO       opcional, chave do ciclo de destino (ex.: GOV-R1)
 *   ZEPHYR_BASE        opcional, para apontar a outro ambiente
 *   ZEPHYR_STATUS_*    opcional, se a equipe renomeou os status
 */
/* O endereço que a especificação publica (zephyrforjiracloud) NÃO existe:
 * não resolve. Quem atende o /v2 é o host antigo, com "4", conferido na mão:
 * /v2/testcycles devolve 401 pedindo token, e sem o /v2 devolve 404. */
const BASE = (process.env.ZEPHYR_BASE || 'https://prod-api.zephyr4jiracloud.com/v2').replace(/\/+$/, '');
const TOKEN = (process.env.ZEPHYR_API_TOKEN || '').trim();
const PROJETO = (process.env.ZEPHYR_PROJETO || '').trim().toUpperCase();
const CICLO = (process.env.ZEPHYR_CICLO || '').trim();

/* Nomes de status, não ids: a API v2 recebe o nome. Equipe que renomeou
 * troca pelo ambiente, em vez de descobrir em produção que "Pass" não existe. */
const STATUS = {
  passou: process.env.ZEPHYR_STATUS_PASSOU || 'Pass',
  reprovou: process.env.ZEPHYR_STATUS_REPROVOU || 'Fail',
  andamento: process.env.ZEPHYR_STATUS_ANDAMENTO || 'In Progress',
  bloqueado: process.env.ZEPHYR_STATUS_BLOQUEADO || 'Blocked'
};

const TEMPO_MS = Number(process.env.ZEPHYR_TIMEOUT_MS || 20000);

/* Chave de caso de teste do Zephyr: PROJ-T12. Não confundir com a chave de
 * uma issue do Jira (PROJ-12): são coisas diferentes, e trocar uma pela
 * outra dá um 404 que não explica nada. */
const CHAVE_CASO = /^[A-Z][A-Z0-9_]*-T\d+$/;

const configurado = () => !!(TOKEN && PROJETO);

/* externo: a falha é do Zephyr ou da rede até ele, não do nosso servidor.
 * Sem esta marca a mensagem virava "falha interna, informe o código", que
 * esconde justamente o que explica o problema (host errado, token inválido,
 * projeto inexistente). Esconder isso custou uma hora de investigação. */
function erro(msg, status) {
  const e = new Error(msg);
  e.status = status || 502;
  e.externo = true;
  return e;
}

function query(params) {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&') : '';
}

async function chamar(metodo, caminho, { params, json } = {}) {
  if (!configurado()) throw erro('Zephyr não configurado neste servidor.', 503);
  const url = BASE + caminho + query(params);
  const corpo = json !== undefined ? JSON.stringify(json) : undefined;

  const enviar = async (auth) => {
    try {
      return await fetch(url, {
        method: metodo,
        headers: Object.assign({ Accept: 'application/json' }, auth,
          json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        body: corpo,
        signal: AbortSignal.timeout(TEMPO_MS)
      });
    } catch (err) {
      throw erro('Não alcancei o Zephyr: ' + (err && err.message), 504);
    }
  };

  /* A especificação 2.8 autentica com "Authorization: Bearer". O cabeçalho
   * "AccessToken" solto é do ZAPI antigo, e foi com ele que esta integração
   * nasceu: o Zephyr respondia 401 sem dizer que o problema era o cabeçalho,
   * e 401 sozinho não distingue token inválido de esquema errado. Por isso a
   * segunda tentativa troca o esquema antes de acusar o token. */
  let r = await enviar({ Authorization: 'Bearer ' + TOKEN });
  if (r.status === 401) r = await enviar({ AccessToken: TOKEN });

  const texto = await r.text().catch(() => '');
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch (_) { /* nem tudo volta JSON */ }
  if (!r.ok) {
    /* A mensagem do Zephyr vai inteira: é ela que diz se foi token, permissão
     * ou chave errada. O que NUNCA pode sair daqui é o token. */
    const detalhe = (dados && (dados.message || dados.errorMessages || dados.error)) || texto.slice(0, 300) || '';
    throw erro('Zephyr recusou (' + r.status + ')'
      + (detalhe ? ': ' + (typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)) : ''), 502);
  }
  return dados;
}

const lista = (r) => (r && Array.isArray(r.values) ? r.values : []);

/* Leitura inofensiva, para conferir o token sem publicar nada. Devolve os
 * ciclos e os status que ESTE projeto aceita: são os dois valores que a
 * pessoa precisa para configurar, e garimpar isso na tela é sofrido. */
async function conferir() {
  const ciclos = await chamar('GET', '/testcycles', { params: { projectKey: PROJETO, maxResults: 20 } });
  let status = [];
  try {
    const s = await chamar('GET', '/statuses', {
      params: { projectKey: PROJETO, statusType: 'TEST_EXECUTION', maxResults: 50 }
    });
    status = lista(s).map(x => x.name).filter(Boolean);
  } catch (_) { /* status é extra: token válido já foi provado pelos ciclos */ }

  return {
    ok: true,
    projeto: PROJETO,
    ciclos: lista(ciclos).map(c => ({ chave: c.key, nome: c.name })),
    statusDisponiveis: status,
    statusEmUso: STATUS
  };
}

/* Os casos que EXISTEM no projeto, para a pessoa escolher em vez de digitar
 * uma chave que ela não tem como saber. Quem tenta de cabeça manda o nome do
 * caso ("TESTE2") e leva um erro de formato que não ajuda em nada. */
async function casos() {
  const r = await chamar('GET', '/testcases', { params: { projectKey: PROJETO, maxResults: 200 } });
  return lista(r)
    .map(c => ({ chave: String(c.key || ''), nome: String(c.name || '') }))
    .filter(c => c.chave);
}

function statusDe(resultado) {
  const t = String(resultado || '').toLowerCase();
  if (/reprov|falh|erro|fail/.test(t)) return STATUS.reprovou;
  if (/bloque|impedi|block/.test(t)) return STATUS.bloqueado;
  if (/aprov|passou|sucesso|ok|pass/.test(t)) return STATUS.passou;
  return STATUS.andamento;
}

/* Cria a execução de um caso que já existe no Zephyr.
 *
 * Criar o caso do zero é outra história (passos, pasta, prioridade), e um
 * botão que faz as duas coisas falha pela metade. Aqui o caso já existe: o
 * que faltava era o resultado do teste chegar lá com a mão do QA. */
async function publicar({ caso, resultado, comentario, ciclo }) {
  const chave = String(caso || '').trim().toUpperCase();
  if (!chave) throw erro('Informe o caso de teste do Zephyr.', 400);
  if (!CHAVE_CASO.test(chave)) {
    throw erro('"' + chave + '" não é uma chave de caso de teste do Zephyr. '
      + 'O formato é PROJETO-T + número, por exemplo ' + PROJETO + '-T1. '
      + 'A chave de uma issue do Jira (' + PROJETO + '-1) é outra coisa.', 400);
  }

  const corpo = {
    projectKey: PROJETO,
    testCaseKey: chave,
    statusName: statusDe(resultado)
  };
  const alvo = String(ciclo || CICLO || '').trim();
  if (alvo) corpo.testCycleKey = alvo;
  if (comentario) corpo.comment = String(comentario).slice(0, 5000);

  const r = await chamar('POST', '/testexecutions', { json: corpo });
  return {
    ok: true,
    execucao: (r && (r.key || r.id)) ? String(r.key || r.id) : '',
    caso: chave,
    ciclo: alvo || null,
    status: corpo.statusName,
    /* Dito na resposta, não escondido: a API 2.8 não tem endpoint de anexo,
     * então a evidência não sobe junto. Quem chama decide o que mostrar. */
    anexado: false
  };
}

module.exports = {
  configurado, conferir, casos, publicar, statusDe,
  // expostos para o teste:
  query, CHAVE_CASO, STATUS, BASE, PROJETO
};
