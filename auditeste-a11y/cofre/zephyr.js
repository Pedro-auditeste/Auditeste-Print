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
 * CONFIGURAÇÃO: cada equipe informa a dela na tela do cofre (Jira e Zephyr),
 * e ela fica cifrada no banco; ver cofre/integracoes.js. As variáveis de
 * ambiente abaixo são a configuração do dono do servidor, e só valem para a
 * conta dele (nunca no git):
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
const BASE_PADRAO = 'https://prod-api.zephyr4jiracloud.com/v2';
const TEMPO_MS = Number(process.env.ZEPHYR_TIMEOUT_MS || 20000);

/* O que as variáveis de ambiente dizem: a configuração do dono do servidor.
 * Cada equipe pode ter a própria, guardada no cofre (cofre/integracoes.js). */
function doAmbiente() {
  return {
    token: process.env.ZEPHYR_API_TOKEN,
    projeto: process.env.ZEPHYR_PROJETO,
    ciclo: process.env.ZEPHYR_CICLO,
    status: {
      passou: process.env.ZEPHYR_STATUS_PASSOU,
      reprovou: process.env.ZEPHYR_STATUS_REPROVOU,
      andamento: process.env.ZEPHYR_STATUS_ANDAMENTO,
      bloqueado: process.env.ZEPHYR_STATUS_BLOQUEADO
    }
  };
}

/* Uma instância por configuração: o mesmo servidor atende várias equipes,
 * cada uma com o Zephyr dela. Nada aqui dentro lê token do ambiente, para a
 * credencial de uma equipe nunca servir a outra por descuido.
 *
 * O endereço da API NÃO vem da equipe: é o do Zephyr, ou o que o dono do
 * servidor pôs em ZEPHYR_BASE. Deixar a equipe escolher seria deixar ela
 * apontar o servidor, com token e tudo, para onde quisesse. */
function criar(cfg) {
  cfg = cfg || {};
  const BASE = String(process.env.ZEPHYR_BASE || BASE_PADRAO).replace(/\/+$/, '');
  const TOKEN = String(cfg.token || '').trim();
  const PROJETO = String(cfg.projeto || '').trim().toUpperCase();
  const CICLO = String(cfg.ciclo || '').trim();

  /* Nomes de status, não ids: a API v2 recebe o nome. Equipe que renomeou
   * informa os dela, em vez de descobrir em produção que "Pass" não existe. */
  const st = cfg.status || {};
  const STATUS = {
    passou: st.passou || 'Pass',
    reprovou: st.reprovou || 'Fail',
    andamento: st.andamento || 'In Progress',
    bloqueado: st.bloqueado || 'Blocked'
  };

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
    if (!configurado()) throw erro('Zephyr não configurado para esta equipe.', 503);
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
  async function ciclos() {
    const r = await chamar('GET', '/testcycles', { params: { projectKey: PROJETO, maxResults: 50 } });
    return lista(r)
      .map(c => ({ chave: String(c.key || ''), nome: String(c.name || '') }))
      .filter(c => c.chave);
  }

  async function conferir() {
    const todos = await ciclos();
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
      ciclos: todos,
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
  /* Os passos gravados vão para o "Actual Result" da execução, com o mesmo
   * detalhe que o Print mostra: ação, rótulo, elemento (xpath e id), HTML do
   * elemento, horários e URLs de antes e depois.
   *
   * Como casar a gravação com o caso: o script do caso é o roteiro do QA, e a
   * gravação é o que aconteceu. Se os dois têm o mesmo número de passos, cada
   * passo gravado vai para o passo correspondente. Se não têm (o comum: o caso
   * tem um passo e a gravação, vinte), a gravação inteira vai para o primeiro.
   * O roteiro do caso nunca é tocado.
   *
   * Se não der para ler os passos do caso, ou o Zephyr recusar o formato, os
   * passos vão para o comentário da execução: a evidência não pode se perder
   * por causa do lugar onde ela mora. Os prints não vão: a API não tem anexo. */
  // ponytail: limite chutado, a SmartBear não publica o máximo do campo; se o Zephyr recusar, baixar aqui
  const LIMITE_TEXTO = 20000;
  const LIMITE_HTML_ELEMENTO = 700;
  const escHtml = t => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function detalheDoPasso(p) {
    p = p || {};
    const acao = [p.acao ? '<b>' + escHtml(p.acao) + '</b>' : '', escHtml(p.rotulo)].filter(Boolean).join(' · ');
    const linhas = [];
    if (acao) linhas.push(acao);
    if (p.titulo) linhas.push(escHtml(p.titulo));
    if (p.obs) linhas.push(escHtml(p.obs));
    if (p.elemento) linhas.push('Elemento: <code>' + escHtml(p.elemento) + '</code>');
    if (p.elementoId) linhas.push('id: <code>' + escHtml(p.elementoId) + '</code>');
    if (p.html) {
      const h = String(p.html);
      linhas.push('HTML do elemento: <code>' + escHtml(h.slice(0, LIMITE_HTML_ELEMENTO))
        + (h.length > LIMITE_HTML_ELEMENTO ? ' [...]' : '') + '</code>');
    }
    const horas = [p.antes ? 'Antes: ' + escHtml(p.antes) : '', p.depois ? 'Depois: ' + escHtml(p.depois) : ''].filter(Boolean);
    if (horas.length) linhas.push(horas.join(' · '));
    if (p.urlAntes) linhas.push('URL antes: ' + escHtml(p.urlAntes));
    if (p.urlDepois) linhas.push('URL depois: ' + escHtml(p.urlDepois));
    return linhas.length ? linhas.join('<br>') : 'Passo sem descrição';
  }

  /* Lista numerada que cabe no limite, dizendo quantos ficaram de fora. */
  function listaDePassos(itens, cabecalho) {
    let html = cabecalho ? escHtml(cabecalho) + '<br><br>' : '';
    html += '<b>Passos gravados</b><ol>';
    let usados = 0;
    for (const item of itens) {
      const li = '<li>' + item + '</li>';
      if (html.length + li.length + 120 > LIMITE_TEXTO) break;
      html += li;
      usados++;
    }
    html += '</ol>';
    if (usados < itens.length) {
      html += 'E mais ' + (itens.length - usados) + ' passo(s): a lista completa está na evidência do Print.';
    }
    return html;
  }

  function comentarioCom(cabecalho, passos) {
    const itens = (Array.isArray(passos) ? passos : []).map(detalheDoPasso);
    if (!itens.length) return escHtml(cabecalho).slice(0, LIMITE_TEXTO);
    return listaDePassos(itens, cabecalho);
  }

  /* Quantos passos o script do caso tem. null quando não deu para saber: aí o
   * resultado não é montado passo a passo e a gravação vai no comentário. */
  async function passosDoCaso(chave) {
    try {
      const r = await chamar('GET', '/testcases/' + encodeURIComponent(chave) + '/teststeps', { params: { maxResults: 100 } });
      if (r && Number.isInteger(r.total)) return r.total;
      return lista(r).length;
    } catch (_) {
      return null;
    }
  }

  function resultadosPorPasso(qtdCaso, itens, status) {
    const um = qtdCaso === itens.length;
    return Array.from({ length: qtdCaso }, (_, i) => {
      const r = { statusName: status };
      const texto = um ? itens[i] : (i === 0 ? listaDePassos(itens, '') : '');
      if (texto) r.actualResult = texto.slice(0, LIMITE_TEXTO);
      return r;
    });
  }

  async function publicar({ caso, resultado, comentario, ciclo, passos }) {
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
    /* O Zephyr Essential recusa execucao sem ciclo ("testCycleKey: must not be
     * null"). A mensagem dele nao diz o que fazer; esta diz. */
    const alvo = String(ciclo || CICLO || '').trim();
    if (!alvo) {
      throw erro('Escolha o ciclo de teste: o Zephyr só registra execução dentro de um ciclo. '
        + 'Se o projeto ainda não tem nenhum, crie em Zephyr > Ciclos de Teste.', 400);
    }
    corpo.testCycleKey = alvo;

    const itens = (Array.isArray(passos) ? passos : []).map(detalheDoPasso);
    const qtdCaso = itens.length ? await passosDoCaso(chave) : null;
    let ondePassos = itens.length ? 'comentario' : null;
    if (qtdCaso) {
      corpo.testScriptResults = resultadosPorPasso(qtdCaso, itens, corpo.statusName);
      ondePassos = qtdCaso === itens.length ? 'passo-a-passo' : 'primeiro-passo';
      if (comentario) corpo.comment = escHtml(comentario).slice(0, LIMITE_TEXTO);
    } else {
      const texto = comentarioCom(comentario, passos);
      if (texto) corpo.comment = texto;
    }

    let r;
    try {
      r = await chamar('POST', '/testexecutions', { json: corpo });
    } catch (e) {
      /* Formato do resultado por passo recusado: publica de novo com os passos
       * no comentário, em vez de perder a execução inteira. */
      if (!corpo.testScriptResults || !/\(400\)/.test(e.message)) throw e;
      delete corpo.testScriptResults;
      corpo.comment = comentarioCom(comentario, passos);
      ondePassos = 'comentario';
      r = await chamar('POST', '/testexecutions', { json: corpo });
    }
    /* O POST devolve só o id numérico (4169534944). A chave (GOV-E7) é o que a
     * pessoa reconhece na tela e no comentário do Jira, então busca. Sem ela, o
     * id continua servindo para ligar a execução à demanda. */
    let execucao = (r && (r.key || r.id)) ? String(r.key || r.id) : '';
    if (r && !r.key && r.id) {
      try {
        const e = await chamar('GET', '/testexecutions/' + encodeURIComponent(r.id));
        if (e && e.key) execucao = String(e.key);
      } catch (e) { /* fica o id */ }
    }
    return {
      ok: true,
      execucao,
      caso: chave,
      ciclo: alvo || null,
      status: corpo.statusName,
      /* Onde os passos gravados ficaram: 'passo-a-passo', 'primeiro-passo',
       * 'comentario', ou null quando não havia passo. A tela diz isso. */
      passos: ondePassos,
      /* Dito na resposta, não escondido: a API 2.8 não tem endpoint de anexo,
       * então os prints não sobem junto. Quem chama decide o que mostrar. */
      anexado: false
    };
  }

  /* ---------- caso de teste a partir da gravação ----------
   * Quando o caso ainda não existe no Zephyr, a gravação vira o roteiro: cada
   * passo gravado vira um passo do caso, com a ação e o elemento na descrição,
   * o valor digitado nos dados de teste e o que aconteceu no resultado
   * esperado. Senha, CPF, cartão e token nunca chegam aqui: a extensão já apaga
   * esses valores no momento da captura. */
  const LIMITE_PASSOS_CASO = 200;

  function roteiroDoPasso(p) {
    p = p || {};
    const cab = [p.acao ? '<b>' + escHtml(p.acao) + '</b>' : '', escHtml(p.rotulo)].filter(Boolean).join(' · ');
    const descricao = [cab, escHtml(p.titulo),
      p.elemento ? 'Elemento: <code>' + escHtml(p.elemento) + '</code>' : '',
      p.elementoId ? 'id: <code>' + escHtml(p.elementoId) + '</code>' : '',
      p.urlAntes ? 'Página: ' + escHtml(p.urlAntes) : ''
    ].filter(Boolean).join('<br>') || 'Passo sem descrição';
    const mudouDePagina = p.urlDepois && p.urlDepois !== p.urlAntes;
    const esperado = p.obs ? escHtml(p.obs) : (mudouDePagina ? 'Abre ' + escHtml(p.urlDepois) : '');
    const passo = { description: descricao.slice(0, LIMITE_TEXTO) };
    if (p.valor) passo.testData = escHtml(p.valor).slice(0, 2000);
    if (esperado) passo.expectedResult = esperado.slice(0, 2000);
    return { inline: passo };
  }

  async function criarCaso({ nome, objetivo, passos }) {
    const n = String(nome || '').replace(/\s+/g, ' ').trim();
    if (!n) throw erro('Informe o nome do caso de teste.', 400);
    const lista = (Array.isArray(passos) ? passos : []).slice(0, LIMITE_PASSOS_CASO);

    const corpo = { projectKey: PROJETO, name: n.slice(0, 255), labels: ['audi-print'] };
    const obj = String(objetivo || '').trim();
    if (obj) corpo.objective = escHtml(obj).slice(0, 5000);
    const c = await chamar('POST', '/testcases', { json: corpo });
    const chave = String((c && c.key) || '');
    if (!CHAVE_CASO.test(chave)) throw erro('O Zephyr não devolveu a chave do caso criado.', 502);

    /* O caso já existe daqui em diante: roteiro recusado vira aviso, e a
     * evidência ainda pode ser publicada nele. */
    let comPassos = 0, aviso = null;
    if (lista.length) {
      try {
        await chamar('POST', '/testcases/' + encodeURIComponent(chave) + '/teststeps', {
          json: { mode: 'OVERWRITE', items: lista.map(roteiroDoPasso) } });
        comPassos = lista.length;
      } catch (e) {
        aviso = 'O caso ' + chave + ' foi criado, mas o roteiro não entrou: ' + e.message;
      }
    }
    if (Array.isArray(passos) && passos.length > LIMITE_PASSOS_CASO) {
      aviso = (aviso ? aviso + ' ' : '') + 'O roteiro ficou com os primeiros ' + LIMITE_PASSOS_CASO + ' passos.';
    }
    return { ok: true, chave, id: c.id, passos: comPassos, aviso };
  }

  /* Liga uma issue do Jira a uma execução: o bug aberto a partir da evidência
   * aparece na execução do Zephyr, e da execução se chega ao bug. */
  async function vincularIssue(execucao, issueId) {
    const id = Number(issueId);
    if (!String(execucao || '').trim() || !Number.isInteger(id)) throw erro('Execução ou issue inválida para o vínculo.', 400);
    return chamar('POST', '/testexecutions/' + encodeURIComponent(String(execucao).trim()) + '/links/issues', { json: { issueId: id } });
  }

  return {
    configurado, conferir, casos, ciclos, publicar, statusDe, vincularIssue, criarCaso, roteiroDoPasso,
    // expostos para o teste e para a tela:
    query, CHAVE_CASO, STATUS, BASE, PROJETO, CICLO, comentarioCom
  };
}

/* O módulo em si continua sendo a instância do ambiente, para quem chama
 * zephyr.publicar() direto (os testes, a linha de comando). */
module.exports = Object.assign(criar(doAmbiente()), { criar, doAmbiente });
