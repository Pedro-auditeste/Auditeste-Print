/* Nenhum texto visível do Print pode citar IA.
 *
 *   node teste-sem-ia-na-tela.js
 *
 * Decisão de produto: o cliente não deve ler sobre IA na tela. Sem um teste,
 * a próxima mensagem nova traz "a IA sugere..." e ninguém percebe.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROIBIDO = /\bI\.?A\b|NVIDIA|intelig[êe]ncia artificial|llama|chatgpt|\bGPT\b|modelo de linguagem/i;

/* Identificadores nao sao lidos por ninguem: statusIA e nome de elemento, nao
 * texto de tela. So o que aparece para o usuario conta. */
const IDENTIFICADORES = /statusIA|PonteIA|TelaIA|ponteIACache|legenda-ia|localizador-ia|analise-qa|descreverTelaIA|resolverPonteIA/;

function visiveisDoHtml(html) {
  const semCodigo = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const textos = [...semCodigo.matchAll(/>([^<]{2,})</g)].map((m) => m[1].trim());
  const atributos = [...semCodigo.matchAll(/(?:placeholder|title|aria-label|alt)="([^"]+)"/g)]
    .map((m) => m[1]);
  return [...textos, ...atributos].filter(Boolean);
}

/** Mensagens montadas em JS que viram texto na tela. */
function mensagensDoJs(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]).join('\n');
  const semComentarios = scripts
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const chamadas = [...semComentarios.matchAll(
    /(?:avisar|informar|dizer\w*|textContent\s*=|innerHTML\s*=)\s*\(?\s*([\s\S]{0,240}?)[;\n]/g
  )].map((m) => m[1]);
  return chamadas.filter((c) => !IDENTIFICADORES.test(c));
}

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  OK   ' + nome); };

const arquivos = [
  path.join(__dirname, 'publico', 'index.html'),
  path.join(__dirname, '..', 'audi-print', 'evidencias-auditeste.html')
];

for (const arq of arquivos) {
  const nome = path.basename(path.dirname(arq)) + '/' + path.basename(arq);
  console.log('--- ' + nome + ' ---');
  const html = fs.readFileSync(arq, 'utf8');

  caso('nenhum texto de tela cita IA', () => {
    const maus = visiveisDoHtml(html).filter((x) => PROIBIDO.test(x));
    assert.deepStrictEqual(maus, [], 'na tela: ' + maus.join(' | '));
  });

  caso('nenhuma mensagem montada em JS cita IA', () => {
    const maus = mensagensDoJs(html).filter((x) => PROIBIDO.test(x));
    assert.deepStrictEqual(maus, [], 'em mensagem: ' + maus.map((m) => m.slice(0, 70)).join(' | '));
  });
}

console.log('\nRESULTADO: PASSOU (' + n + ' casos)');
