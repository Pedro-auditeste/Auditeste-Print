/* Trava o uso unico do convite, mesmo sob corrida (achado da segunda volta
 * de pentest, PT-8).
 *
 *   node teste-convite.js
 *
 * Sem servidor: exercita o banco direto. O caso que importa simula dois
 * cadastros que leram o mesmo convite "sem uso" e tentam consumi-lo: o
 * segundo tem de ser recusado e desfeito, sem depender de o cadastro rodar
 * sincrono.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const banco = require('./cofre/banco.js');

const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conv-')), 'c.db');
banco.abrir(arq);

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  ok   ' + nome); };

console.log('\nconvite de uso unico\n');

const t = banco.criarTenant('EquipeX', 90);
const chefe = banco.criarUsuario('chefe@x.com', 'hash');
banco.vincular(t.id, chefe.id, 'admin');

/* O id do convite E o hash do codigo. */
const codigoHash = 'hash-do-convite-teste-0001';
banco.criarConvite(t.id, chefe.id, 'consultor', codigoHash, 7);

caso('o convite nasce sem uso', () => {
  const c = banco.convitePorHash(codigoHash);
  assert.ok(c, 'convite deveria existir');
  assert.strictEqual(c.usado_em, null);
});

caso('o primeiro cadastro consome o convite e entra como consultor', () => {
  const c = banco.convitePorHash(codigoHash);
  const r = banco.cadastrar({ email: 'a@x.com', senhaHash: 'h', convite: c });
  assert.strictEqual(r.papel, 'consultor');
  assert.strictEqual(r.tenantId, t.id);
});

caso('convitePorHash nao devolve mais o convite ja usado', () => {
  assert.strictEqual(banco.convitePorHash(codigoHash), null);
});

caso('o segundo uso do MESMO convite e recusado, e o cadastro perdedor e desfeito', () => {
  /* O segundo racer tinha lido o convite antes da consumacao: reconstruo o
   * objeto como ele o teria, valido, e tento consumir depois do primeiro. */
  const comoOAtacanteViu = { id: codigoHash, tenant_id: t.id, papel: 'consultor', tenant_nome: 'EquipeX' };
  let status = 0;
  try {
    banco.cadastrar({ email: 'b@x.com', senhaHash: 'h', convite: comoOAtacanteViu });
  } catch (e) { status = e.status; }
  assert.strictEqual(status, 409, 'o segundo uso deveria ser recusado com 409');
  assert.strictEqual(banco.usuarioPorEmail('b@x.com'), null,
    'o cadastro que perdeu a corrida deveria ter sido desfeito no rollback');
});

caso('o convite ficou atribuido ao primeiro, nunca ao segundo', () => {
  const lista = banco.listarConvites(t.id);
  const c = lista.find(x => x.usado_por_email);
  assert.ok(c, 'o convite deveria constar como usado');
  assert.strictEqual(c.usado_por_email, 'a@x.com');
});

banco.fechar();
console.log('\n' + n + ' casos, tudo certo\n');
