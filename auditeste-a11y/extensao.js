/* Empacota a extensão Chrome num .zip para o Print oferecer o download.
 *
 * ZIP escrito na mão, método "stored" (sem compressão): evita dependência nova
 * para uma tarefa de 70 linhas, e o Chrome carrega igual. São ~600 KB, quase
 * tudo axe.min.js, que já vem minificado — comprimir pouparia pouco.
 */
const fs = require('fs');
const path = require('path');

/* No repo a extensão fica ao lado; na imagem ela é copiada para dentro de /app.
 * Tentar os dois evita a rota existir e o arquivo não. */
const PASTA = [
  path.join(__dirname, '..', 'audi-print-scanner'),
  path.join(__dirname, 'audi-print-scanner')
].find((p) => fs.existsSync(path.join(p, 'manifest.json'))) || path.join(__dirname, 'audi-print-scanner');
const ARQUIVOS = [
  'manifest.json', 'background.js', 'content.js',
  'popup.html', 'popup.js', 'axe.min.js', 'README.md',
  // Barra normal de proposito: e o separador que o formato zip usa.
  'icones/icone-16.png', 'icones/icone-32.png',
  'icones/icone-48.png', 'icones/icone-128.png'
];

const TABELA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ TABELA[(c ^ buf[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

/** Data/hora no formato MS-DOS que o cabeçalho do ZIP exige. */
function dataDos(d) {
  const hora = ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xFFFF;
  const data = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  return { hora, data };
}

function montarZip() {
  const agora = dataDos(new Date());
  const locais = [];
  const central = [];
  let deslocamento = 0;

  for (const nome of ARQUIVOS) {
    const caminho = path.join(PASTA, nome);
    if (!fs.existsSync(caminho)) continue;
    const dados = fs.readFileSync(caminho);
    const nomeBuf = Buffer.from(nome, 'utf8');
    const soma = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // assinatura
    local.writeUInt16LE(20, 4);           // versão mínima
    local.writeUInt16LE(0, 6);            // sem flags
    local.writeUInt16LE(0, 8);            // método 0 = stored
    local.writeUInt16LE(agora.hora, 10);
    local.writeUInt16LE(agora.data, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nomeBuf, dados);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(agora.hora, 12);
    dir.writeUInt16LE(agora.data, 14);
    dir.writeUInt32LE(soma, 16);
    dir.writeUInt32LE(dados.length, 20);
    dir.writeUInt32LE(dados.length, 24);
    dir.writeUInt16LE(nomeBuf.length, 28);
    dir.writeUInt32LE(0, 38);             // atributos externos
    dir.writeUInt32LE(deslocamento, 42);  // onde começa o cabeçalho local
    central.push(dir, nomeBuf);

    deslocamento += local.length + nomeBuf.length + dados.length;
  }

  const corpo = Buffer.concat(locais);
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(central.length / 2, 8);   // entradas neste disco
  fim.writeUInt16LE(central.length / 2, 10);  // entradas no total
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(corpo.length, 16);
  return Buffer.concat([corpo, diretorio, fim]);
}

let cache = null;

/** O conteúdo não muda em produção: monta uma vez e reaproveita. */
function zipExtensao() {
  if (!cache) cache = montarZip();
  return cache;
}

module.exports = { zipExtensao, ARQUIVOS, PASTA };
