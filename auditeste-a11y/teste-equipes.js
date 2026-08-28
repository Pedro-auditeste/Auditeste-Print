/* Trava as regras de equipe: nome unico, criar equipe nova, apagar equipe.
 *
 *   node teste-equipes.js
 *
 * Sem servidor: exercita o banco direto.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const banco = require('./cofre/banco.js');

const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eq-')), 'c.db');
banco.abrir(arq);

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  ok   ' + nome); };
const recusa = (fn, status) => {
  try { fn(); } catch (e) { return e.status === status; }
  return false;
};

console.log('\nregras de equipe\n');

caso('cria a primeira equipe', () => {
  const t = banco.criarTenant('Amazon', 90);
  assert.ok(t.id);
});

caso('nao cria outra com o MESMO nome', () => {
  assert.ok(recusa(() => banco.criarTenant('Amazon', 90), 409), 'deveria recusar nome repetido');
});

caso('nao cria nem com caixa diferente (amazon vs Amazon)', () => {
  assert.ok(recusa(() => banco.criarTenant('amazon', 90), 409), 'lower() deveria pegar');
});

caso('cria com nome diferente, sem problema', () => {
  const t = banco.criarTenant('Google', 90);
  assert.ok(t.id);
});

caso('renomear para um nome que ja existe e recusado', () => {
  const g = banco.tenantPorNome('Google');
  assert.ok(recusa(() => banco.renomearTenant(g.id, 'Amazon'), 409));
});

caso('renomear para nome livre funciona, e renomear para o proprio nome tambem', () => {
  const g = banco.tenantPorNome('Google');
  assert.ok(banco.renomearTenant(g.id, 'Alphabet'));
  const a = banco.tenantPorNome('Alphabet');
  assert.ok(banco.renomearTenant(a.id, 'Alphabet'), 'renomear para o proprio nome nao pode falhar');
});

caso('apagar a equipe remove a linha, os membros e o usuario orfao', () => {
  const t = banco.criarTenant('Descartavel', 30);
  const u = banco.criarUsuario('so-nesta@x.com', 'hash');
  banco.vincular(t.id, u.id, 'admin');
  const proj = banco.criarProjeto(t.id, u.id, 'P', 'c');
  assert.ok(banco.obterTenant(t.id));

  const r = banco.apagarTenant(t.id);
  assert.strictEqual(banco.obterTenant(t.id), null, 'a equipe deveria sumir');
  assert.strictEqual(banco.usuarioPorEmail('so-nesta@x.com'), null, 'o usuario orfao deveria sumir');
  assert.strictEqual(r.usuariosRemovidos, 1);
  assert.strictEqual(banco.listarProjetos(t.id).length, 0, 'projetos do tenant nao existem mais');
  // e o nome volta a ficar livre
  assert.ok(banco.criarTenant('Descartavel', 30), 'nome apagado volta a ser usavel');
});

caso('apagar uma equipe nao derruba usuario que esta em OUTRA equipe', () => {
  const a = banco.criarTenant('EquipeA', 90);
  const b = banco.criarTenant('EquipeB', 90);
  const u = banco.criarUsuario('em-duas@x.com', 'hash');
  banco.vincular(a.id, u.id, 'admin');
  banco.vincular(b.id, u.id, 'consultor');

  banco.apagarTenant(a.id);
  assert.ok(banco.usuarioPorEmail('em-duas@x.com'), 'o usuario ainda pertence a EquipeB, nao pode sumir');
  assert.ok(banco.obterTenant(b.id), 'EquipeB continua');
});

banco.fechar();
console.log('\n' + n + ' casos, tudo certo\n');
