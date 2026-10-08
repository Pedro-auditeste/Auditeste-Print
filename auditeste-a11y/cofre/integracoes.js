/* Jira e Zephyr por equipe.
 *
 * O servidor atende várias equipes ao mesmo tempo, e cada cliente tem o Jira
 * e o Zephyr dele. Aqui se decide, a cada pedido, COM QUE CREDENCIAL a
 * sessão fala: a da própria equipe, guardada cifrada no cofre.
 *
 * AS VARIÁVEIS DE AMBIENTE (JIRA_*, ZEPHYR_*) não configuram mais equipe
 * nenhuma. Toda conta nasce sem Jira e sem Zephyr até o administrador da
 * equipe configurar na tela. Antes elas valiam de padrão para a sessão cujo
 * e-mail fosse o JIRA_EMAIL, e num servidor compartilhado com cadastro aberto
 * o primeiro a registrar esse e-mail herdava a credencial do servidor, que é
 * justo o que a configuração por equipe veio tirar.
 *
 * O TOKEN NUNCA VOLTA para a tela. Quem configura vê se existe token, não o
 * valor; para trocar, digita outro.
 */
const banco = require('./banco.js');
const zephyr = require('./zephyr.js');
const jira = require('./jira.js');

const CHAVE_PROJETO = /^[A-Z][A-Z0-9_]{1,19}$/;
const CHAVE_CICLO = /^[A-Z][A-Z0-9_]*-R\d+$/;
const STATUS_NOMES = ['passou', 'reprovou', 'andamento', 'bloqueado'];

function recusar(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/* Token é o que a pessoa colou: sem espaço, sem quebra de linha, tamanho de
 * token de verdade. Vazio quer dizer "mantenha o que já está guardado". */
function token(novo, guardado, nome) {
  const t = String(novo == null ? '' : novo).trim();
  if (!t) {
    if (guardado) return guardado;
    throw recusar('Informe o token do ' + nome + '.');
  }
  if (t.length < 10 || t.length > 4000 || /\s/.test(t)) {
    throw recusar('O token do ' + nome + ' não parece um token: cole o valor inteiro, sem espaços.');
  }
  return t;
}

function projeto(v, nome) {
  const p = txt(v, 40).toUpperCase();
  if (!CHAVE_PROJETO.test(p)) {
    throw recusar('A chave do projeto do ' + nome + ' é a sigla que aparece antes do número das issues, por exemplo GOV.');
  }
  return p;
}

/* O que veio da tela vira o que será guardado. `atual` é o que a equipe já
 * tem, para o token vazio manter o anterior. Parte ausente (null) é removida. */
function limpar(corpo, atual) {
  const c = corpo || {};
  const a = atual || {};
  const novo = {};

  if (c.jira) {
    const base = jira.baseAceita(c.jira.base);
    if (!base) {
      throw recusar('O endereço do Jira precisa ser o do Jira Cloud da empresa, no formato https://empresa.atlassian.net');
    }
    const email = txt(c.jira.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw recusar('Informe o e-mail da conta do Jira dona do token.');
    /* Endereço ou conta trocados: o token antigo era de outro lugar. Mantê-lo
     * mandaria a credencial de um Jira para outro endereço. */
    const mesmoDono = a.jira && a.jira.base === base && a.jira.email === email;
    novo.jira = {
      base, email,
      token: token(c.jira.token, mesmoDono ? a.jira.token : '', 'Jira'),
      projeto: projeto(c.jira.projeto, 'Jira'),
      tipoBug: txt(c.jira.tipoBug, 60)
    };
  }

  if (c.zephyr) {
    const ciclo = txt(c.zephyr.ciclo, 60).toUpperCase();
    if (ciclo && !CHAVE_CICLO.test(ciclo)) {
      throw recusar('O ciclo padrão é a chave do ciclo no Zephyr, por exemplo GOV-R1. Deixe vazio para escolher a cada publicação.');
    }
    const status = {};
    for (const n of STATUS_NOMES) {
      const v = txt(c.zephyr.status && c.zephyr.status[n], 60);
      if (v) status[n] = v;
    }
    novo.zephyr = {
      token: token(c.zephyr.token, a.zephyr && a.zephyr.token, 'Zephyr'),
      projeto: projeto(c.zephyr.projeto || (novo.jira && novo.jira.projeto), 'Zephyr'),
      ciclo, status
    };
  }
  return novo;
}

/* O que a tela pode ver da configuração: tudo, menos os tokens. */
function semSegredo(cfg) {
  const c = cfg || {};
  return {
    jira: c.jira ? { base: c.jira.base || '', email: c.jira.email || '', projeto: c.jira.projeto || '',
      tipoBug: c.jira.tipoBug || '', temToken: !!c.jira.token } : null,
    zephyr: c.zephyr ? { projeto: c.zephyr.projeto || '', ciclo: c.zephyr.ciclo || '',
      status: c.zephyr.status || {}, temToken: !!c.zephyr.token } : null
  };
}

/* Com que configuração esta sessão fala, e de onde ela veio: 'equipe' (a da
 * própria equipe) ou null (nada configurado). As variáveis de ambiente não
 * entram aqui; montam só a instância do módulo (testes e linha de comando). */
function configDe(sessao) {
  const propria = banco.integracaoDoTenant(sessao.tenantId);
  if (propria && (propria.jira || propria.zephyr)) return { cfg: propria, origem: 'equipe' };
  return { cfg: {}, origem: null };
}

/** As duas integrações prontas para usar nesta sessão. */
function de(sessao) {
  const { cfg, origem } = configDe(sessao);
  const z = zephyr.criar(cfg.zephyr);
  return { zephyr: z, jira: jira.criar(cfg.jira, z), origem };
}

/** O que a tela de configuração mostra. */
function ver(sessao) {
  const { cfg, origem } = configDe(sessao);
  return Object.assign({ origem, cifra: banco.cifraLigada() }, semSegredo(cfg));
}

/* Salva a configuração da equipe da sessão. Devolve o que ficou, sem token. */
function salvar(sessao, corpo) {
  const atual = banco.integracaoDoTenant(sessao.tenantId);
  const novo = limpar(corpo, atual);
  /* Token de cliente não vai para o disco em texto. Sem COFRE_CHAVE o cofre
   * guarda print em claro, e isso é decisão de quem subiu o servidor; com
   * credencial de terceiro não dá para ter a mesma tolerância. */
  if ((novo.jira || novo.zephyr) && !banco.cifraLigada()) {
    const e = new Error('Este servidor está sem a chave de cifra (COFRE_CHAVE). Sem ela os tokens não são guardados.');
    e.status = 503;
    throw e;
  }
  if (!novo.jira && !novo.zephyr) banco.removerIntegracao(sessao.tenantId);
  else banco.salvarIntegracao(sessao.tenantId, sessao.usuarioId, novo);
  return novo;
}

/* Fala com o Jira e o Zephyr de verdade, sem criar nada, e diz o que cada um
 * respondeu. Um falhar não esconde o resultado do outro. */
async function conferir(sessao) {
  const i = de(sessao);
  const tentar = async (x) => {
    if (!x.configurado()) return { configurado: false };
    try { return Object.assign({ configurado: true }, await x.conferir()); }
    catch (e) { return { configurado: true, ok: false, erro: e.message }; }
  };
  const [j, z] = await Promise.all([tentar(i.jira), tentar(i.zephyr)]);
  return { origem: i.origem, jira: j, zephyr: z };
}

module.exports = { de, ver, salvar, conferir, limpar, semSegredo, configDe };
