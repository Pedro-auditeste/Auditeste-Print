/* Recebe os cliques do bookmarklet e guarda até o Print buscar.
 *
 * O bookmarklet roda no navegador do analista — IP e sessão dele — então site
 * com antibot não bloqueia, ao contrário da navegação feita pelo servidor.
 *
 * O código de pareamento é a credencial: sem ele não se escreve nem se lê a
 * sessão. Por isso as rotas /marca/* não passam pelo PONTE_TOKEN — o
 * bookmarklet posta de outra origem e nunca casaria a checagem de mesma origem.
 */
const crypto = require('crypto');

const MAX_PASSOS = 200;
const MAX_SESSOES = 50;
const OCIOSO_MS = 4 * 60 * 60 * 1000;
const LIMITE_HTML = 1200;
const LIMITE_TEXTO = 300;

const sessoes = new Map();

/** Sem 0/O/1/I: o código é lido em voz alta e digitado à mão. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function novoCodigo() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return s;
}

function limpar(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || LIMITE_TEXTO);
}

function abrir() {
  if (sessoes.size >= MAX_SESSOES) {
    // Descarta a mais antiga em vez de recusar quem chegou agora.
    const maisVelha = [...sessoes.entries()].sort((a, b) => a[1].visto - b[1].visto)[0];
    if (maisVelha) sessoes.delete(maisVelha[0]);
  }
  const codigo = novoCodigo();
  sessoes.set(codigo, { passos: [], visto: Date.now(), criada: new Date().toISOString() });
  return { codigo };
}

function registrar(codigo, dados) {
  const s = sessoes.get(String(codigo || '').toUpperCase());
  if (!s) return { erro: 'código não encontrado. Gere um novo no Audi Print.' };
  s.visto = Date.now();
  if (s.passos.length >= MAX_PASSOS) return { erro: 'limite de passos atingido' };

  const seletor = limpar(dados && dados.seletor, LIMITE_TEXTO);
  if (!seletor) return { erro: 'sem seletor' };
  const rotulo = limpar(dados && dados.rotulo, 200);
  const agora = new Date().toISOString();

  s.passos.push({
    id: crypto.randomUUID(),
    titulo: `Clicou em "${rotulo || seletor}"`,
    obs: 'Descrição pendente.',
    acao: limpar(dados && dados.acao, 20) || 'Clicar',
    elemento: seletor,
    rotulo,
    html: limpar(dados && dados.html, LIMITE_HTML),
    valor: limpar(dados && dados.valor, 200),
    urlAntes: limpar(dados && dados.url, LIMITE_TEXTO),
    urlDepois: limpar(dados && dados.urlDepois, LIMITE_TEXTO) || limpar(dados && dados.url, LIMITE_TEXTO),
    timestampAntes: limpar(dados && dados.quando, 40) || agora,
    timestampDepois: agora,
    imagens: []
  });
  return { ok: true, total: s.passos.length };
}

function passos(codigo, desde) {
  const s = sessoes.get(String(codigo || '').toUpperCase());
  if (!s) return { erro: 'código não encontrado' };
  s.visto = Date.now();
  const n = Math.max(0, Number(desde) || 0);
  return { total: s.passos.length, passos: s.passos.slice(n) };
}

function fechar(codigo) {
  sessoes.delete(String(codigo || '').toUpperCase());
  return { ok: true };
}

setInterval(() => {
  for (const [c, s] of sessoes) if (Date.now() - s.visto > OCIOSO_MS) sessoes.delete(c);
}, 5 * 60 * 1000).unref();

module.exports = { abrir, registrar, passos, fechar };
