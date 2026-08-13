/* Carrega variáveis de um arquivo .env sem dependencia extra.
 * Ordem: auditeste-a11y/.env, depois .env na raiz do repo.
 * Nao sobrescreve variaveis ja definidas no ambiente (Railway, shell).
 */
const fs = require('fs');
const path = require('path');

function aplicarLinha(linha) {
  const t = String(linha || '').trim();
  if (!t || t.startsWith('#')) return;
  const i = t.indexOf('=');
  if (i <= 0) return;
  const chave = t.slice(0, i).trim();
  let valor = t.slice(i + 1).trim();
  if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
    valor = valor.slice(1, -1);
  }
  if (!chave || process.env[chave] != null && process.env[chave] !== '') return;
  process.env[chave] = valor;
}

function carregarEnv(arquivo) {
  try {
    if (!fs.existsSync(arquivo)) return false;
    const txt = fs.readFileSync(arquivo, 'utf8');
    txt.split(/\r?\n/).forEach(aplicarLinha);
    return true;
  } catch (e) {
    return false;
  }
}

function limparChave(v) {
  return String(v || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/** Aceita AGENTE_API_KEY ou qualquer env cujo valor comece com nvapi-. */
function resolverChaveAgente() {
  const nomes = ['AGENTE_API_KEY', 'NVIDIA_API_KEY', 'NVAPI_KEY', 'NVIDIA_APIKEY', 'CHAVE_NVIDIA'];
  for (const n of nomes) {
    const v = limparChave(process.env[n]);
    if (v) {
      process.env.AGENTE_API_KEY = v;
      return n;
    }
  }
  for (const [n, bruto] of Object.entries(process.env)) {
    if (!/agente|nvidia|nvapi|api.?key|apikey/i.test(n)) continue;
    const v = limparChave(bruto);
    if (v && /^nvapi-/i.test(v)) {
      process.env.AGENTE_API_KEY = v;
      return n;
    }
  }
  const atual = limparChave(process.env.AGENTE_API_KEY);
  if (atual) process.env.AGENTE_API_KEY = atual;
  return atual ? 'AGENTE_API_KEY' : null;
}

function varsAgenteVisiveis() {
  return Object.keys(process.env)
    .filter(k => /agente|nvidia|nvapi/i.test(k))
    .sort();
}

function carregarEnvs() {
  const aqui = __dirname;
  const raiz = path.resolve(aqui, '..');
  const carregados = [];
  for (const arq of [
    path.join(aqui, '.env'),
    path.join(raiz, '.env')
  ]) {
    if (carregarEnv(arq)) carregados.push(arq);
  }
  const chaveTxt = path.join(aqui, 'chave.txt');
  if (!limparChave(process.env.AGENTE_API_KEY) && fs.existsSync(chaveTxt)) {
    try {
      const v = limparChave(fs.readFileSync(chaveTxt, 'utf8').split(/\r?\n/)[0]);
      if (v && !v.startsWith('#')) {
        process.env.AGENTE_API_KEY = v;
        carregados.push(chaveTxt);
      }
    } catch (e) { /* ignore */ }
  }
  resolverChaveAgente();
  return carregados;
}

module.exports = { carregarEnvs, carregarEnv, resolverChaveAgente, varsAgenteVisiveis };
