/* Trava a fronteira de saída do scanner (o achado do pentest).
 *
 *   node teste-ssrf.js
 *
 * Sem navegador: exercita a função pura que decide se um destino de scan
 * pode ser visitado e qual IP prender. O que o navegador faz com o pino é
 * verificado em produção pela varredura, não aqui.
 *
 * O caso que importa é o rebind: um nome que resolve para dois endereços, um
 * público e um privado. Um scanner que confere só o primeiro cai; este
 * recusa. Como não dá para controlar o DNS de verdade num teste, a resolução
 * é injetada.
 */
const assert = require('assert');
const rede = require('./rede-segura.js');

let n = 0;
async function caso(nome, fn) { await fn(); n++; console.log('  ok   ' + nome); }

/* Injeta uma tabela de DNS no lugar da rede real: nome -> lista de IPs. */
function comDns(tabela, fn) {
  const dns = require('dns').promises;
  const original = dns.lookup;
  dns.lookup = async (host) => {
    const ips = tabela[host];
    if (!ips) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
    return ips.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Promise.resolve(fn()).finally(() => { dns.lookup = original; });
}

async function principal() {
  console.log('\nfronteira de saída · SSRF\n');

  /* --- faixaPrivada cobre o que precisa cobrir --- */
  await caso('metadados da nuvem é privado', () => {
    assert.strictEqual(rede.faixaPrivada('169.254.169.254'), true);
  });
  await caso('as faixas privadas todas, inclusive IPv4-em-IPv6 e CGNAT', () => {
    ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1',
     '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']
      .forEach(ip => assert.strictEqual(rede.faixaPrivada(ip), true, ip + ' deveria ser privado'));
  });
  await caso('endereço público continua público', () => {
    ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:2800::1']
      .forEach(ip => assert.strictEqual(rede.faixaPrivada(ip), false, ip + ' foi bloqueado sem motivo'));
  });

  /* --- protocolo e allowlist --- */
  await caso('protocolo fora de http(s) é recusado', async () => {
    for (const u of ['ftp://x/', 'file:///etc/passwd', 'gopher://x/', 'data:text/html,x']) {
      const r = await rede.validarAlvo(u, {});
      assert.ok(r.erro, u + ' deveria ser recusado');
    }
  });
  await caso('allowlist, quando existe, recusa fora dela', async () => {
    await comDns({ 'exemplo.com': ['93.184.216.34'], 'mau.com': ['93.184.216.34'], 'sub.exemplo.com': ['93.184.216.34'] }, async () => {
      assert.ok(!(await rede.validarAlvo('http://exemplo.com/', { allowlist: ['exemplo.com'] })).erro);
      assert.ok((await rede.validarAlvo('http://mau.com/', { allowlist: ['exemplo.com'] })).erro);
      assert.ok(!(await rede.validarAlvo('http://sub.exemplo.com/', { allowlist: ['exemplo.com'] })).erro,
        'subdomínio do domínio liberado deveria passar');
    });
  });

  /* --- host que já é IP privado --- */
  await caso('IP privado escrito na própria URL é barrado', async () => {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.5/', 'http://169.254.169.254/', 'http://[::1]/']) {
      const r = await rede.validarAlvo(u, {});
      assert.ok(r.erro, u + ' deveria ser barrado');
    }
  });
  await caso('IP público na URL passa e prende ele mesmo', async () => {
    const r = await rede.validarAlvo('http://93.184.216.34/', {});
    assert.strictEqual(r.erro, undefined);
    assert.strictEqual(r.ip, '93.184.216.34');
  });

  /* --- O CASO DO PENTEST: rebind de DNS --- */
  await caso('rebind: nome que resolve para público E privado é recusado', async () => {
    await comDns({ 'rebind.mau': ['93.184.216.34', '169.254.169.254'] }, async () => {
      const r = await rede.validarAlvo('http://rebind.mau/', {});
      assert.ok(r.erro, 'um endereço privado entre os resolvidos tem de recusar tudo');
    });
  });
  await caso('rebind: privado em PRIMEIRO na lista também é recusado', async () => {
    await comDns({ 'rebind2.mau': ['10.0.0.1', '93.184.216.34'] }, async () => {
      const r = await rede.validarAlvo('http://rebind2.mau/', {});
      assert.ok(r.erro, 'não pode confiar em nenhum endereço se algum é privado');
    });
  });
  await caso('nome só-privado é recusado', async () => {
    await comDns({ 'interno.corp': ['10.10.10.10'] }, async () => {
      assert.ok((await rede.validarAlvo('http://interno.corp/', {})).erro);
    });
  });
  await caso('nome só-público passa e prende o IP validado', async () => {
    await comDns({ 'site.bom': ['93.184.216.34'] }, async () => {
      const r = await rede.validarAlvo('http://site.bom/', {});
      assert.strictEqual(r.erro, undefined);
      assert.strictEqual(r.host, 'site.bom');
      assert.strictEqual(r.ip, '93.184.216.34', 'tem de devolver o IP público para prender');
    });
  });

  /* --- o pino que impede o navegador de resolver de novo --- */
  await caso('a regra do navegador prende host ao IP validado', () => {
    assert.strictEqual(rede.regraDeResolucao('site.bom', '93.184.216.34'), 'MAP site.bom 93.184.216.34');
  });
  await caso('IPv6 vai entre colchetes na regra', () => {
    assert.strictEqual(rede.regraDeResolucao('site.bom', '2606:2800::1'), 'MAP site.bom [2606:2800::1]');
  });

  /* --- modo local não trava nem resolve --- */
  await caso('privadoOk (loopback/dev) libera sem prender', async () => {
    const r = await rede.validarAlvo('http://qualquer.interno/', { privadoOk: true });
    assert.strictEqual(r.erro, undefined);
    assert.strictEqual(r.ip, null, 'em dev não há pino: o Print local escaneia a si mesmo');
  });

  console.log('\n' + n + ' casos, tudo certo\n');
}

principal().catch(err => {
  console.error('\nFALHOU: ' + (err && err.stack || err));
  process.exit(1);
});
