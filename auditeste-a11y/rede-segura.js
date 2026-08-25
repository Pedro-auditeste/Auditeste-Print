/* Fronteira de saída: para onde o servidor pode, ele mesmo, abrir conexão.
 *
 * O Print recebe uma URL e manda um Chrome sem tela visitá-la. Isso é um
 * pedido que o SERVIDOR faz, de dentro da rede dele, e é a definição de
 * SSRF: quem manda a URL escolhe o destino de uma conexão que sai de dentro.
 * "scan http://169.254.169.254/..." vira o servidor buscando o endpoint de
 * metadados da nuvem em nome de quem pediu.
 *
 * Duas armadilhas que um bloqueio ingênuo não pega, e as duas já derrubaram
 * scanner de verdade:
 *
 *   1. rebind de DNS: o atacante controla o DNS do próprio domínio. Na hora
 *      da checagem, ele responde um IP público; segundos depois, quando o
 *      navegador resolve de novo por conta própria, responde 127.0.0.1. A
 *      checagem viu público, a conexão foi para dentro. Conferir o nome não
 *      adianta: o nome é honesto, o número é que troca.
 *
 *   2. o próprio nome já aponta para dentro (rede-interna.exemplo -> 10.x).
 *
 * Contra a (2), resolver e recusar endereço privado. Contra a (1), depois de
 * validar, PRENDER o número: o navegador recebe uma regra que fixa aquele
 * host naquele IP validado e o proíbe de resolver de novo. O nome não
 * resolve mais duas vezes, então não tem como trocar entre a checagem e a
 * conexão.
 *
 * O que isto NÃO fecha, e é dito no pentest: redirecionamento para outro host
 * privado, e sub-recurso da página apontando para dentro. Esses o navegador
 * resolve à parte, e a trava de verdade contra eles é bloqueio de saída na
 * rede do contêiner, que é infraestrutura e não código.
 */
const dns = require('dns').promises;
const net = require('net');

/* Todo espaço que não é internet pública de verdade. */
function faixaPrivada(ip) {
  const s = String(ip).toLowerCase();
  // ::ffff:127.0.0.1 e IPv4 escrito como IPv6: sem desembrulhar, passava direto.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  const alvo = mapeado ? mapeado[1] : s;

  if (net.isIPv4(alvo)) {
    const [a, b] = alvo.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)                // link-local, e o metadados da nuvem mora aqui
      || (a === 100 && b >= 64 && b <= 127)      // CGNAT: rede do provedor, não é pública
      || a >= 224;                               // multicast e reservado
  }
  return alvo === '::1' || alvo === '::'
    || alvo.startsWith('fc') || alvo.startsWith('fd') || alvo.startsWith('fe80');
}

/* Regra que o Chrome entende para PRENDER um host a um IP.
 *
 * --host-resolver-rules="MAP host ip" faz o Chrome usar esse IP e não
 * resolver o nome de novo. É o que tira o "de novo" do rebind de DNS.
 * IPv6 vai entre colchetes, que é como o resolvedor espera. */
function regraDeResolucao(host, ip) {
  const alvo = net.isIPv6(ip) ? '[' + ip + ']' : ip;
  return 'MAP ' + host + ' ' + alvo;
}

/* Valida uma URL de destino e devolve o IP validado para prender.
 *
 * Retorna { erro } quando recusa, ou { host, ip } quando libera. O ip é o
 * primeiro endereço público que o nome resolveu, e é ele que vai para a
 * regra do navegador.
 *
 * opts.allowlist: se não vazia, só domínios dela passam.
 * opts.privadoOk: em desenvolvimento/loopback, não resolve nem trava (o
 *   Print local precisa poder escanear a si mesmo).
 */
async function validarAlvo(alvo, opts) {
  const o = opts || {};
  let u;
  try { u = new URL(alvo); } catch (e) { return { erro: 'url inválida: ' + alvo }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { erro: 'protocolo não permitido: ' + u.protocol };
  }

  const host = u.hostname.toLowerCase();
  const lista = o.allowlist || [];
  if (lista.length && !lista.some(d => host === d || host.endsWith('.' + d))) {
    return { erro: 'domínio fora da allowlist: ' + host };
  }

  /* Loopback/dev: nada a resolver nem a prender. Sinaliza que não há regra. */
  if (o.privadoOk) return { host, ip: null };

  /* Host que já é um IP: não passa por DNS, então não tem rebind. Confere
   * direto e prende ele mesmo. IPv6 literal chega entre colchetes na URL. */
  const ipCru = host.replace(/^\[|\]$/g, '');
  if (net.isIP(ipCru)) {
    if (faixaPrivada(ipCru)) return { erro: 'endereço de rede interna bloqueado: ' + host };
    return { host, ip: ipCru };
  }

  let enderecos;
  try {
    enderecos = await dns.lookup(host, { all: true });
  } catch (e) {
    return { erro: 'não resolveu o domínio: ' + host };
  }
  if (!enderecos.length) return { erro: 'domínio sem endereço: ' + host };
  /* UM endereço privado entre os resolvidos já basta para recusar: o rebind
   * clássico devolve os dois, contando que a gente confira só o primeiro. */
  const privado = enderecos.find(e => faixaPrivada(e.address));
  if (privado) return { erro: 'endereço de rede interna bloqueado: ' + host };

  return { host, ip: enderecos[0].address };
}

module.exports = { faixaPrivada, regraDeResolucao, validarAlvo };
