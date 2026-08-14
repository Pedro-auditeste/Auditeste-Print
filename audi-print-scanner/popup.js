/* Injeta axe-core na aba ativa, roda o scan e baixa o JSON no formato que
   o Audi Print importa. A saída é mapeada para objetos simples porque o
   resultado do axe carrega referências de DOM, que não atravessam a
   fronteira do executeScript. */

const botao = document.getElementById('analisar');
const msg = document.getElementById('msg');
const iniciar = document.getElementById('iniciar');
const parar = document.getElementById('parar');
const exportar = document.getElementById('exportar');
const limpar = document.getElementById('limpar');

function avisar(texto, erro) {
  msg.innerHTML = texto;
  msg.className = erro ? 'erro' : '';
}

async function abaAtual() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba || /^(chrome|edge|about|chrome-extension):/.test(aba.url || '')) {
    throw new Error('Abra uma página HTTP(S) para registrar o teste.');
  }
  return aba;
}

async function comando(tipo) {
  const aba = await abaAtual();
  const resposta = await chrome.runtime.sendMessage({ tipo, tabId: aba.id });
  if (resposta?.erro) throw new Error(resposta.erro);
  return { aba, sessao: resposta?.sessao || null };
}

function mostrarStatus(sessao) {
  const total = sessao?.passos?.length || 0;
  iniciar.disabled = !!sessao?.ativa;
  parar.disabled = !sessao?.ativa;
  exportar.disabled = !total;
  avisar(sessao?.ativa
    ? `<b>Gravando.</b> ${total} ação(ões). Mantenha esta aba visível.`
    : total
      ? `<b>${total} ação(ões)</b> prontas para importar no Audi Print.`
      : 'Nenhuma sessão em andamento.');
}

iniciar.addEventListener('click', async () => {
  try {
    const { sessao } = await comando('AUDI_INICIAR');
    mostrarStatus(sessao);
  } catch (erro) {
    avisar(erro.message, true);
  }
});

parar.addEventListener('click', async () => {
  try {
    avisar('Finalizando o último par...');
    const { sessao } = await comando('AUDI_PARAR');
    mostrarStatus(sessao);
  } catch (erro) {
    avisar(erro.message, true);
  }
});

limpar.addEventListener('click', async () => {
  try {
    await comando('AUDI_LIMPAR');
    mostrarStatus(null);
  } catch (erro) {
    avisar(erro.message, true);
  }
});

exportar.addEventListener('click', async () => {
  try {
    const { aba, sessao } = await comando('AUDI_STATUS');
    if (!sessao?.passos?.length) throw new Error('Nenhuma ação capturada.');
    const dados = {
      formato: 'audi-print-evidencia-v1',
      url: sessao.url || aba.url,
      titulo: sessao.titulo || aba.title || '',
      inicio: sessao.inicio,
      passos: sessao.passos
    };
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const host = new URL(aba.url).hostname.replace(/^www\./, '') || 'site';
    await chrome.downloads.download({
      url,
      filename: `audi-print-${host}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    mostrarStatus(sessao);
  } catch (erro) {
    avisar(erro.message, true);
  }
});

/* roda dentro da página sob teste */
async function rodarAxe() {
  const r = await axe.run(document, { resultTypes: ['violations'] });
  return {
    url: location.href,
    gerado: new Date().toISOString(),
    violations: r.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      nodes: v.nodes.map(n => ({ target: n.target }))
    }))
  };
}

function nomeArquivo(url) {
  let host = 'pagina';
  try { host = new URL(url).hostname.replace(/^www\./, '') || 'pagina'; } catch (e) {}
  const t = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `axe-${host}-${t}.json`;
}

botao.addEventListener('click', async () => {
  botao.disabled = true;
  avisar('Analisando...');

  try {
    const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!aba || /^(chrome|edge|about|chrome-extension):/.test(aba.url || '')) {
      throw new Error('Esta página é interna do navegador e não pode ser analisada.');
    }

    await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ['axe.min.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: rodarAxe });

    const total = result.violations.reduce((n, v) => n + v.nodes.length, 0);
    if (!total) {
      avisar('Nenhuma violação encontrada nesta página.');
      botao.disabled = false;
      return;
    }

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: nomeArquivo(aba.url), saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    avisar(`<b>${result.violations.length}</b> regra(s) violada(s), <b>${total}</b> elemento(s).<br>Importe o JSON no Audi Print.`);
  } catch (err) {
    avisar('Falhou: ' + err.message, true);
  }

  botao.disabled = false;
});

comando('AUDI_STATUS').then(({ sessao }) => mostrarStatus(sessao)).catch((erro) => {
  avisar(erro.message, true);
});
