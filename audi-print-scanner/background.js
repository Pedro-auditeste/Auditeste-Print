const CHAVE = 'sessoesAudiPrint';
const ESPERA_DEPOIS_MS = 900;
// Teto para a tela assentar: navegacao lenta adia o print "depois" ate aqui.
const ESPERA_MAX_MS = 8000;
const INTERVALO_PRINT_MS = 550;
const MAX_PASSOS = 40;

// Print de reserva, tirado quando o mouse pousa no elemento. O "antes" pedido
// so depois do clique chega tarde: a pagina ja rodou o handler dela e o Chrome
// ja repintou, entao o "antes" saia mostrando a tela DEPOIS.
const PRE_VALIDA_MS = 5000;
const PRE_INTERVALO_MS = 700;
const pre = new Map();

let ultimoPrint = 0;
let filaPrint = Promise.resolve();
const timers = new Map();
const prazos = new Map();
const locks = new Map();

function comLock(tabId, tarefa) {
  const anterior = locks.get(tabId) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(tarefa);
  const bloqueio = atual.finally(() => {
    if (locks.get(tabId) === bloqueio) locks.delete(tabId);
  });
  locks.set(tabId, bloqueio);
  return atual;
}

async function todas() {
  return (await chrome.storage.local.get(CHAVE))[CHAVE] || {};
}

async function obter(tabId) {
  return (await todas())[tabId] || null;
}

async function gravar(tabId, sessao) {
  const sessoes = await todas();
  if (sessao) sessoes[tabId] = sessao;
  else delete sessoes[tabId];
  await chrome.storage.local.set({ [CHAVE]: sessoes });
}

function capturar(tab) {
  filaPrint = filaPrint.catch(() => {}).then(async () => {
    const espera = Math.max(0, INTERVALO_PRINT_MS - (Date.now() - ultimoPrint));
    if (espera) await new Promise((resolve) => setTimeout(resolve, espera));
    const atual = await chrome.tabs.get(tab.id);
    if (!atual.active) throw new Error('Mantenha a aba do teste visível durante a captura.');
    const imagem = await chrome.tabs.captureVisibleTab(atual.windowId, {
      format: 'jpeg',
      quality: 78
    });
    ultimoPrint = Date.now();
    return imagem;
  });
  return filaPrint;
}

/* Guarda um print recente da aba, para servir de "antes" no proximo passo. */
function preCapturar(tabId) {
  const anterior = pre.get(tabId);
  if (anterior && Date.now() - anterior.quando < PRE_INTERVALO_MS) return anterior.pronta;
  const quando = Date.now();
  const pronta = (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) throw new Error('aba escondida');
    return { imagem: await capturar(tab), url: tab.url || '' };
  })();
  pronta.catch(() => {});   // aba escondida ou limite do Chrome: segue sem reserva
  pre.set(tabId, { quando, pronta });
  return pronta;
}

/* O "antes" bom e o print de reserva, tirado ANTES do clique. So vale se for
 * recente e da mesma pagina; fora disso captura na hora, como antes. */
async function antesDe(tab) {
  const p = pre.get(tab.id);
  pre.delete(tab.id);
  // Espera a reserva em andamento em vez de tirar outro print: disparar um
  // segundo agora so entraria na fila atras dela, saindo ainda mais tarde.
  if (p && Date.now() - p.quando <= PRE_VALIDA_MS) {
    try {
      const { imagem, url } = await p.pronta;
      if (url === (tab.url || '')) return imagem;
    } catch (_) { /* reserva falhou: cai para a captura na hora */ }
  }
  return capturar(tab);
}

function limparTimer(tabId) {
  const timer = timers.get(tabId);
  if (timer) clearTimeout(timer);
  timers.delete(tabId);
}

/* O titulo e a frase que o QA le na evidencia; o campo `acao` fica com o verbo
 * cru, que e o que o script de automacao usa. */
const FRASES = {
  Clicar: 'Clicou em',
  Preencher: 'Preencheu',
  Limpar: 'Limpou',
  Marcar: 'Marcou',
  Desmarcar: 'Desmarcou',
  'Capturar texto': 'Leu'
};

function tituloDo(p) {
  const alvo = p.rotulo || p.seletor;
  const frase = FRASES[p.tipo] || 'Interagiu com';
  if (p.tipo === 'Capturar texto') return `Leu "${p.valor}"`;
  return `${frase} "${alvo}"` + (p.valor ? ` com "${p.valor}"` : '');
}

async function finalizar(tabId) {
  limparTimer(tabId);
  prazos.delete(tabId);
  return comLock(tabId, async () => {
    const sessao = await obter(tabId);
    if (!sessao?.ativa || !sessao.pendente || sessao.finalizando) return;
    sessao.finalizando = true;
    await gravar(tabId, sessao);

    try {
      const tab = await chrome.tabs.get(tabId);
      const depois = await capturar(tab);
      const p = sessao.pendente;
      const agora = new Date().toISOString();
      sessao.passos.push({
        id: p.id,
        titulo: tituloDo(p),
        obs: 'Descrição pendente.',
        acao: p.tipo || 'Clicar',
        elemento: p.seletor,
        rotulo: p.rotulo,
        valor: p.valor || '',
        html: p.html,
        timestampAntes: p.timestampAntes,
        timestampDepois: agora,
        urlAntes: p.urlAntes,
        urlDepois: tab.url || p.urlAntes,
        frameUrl: p.frameUrl || '',
        imagens: [
          { dataUrl: p.antes, legenda: `Antes · ${new Date(p.timestampAntes).toLocaleString('pt-BR')}` },
          { dataUrl: depois, legenda: `Depois · ${new Date(agora).toLocaleString('pt-BR')}` }
        ]
      });
      if (sessao.passos.length > MAX_PASSOS) sessao.passos.shift();
      sessao.pendente = null;
      sessao.finalizando = false;
      await gravar(tabId, sessao);
    } catch (erro) {
      sessao.finalizando = false;
      sessao.erro = erro.message;
      await gravar(tabId, sessao);
    }
  });
}

/* Cada evento adia o print "depois" em ESPERA_DEPOIS_MS, para pegar a tela ja
 * assentada. O prazo impede que uma pagina que nunca para de mexer (ticker,
 * banner rotativo) adie o passo para sempre. */
function agendarFinalizacao(tabId) {
  limparTimer(tabId);
  if (!prazos.has(tabId)) prazos.set(tabId, Date.now() + ESPERA_MAX_MS);
  const restante = prazos.get(tabId) - Date.now();
  const espera = Math.max(0, Math.min(ESPERA_DEPOIS_MS, restante));
  timers.set(tabId, setTimeout(() => finalizar(tabId), espera));
}

/* O content script nao sabe sozinho se a sessao esta gravando, e o realce so
 * pode existir durante a gravacao. Avisar falha de proposito calado em aba sem
 * content script (chrome://, PDF, aba recem-aberta). */
function avisarAba(tabId, ativa) {
  chrome.tabs.sendMessage(tabId, { tipo: 'AUDI_SESSAO', ativa }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  /* O alvo explicito vence o remetente: o popup manda tabId dizendo qual aba
   * gravar, e content script nao manda tabId nenhum. Ao contrario, uma pagina
   * de extensao aberta como aba comum criava a sessao nela mesma. */
  const tabId = msg.tabId ?? sender.tab?.id;
  if (!tabId) return;

  const executar = async () => {
    if (msg.tipo === 'AUDI_STATUS') return { sessao: await obter(tabId) };

    if (msg.tipo === 'AUDI_INICIAR') {
      const tab = await chrome.tabs.get(tabId);
      const sessao = {
        ativa: true,
        inicio: new Date().toISOString(),
        url: tab.url,
        titulo: tab.title || '',
        passos: [],
        pendente: null,
        erro: ''
      };
      await gravar(tabId, sessao);
      avisarAba(tabId, true);
      return { sessao };
    }

    if (msg.tipo === 'AUDI_PARAR') {
      await finalizar(tabId);
      const sessao = await obter(tabId);
      if (sessao) {
        sessao.ativa = false;
        await gravar(tabId, sessao);
      }
      avisarAba(tabId, false);
      return { sessao };
    }

    if (msg.tipo === 'AUDI_LIMPAR') {
      limparTimer(tabId);
      avisarAba(tabId, false);
      await gravar(tabId, null);
      return { sessao: null };
    }

    if (msg.tipo === 'AUDI_ACAO') {
      return comLock(tabId, async () => {
        const sessao = await obter(tabId);
        if (!sessao?.ativa || sessao.finalizando) return { ignorado: true };
        if (sessao.pendente) return { ignorado: true };
        const tab = await chrome.tabs.get(tabId);
        const antes = await antesDe(tab);
        sessao.pendente = {
          ...msg.acao,
          antes,
          timestampAntes: new Date().toISOString(),
          urlAntes: tab.url || msg.acao.urlAntes
        };
        sessao.erro = '';
        await gravar(tabId, sessao);
        agendarFinalizacao(tabId);
        return { ok: true };
      });
    }

    /* O mouse pousou num elemento clicavel: hora de guardar a reserva. */
    if (msg.tipo === 'AUDI_PRE') {
      const sessao = await obter(tabId);
      if (sessao?.ativa && !sessao.pendente && !sessao.finalizando) await preCapturar(tabId);
      return { ok: true };
    }

    if (msg.tipo === 'AUDI_ACAO_CONCLUIDA') {
      agendarFinalizacao(tabId);
      return { ok: true };
    }

    /* Resumo de todas as gravacoes, para o Print listar sem carregar as
     * imagens: uma sessao com 40 passos passa de 20 MB. */
    if (msg.tipo === 'AUDI_EVIDENCIAS') {
      const sessoes = await todas();
      return {
        evidencias: Object.entries(sessoes)
          .filter(([, s]) => s && (s.passos || []).length)
          .map(([id, s]) => ({
            tabId: Number(id),
            url: s.url || '',
            titulo: s.titulo || '',
            inicio: s.inicio || '',
            ativa: !!s.ativa,
            passos: s.passos.length
          }))
          .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)))
      };
    }

    // A evidencia inteira, no mesmo formato que o botao Exportar gera.
    if (msg.tipo === 'AUDI_EVIDENCIA') {
      const s = (await todas())[msg.deTab];
      if (!s || !(s.passos || []).length) return { erro: 'Nenhuma ação capturada nessa aba.' };
      return {
        evidencia: {
          formato: 'audi-print-evidencia-v1',
          url: s.url || '',
          titulo: s.titulo || '',
          inicio: s.inicio,
          passos: s.passos
        }
      };
    }
  };

  executar().then(responder).catch((erro) => responder({ erro: erro.message }));
  return true;
});

// 'loading' tambem adia: sem isso, uma navegacao que comeca depois dos 900 ms
// pegava o print "depois" na tela velha ou em branco.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'loading' && info.status !== 'complete') return;
  obter(tabId).then((s) => {
    if (s?.ativa && s.pendente) agendarFinalizacao(tabId);
  });
});

/* Fechar a aba testada nao pode jogar a gravacao fora: o fluxo normal e gravar,
 * fechar e abrir o Print para importar. Guarda as ultimas e descarta o resto. */
const SESSOES_GUARDADAS = 5;

chrome.tabs.onRemoved.addListener(async (tabId) => {
  limparTimer(tabId);
  prazos.delete(tabId);
  pre.delete(tabId);
  const sessoes = await todas();
  const s = sessoes[tabId];
  if (!s || !(s.passos || []).length) return gravar(tabId, null);

  s.ativa = false;
  s.encerrada = new Date().toISOString();
  sessoes[tabId] = s;

  const comPassos = Object.entries(sessoes)
    .filter(([, v]) => v && (v.passos || []).length)
    .sort((a, b) => String(b[1].inicio).localeCompare(String(a[1].inicio)));
  for (const [id] of comPassos.slice(SESSOES_GUARDADAS)) delete sessoes[id];

  await chrome.storage.local.set({ [CHAVE]: sessoes });
});
