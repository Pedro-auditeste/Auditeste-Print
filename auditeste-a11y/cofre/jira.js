/* Bug no Jira a partir de uma evidência do Print.
 *
 * POR QUE NO JIRA E NÃO NO ZEPHYR: a API do Zephyr não aceita anexo, e a do
 * Jira aceita. O bug nasce com passos para reproduzir, esperado, observado e a
 * ficha da evidência; leva o HTML da evidência e os prints anexados; e fica
 * ligado à demanda (campo Demanda da ficha) e à execução no Zephyr, quando
 * elas existem.
 *
 * O token dá acesso ao Jira com as permissões de quem o gerou. Por isso ele
 * mora aqui, no servidor, e nunca passa pela página.
 *
 * CONFIGURAÇÃO: cada equipe informa a dela na tela do cofre (Jira e Zephyr),
 * e ela fica cifrada no banco; ver cofre/integracoes.js. As variáveis de
 * ambiente abaixo são a configuração do dono do servidor, e só valem para a
 * conta dele (nunca no git):
 *   JIRA_BASE        https://auditeste-gov.atlassian.net
 *   JIRA_EMAIL       e-mail da conta Atlassian dona do token
 *   JIRA_API_TOKEN   token de API da conta (id.atlassian.com > Segurança)
 *   JIRA_PROJETO     opcional; padrão: o mesmo do ZEPHYR_PROJETO
 *   JIRA_TIPO_BUG    opcional; nome do tipo de item. Sem ele: Bug, e se o
 *                    projeto não tiver Bug, Tarefa.
 */
const zephyrDoAmbiente = require('./zephyr.js');

const TEMPO_MS = Number(process.env.JIRA_TIMEOUT_MS || 45000);
const semBarra = v => String(v || '').trim().replace(/\/+$/, '');

/* O endereço do Jira vem de quem configura a equipe, e o servidor faz pedidos
 * para ele levando o token junto. Sem esta trava, bastaria informar um
 * endereço interno para usar o servidor como ponte. Vale Jira Cloud
 * (https://empresa.atlassian.net) ou exatamente o endereço que o dono do
 * servidor pôs em JIRA_BASE. Devolve o endereço limpo, '' se veio vazio e
 * null se não serve. */
function baseAceita(base) {
  const b = semBarra(base);
  if (!b) return '';
  if (b === semBarra(process.env.JIRA_BASE)) return b;
  return /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/i.test(b) ? b.toLowerCase() : null;
}

/* A configuração do dono do servidor, lida das variáveis de ambiente. */
function doAmbiente() {
  return {
    base: process.env.JIRA_BASE,
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_API_TOKEN,
    projeto: process.env.JIRA_PROJETO || process.env.ZEPHYR_PROJETO,
    tipoBug: process.env.JIRA_TIPO_BUG
  };
}

/* Uma instância por equipe, como no Zephyr. O segundo argumento é o Zephyr
 * DA MESMA equipe: é nele que o bug e a demanda ficam ligados à execução. */
function criar(cfg, zephyr) {
  cfg = cfg || {};
  zephyr = zephyr || { configurado: () => false };
  const BASE = baseAceita(cfg.base) || '';
  const EMAIL = String(cfg.email || '').trim();
  const TOKEN = String(cfg.token || '').trim();
  const PROJETO = String(cfg.projeto || '').trim().toUpperCase();
  const TIPO = String(cfg.tipoBug || '').trim();

  /* O Jira corta a descrição perto de 32 mil caracteres; fica folga para a
   * estrutura do documento. */
  const LIMITE_DESCRICAO = 26000;
  const LIMITE_HTML_ELEMENTO = 700;
  /* Soma dos anexos, depois de decodificados. O corpo que chega aqui já é
   * limitado a 25 MB, e base64 infla um terço. */
  const LIMITE_ANEXOS = 17 * 1024 * 1024;
  const CHAVE_ISSUE = /^[A-Z][A-Z0-9_]*-\d+$/;

  const configurado = () => !!(BASE && EMAIL && TOKEN && PROJETO);

  /* externo: a falha é do Jira, e a mensagem dele é o que explica. A rota não
   * mascara isso como "falha interna" (mesma regra do Zephyr). */
  function erro(msg, status) {
    const e = new Error(msg);
    e.status = status || 502;
    e.externo = true;
    return e;
  }

  async function chamar(metodo, caminho, { json, form } = {}) {
    if (!configurado()) throw erro('Jira não configurado para esta equipe.', 503);
    const headers = {
      Authorization: 'Basic ' + Buffer.from(EMAIL + ':' + TOKEN).toString('base64'),
      Accept: 'application/json'
    };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    /* Anexo exige este cabeçalho; sem ele o Jira devolve 403 (proteção XSRF). */
    if (form) { headers['X-Atlassian-Token'] = 'no-check'; body = form; }

    let r;
    try {
      r = await fetch(BASE + caminho, { method: metodo, headers, body, signal: AbortSignal.timeout(TEMPO_MS) });
    } catch (err) {
      throw erro('Não alcancei o Jira: ' + (err && err.message), 504);
    }
    const bruto = await r.text().catch(() => '');
    let dados = null;
    try { dados = bruto ? JSON.parse(bruto) : null; } catch (_) { /* nem tudo volta JSON */ }
    if (!r.ok) {
      const det = (dados && ((dados.errorMessages && dados.errorMessages.length && dados.errorMessages.join('; '))
        || (dados.errors && Object.keys(dados.errors).length && JSON.stringify(dados.errors))
        || dados.message)) || bruto.slice(0, 300);
      throw erro('Jira recusou (' + r.status + ')' + (det ? ': ' + det : ''), 502);
    }
    return dados;
  }

  /* ---------- tipo de item ---------- */

  const PREFERIDOS = ['bug', 'defeito', 'erro', 'bug report'];
  const RESERVA = ['tarefa', 'task'];

  async function tipoDoBug() {
    const p = await chamar('GET', '/rest/api/3/project/' + encodeURIComponent(PROJETO));
    const tipos = ((p && p.issueTypes) || []).filter(t => !t.subtask);
    const nome = t => String(t.name || '').toLowerCase();
    const achar = nomes => tipos.find(t => nomes.includes(nome(t)));
    const t = (TIPO && tipos.find(x => nome(x) === TIPO.toLowerCase())) || achar(PREFERIDOS) || achar(RESERVA) || tipos[0];
    if (!t) throw erro('O projeto ' + PROJETO + ' não tem tipo de item para abrir o bug.', 400);
    return { id: String(t.id), nome: String(t.name) };
  }

  /* ---------- descrição, em Atlassian Document Format ----------
   * ADF e não texto com marcação: o texto de cada passo vai literal, sem risco
   * de um colchete ou asterisco da página testada virar formatação no Jira. */

  const texto = (t, marcas) => Object.assign({ type: 'text', text: String(t) }, marcas ? { marks: marcas } : {});
  const negrito = t => texto(t, [{ type: 'strong' }]);
  const codigo = t => texto(t, [{ type: 'code' }]);
  const quebra = { type: 'hardBreak' };
  const paragrafo = nos => ({ type: 'paragraph', content: nos.filter(n => n && (n.type !== 'text' || n.text !== '')) });
  const titulo = t => ({ type: 'heading', attrs: { level: 3 }, content: [texto(t)] });

  function linhas(pares) {
    const nos = [];
    pares.forEach(([rotulo, valor], i) => {
      if (i) nos.push(quebra);
      nos.push(negrito(rotulo + ': '), texto(valor));
    });
    return paragrafo(nos);
  }

  function passoEmAdf(p) {
    p = p || {};
    const nos = [];
    const junta = (...n) => { if (nos.length) nos.push(quebra); nos.push(...n); };
    const acao = [p.acao, p.rotulo].filter(Boolean).join(' · ');
    if (acao) junta(negrito(acao));
    if (p.titulo) junta(texto(p.titulo));
    if (p.obs) junta(texto(p.obs));
    if (p.elemento) junta(texto('Elemento: '), codigo(p.elemento));
    if (p.elementoId) junta(texto('id: '), codigo(p.elementoId));
    const horas = [p.antes && 'Antes: ' + p.antes, p.depois && 'Depois: ' + p.depois].filter(Boolean).join(' · ');
    if (horas) junta(texto(horas));
    if (p.urlAntes) junta(texto('URL antes: ' + p.urlAntes));
    if (p.urlDepois) junta(texto('URL depois: ' + p.urlDepois));
    if (!nos.length) nos.push(texto('Passo sem descrição'));

    const conteudo = [paragrafo(nos)];
    if (p.html) {
      const h = String(p.html);
      conteudo.push({ type: 'codeBlock', attrs: { language: 'html' },
        content: [texto(h.slice(0, LIMITE_HTML_ELEMENTO) + (h.length > LIMITE_HTML_ELEMENTO ? '\n[...]' : ''))] });
    }
    return { type: 'listItem', content: conteudo };
  }

  const tamanho = no => JSON.stringify(no).length;

  function descricao({ ficha, passos, esperado, observado, execucaoZephyr }) {
    const f = ficha || {};
    const campos = [
      ['Evidência', f.registro ? f.registro + ' (Audi Print)' : 'Audi Print'],
      ['Módulo', f.modulo], ['Ambiente', f.ambiente], ['Versão / build', f.versao],
      ['Tipo de teste', f.tipo], ['Executado por', f.executor], ['Data', f.data],
      ['Demanda', f.demanda], ['Execução no Zephyr', execucaoZephyr]
    ].filter(([, v]) => v && String(v).trim());

    const conteudo = [linhas(campos)];
    let usado = tamanho(conteudo);

    const itens = [];
    const lista = Array.isArray(passos) ? passos : [];
    for (const p of lista) {
      const item = passoEmAdf(p);
      if (usado + tamanho(item) > LIMITE_DESCRICAO) break;
      itens.push(item);
      usado += tamanho(item);
    }
    conteudo.push(titulo('Passos para reproduzir'));
    if (itens.length) conteudo.push({ type: 'orderedList', content: itens });
    else conteudo.push(paragrafo([texto('Nenhum passo gravado.')]));
    if (itens.length < lista.length) {
      conteudo.push(paragrafo([texto('E mais ' + (lista.length - itens.length)
        + ' passo(s): a lista completa está no HTML da evidência, anexado.')]));
    }

    conteudo.push(titulo('Resultado esperado'), paragrafo([texto(String(esperado || '').trim() || 'Não informado.')]));
    conteudo.push(titulo('Resultado observado'), paragrafo([texto(String(observado || '').trim() || 'Não informado.')]));
    conteudo.push(titulo('Evidências'),
      paragrafo([texto('O HTML completo da evidência e os prints dos passos estão anexados a este item.')]));

    return { type: 'doc', version: 1, content: conteudo };
  }

  /* ---------- anexos ---------- */

  function arquivosValidos(anexos) {
    const saida = [];
    let total = 0;
    for (const a of (Array.isArray(anexos) ? anexos : []).slice(0, 80)) {
      if (!a || !a.base64) continue;
      const dados = Buffer.from(String(a.base64), 'base64');
      if (!dados.length || total + dados.length > LIMITE_ANEXOS) continue;
      total += dados.length;
      const nome = String(a.nome || 'anexo').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'anexo';
      saida.push({ nome, tipo: String(a.tipo || 'application/octet-stream'), dados });
    }
    return saida;
  }

  async function anexar(chave, arquivos) {
    if (!arquivos.length) return 0;
    const form = new FormData();
    for (const a of arquivos) form.append('file', new Blob([a.dados], { type: a.tipo }), a.nome);
    const r = await chamar('POST', '/rest/api/3/issue/' + encodeURIComponent(chave) + '/attachments', { form });
    return Array.isArray(r) ? r.length : arquivos.length;
  }

  /* ---------- o bug ---------- */

  async function criarBug({ titulo: resumo, esperado, observado, ficha, passos, execucaoZephyr, anexos }) {
    const sumario = String(resumo || '').replace(/\s+/g, ' ').trim();
    if (!sumario) throw erro('Informe o título do bug.', 400);

    const tipo = await tipoDoBug();
    const exec = String(execucaoZephyr || '').trim();
    const issue = await chamar('POST', '/rest/api/3/issue', { json: { fields: {
      project: { key: PROJETO },
      issuetype: { id: tipo.id },
      summary: sumario.slice(0, 250),
      description: descricao({ ficha, passos, esperado, observado, execucaoZephyr: exec }),
      labels: ['audi-print']
    } } });
    const chave = String(issue && issue.key || '');
    const avisos = [];

    /* Daqui para baixo o bug já existe. Falha em anexo ou vínculo vira aviso,
     * não erro: perder o bug por causa de um anexo seria pior. */
    let anexados = 0;
    const arquivos = arquivosValidos(anexos);
    try { anexados = await anexar(chave, arquivos); }
    catch (e) { avisos.push('Os anexos não subiram: ' + e.message); }
    if (arquivos.length < (Array.isArray(anexos) ? anexos.length : 0)) {
      avisos.push('Parte dos prints ficou de fora para caber no limite de envio; todos estão no HTML anexado.');
    }

    let demanda = null;
    const dem = String((ficha && ficha.demanda) || '').trim().toUpperCase();
    if (CHAVE_ISSUE.test(dem)) {
      try {
        await chamar('POST', '/rest/api/3/issueLink', { json: {
          type: { name: 'Relates' }, inwardIssue: { key: chave }, outwardIssue: { key: dem } } });
        demanda = dem;
      } catch (e) { avisos.push('Não liguei à demanda ' + dem + ': ' + e.message); }
    }

    let zephyrLigado = null;
    if (exec && zephyr.configurado()) {
      try { await zephyr.vincularIssue(exec, issue.id); zephyrLigado = exec; }
      catch (e) { avisos.push('Não liguei à execução ' + exec + ' do Zephyr: ' + e.message); }
    }

    return {
      ok: true,
      chave,
      url: BASE + '/browse/' + chave,
      tipo: tipo.nome,
      anexados,
      demanda,
      zephyr: zephyrLigado,
      avisos
    };
  }

  /* ---------- evidência na demanda ----------
   * A história da demanda (GOV-12) recebe o HTML da evidência e os prints, e um
   * comentário dizendo de que teste eles são. Quem abre a história vê a prova
   * sem sair dela, e a execução do Zephyr fica ligada à mesma história. */

  async function issue(chave) {
    const k = String(chave || '').trim().toUpperCase();
    if (!CHAVE_ISSUE.test(k)) throw erro('"' + (chave || '') + '" não é a chave de uma issue do Jira (formato GOV-12).', 400);
    try {
      const r = await chamar('GET', '/rest/api/3/issue/' + encodeURIComponent(k) + '?fields=summary');
      return { id: String(r.id), chave: String(r.key || k), titulo: String((r.fields && r.fields.summary) || '') };
    } catch (e) {
      if (/\(404\)/.test(e.message)) throw erro('A demanda ' + k + ' não existe no Jira, ou esta conta não enxerga ela.', 404);
      throw e;
    }
  }

  function comentarioDaEvidencia({ ficha, passos, resultado, arquivos, execucaoZephyr }) {
    const f = ficha || {};
    const n = Array.isArray(passos) ? passos.length : 0;
    const campos = [
      ['Resultado', resultado], ['Passos gravados', String(n)], ['Módulo', f.modulo],
      ['Ambiente', f.ambiente], ['Versão / build', f.versao], ['Executado por', f.executor],
      ['Data', f.data], ['Execução no Zephyr', execucaoZephyr]
    ].filter(([, v]) => v && String(v).trim());
    const conteudo = [
      paragrafo([negrito('Evidência de teste ' + (f.registro || '') + ' (Audi Print)')]),
      linhas(campos)
    ];
    /* So o HTML da evidencia e citado. Os prints ja aparecem na area de anexos
     * da issue; a lista de nomes aqui era texto que nao abria nada. */
    const documentos = arquivos.filter(a => !/^image/i.test(a.tipo || ''));
    if (documentos.length) {
      conteudo.push(paragrafo([texto('Anexo: ' + documentos.map(a => a.nome).join(', '))]));
    }
    return { type: 'doc', version: 1, content: conteudo };
  }

  async function anexarNaDemanda({ demanda, ficha, passos, resultado, execucaoZephyr, anexos }) {
    const arquivos = arquivosValidos(anexos);
    if (!arquivos.length) throw erro('Nada para anexar: a evidência veio sem arquivo.', 400);
    const alvo = await issue(demanda);
    const exec = String(execucaoZephyr || '').trim();
    const avisos = [];

    /* O anexo é o que importa aqui: se ele falhar, é erro, não aviso. */
    const anexados = await anexar(alvo.chave, arquivos);
    if (arquivos.length < (Array.isArray(anexos) ? anexos.length : 0)) {
      avisos.push('Parte dos prints ficou de fora para caber no limite de envio; todos estão no HTML anexado.');
    }

    let comentado = false;
    try {
      await chamar('POST', '/rest/api/3/issue/' + encodeURIComponent(alvo.chave) + '/comment', {
        json: { body: comentarioDaEvidencia({ ficha, passos, resultado, arquivos, execucaoZephyr: exec }) } });
      comentado = true;
    } catch (e) { avisos.push('Os anexos subiram, mas o comentário não: ' + e.message); }

    let zephyrLigado = null;
    if (exec && zephyr.configurado()) {
      try { await zephyr.vincularIssue(exec, alvo.id); zephyrLigado = exec; }
      catch (e) { avisos.push('Não liguei a execução ' + exec + ' do Zephyr: ' + e.message); }
    }

    return { ok: true, chave: alvo.chave, titulo: alvo.titulo, url: BASE + '/browse/' + alvo.chave,
      anexados, comentado, zephyr: zephyrLigado, avisos };
  }

  /* Leitura inofensiva, para conferir a credencial sem criar nada: quem é a
   * conta do token e com que tipo de item o bug vai nascer neste projeto. */
  async function conferir() {
    const eu = await chamar('GET', '/rest/api/3/myself');
    const tipo = await tipoDoBug();
    return { ok: true, base: BASE, projeto: PROJETO,
      conta: String((eu && (eu.displayName || eu.emailAddress)) || EMAIL),
      tipoBug: String((tipo && tipo.nome) || '') };
  }

  return {
    configurado, criarBug, anexarNaDemanda, issue, conferir,
    // expostos para o teste e para a tela:
    tipoDoBug, descricao, arquivosValidos, PROJETO, BASE, LIMITE_DESCRICAO
  };
}

module.exports = Object.assign(criar(doAmbiente(), zephyrDoAmbiente), { criar, doAmbiente, baseAceita });
