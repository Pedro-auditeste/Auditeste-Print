const CHAVE = 'sessoesAudiPrint';
const ESPERA_DEPOIS_MS = 900;
const INTERVALO_PRINT_MS = 550;
const MAX_PASSOS = 40;

let ultimoPrint = 0;
let filaPrint = Promise.resolve();
const timers = new Map();
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

function limparTimer(tabId) {
  const timer = timers.get(tabId);
  if (timer) clearTimeout(timer);
  timers.delete(tabId);
}

async function finalizar(tabId) {
  limparTimer(tabId);
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
        titulo: `Clicou em "${p.rotulo || p.seletor}"`,
        obs: 'Descrição pendente.',
        acao: 'Clicar',
        elemento: p.seletor,
        rotulo: p.rotulo,
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

function agendarFinalizacao(tabId) {
  limparTimer(tabId);
  timers.set(tabId, setTimeout(() => finalizar(tabId), ESPERA_DEPOIS_MS));
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  const tabId = sender.tab?.id ?? msg.tabId;
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
      return { sessao };
    }

    if (msg.tipo === 'AUDI_PARAR') {
      await finalizar(tabId);
      const sessao = await obter(tabId);
      if (sessao) {
        sessao.ativa = false;
        await gravar(tabId, sessao);
      }
      return { sessao };
    }

    if (msg.tipo === 'AUDI_LIMPAR') {
      limparTimer(tabId);
      await gravar(tabId, null);
      return { sessao: null };
    }

    if (msg.tipo === 'AUDI_ACAO') {
      return comLock(tabId, async () => {
        const sessao = await obter(tabId);
        if (!sessao?.ativa || sessao.finalizando) return { ignorado: true };
        if (sessao.pendente) return { ignorado: true };
        const tab = await chrome.tabs.get(tabId);
        const antes = await capturar(tab);
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

    if (msg.tipo === 'AUDI_ACAO_CONCLUIDA') {
      agendarFinalizacao(tabId);
      return { ok: true };
    }
  };

  executar().then(responder).catch((erro) => responder({ erro: erro.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') obter(tabId).then((s) => {
    if (s?.ativa && s.pendente) agendarFinalizacao(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  limparTimer(tabId);
  gravar(tabId, null);
});
