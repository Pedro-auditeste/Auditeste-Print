/* Injeta axe-core na aba ativa, roda o scan e baixa o JSON no formato que
   o Audi Print importa. A saída é mapeada para objetos simples porque o
   resultado do axe carrega referências de DOM, que não atravessam a
   fronteira do executeScript. */

const botao = document.getElementById('analisar');
const msg = document.getElementById('msg');

function avisar(texto, erro) {
  msg.innerHTML = texto;
  msg.className = erro ? 'erro' : '';
}

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
