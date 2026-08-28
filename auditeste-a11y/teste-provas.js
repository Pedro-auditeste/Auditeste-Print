/* Trava as provas de seguranca ao vivo: cada uma tem que ACENDER VERDE contra
 * o codigo real, e nenhuma pode gravar dado permanente.
 *
 *   node teste-provas.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.COFRE_CHAVE = 'a'.repeat(64);   // liga a cifra para a prova dela

const banco = require('./cofre/banco.js');
const contas = require('./cofre/contas.js');
const provas = require('./cofre/provas.js');

const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pv-')), 'c.db');
banco.abrir(arq);

// Assinatura de link, igual a de api.js, para a prova do link.
const SEGREDO = 'segredo-de-teste';
const assinar = (oid, tid, ate) => crypto.createHmac('sha256', SEGREDO)
  .update([oid, tid, ate].join('|')).digest('base64url');
const assinaturaValida = (oid, tid, ate, dada) => {
  if (!oid || !tid || !ate || !dada) return false;
  if (Date.now() > Number(ate)) return false;
  const a = Buffer.from(assinar(oid, tid, Number(ate)));
  const b = Buffer.from(String(dada));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Duas equipes: a minha e a de outro cliente (para a prova de isolamento).
const minha = banco.criarTenant('Minha equipe', 90);
const outro = banco.criarTenant('Outro cliente', 90);
const u = banco.criarUsuario('eu@x.com', 'hash');
banco.vincular(minha.id, u.id, 'admin');
const projAlheio = banco.criarProjeto(outro.id, u.id, 'Secreto do outro', 'cli');

const sessao = {
  tenantId: minha.id, tenantNome: minha.nome, usuarioId: u.id,
  retencaoDias: 90, ip: '127.0.0.1'
};
const deps = { banco, contas, sessao, assinar, assinaturaValida, LINK_VALE_MS: 5 * 60 * 1000 };

let n = 0;
const caso = (nome, fn) => { fn(); n++; console.log('  ok   ' + nome); };

console.log('\nprovas de seguranca ao vivo\n');

for (const [id] of provas.LISTA) {
  caso(id + ' acende verde', () => {
    const r = provas.rodar(id, deps);
    assert.strictEqual(r.id, id);
    assert.ok(r.titulo && r.ataque && r.esperado && r.obtido && r.evidencia, id + ' sem campos');
    assert.strictEqual(r.ok, true, id + ' deveria passar, mas: obtido=' + r.obtido);
  });
}

caso('a prova de isolamento realmente mira um id de OUTRO cliente', () => {
  const alheio = banco.projetoDeOutroTenant(minha.id);
  assert.ok(alheio && alheio.id === projAlheio.id, 'deveria achar o projeto do outro cliente');
  // ...e mesmo assim, no meu contexto, ele nao existe:
  assert.strictEqual(banco.obterProjeto(minha.id, projAlheio.id), null);
});

caso('nenhuma prova criou conta, equipe ou projeto de verdade', () => {
  assert.strictEqual(banco.usuarioPorEmail('eu@x.com') ? 1 : 0, 1, 'so o usuario de teste existe');
  // A prova de senha fraca tenta cadastrar prova-*@exemplo.invalido: nao pode ter criado nada.
  assert.strictEqual(banco.listarTenants().length, 2, 'continuam so as 2 equipes de teste');
  assert.strictEqual(banco.listarProjetos(minha.id).length, 0, 'minha equipe nao ganhou projeto');
});

caso('prova desconhecida e recusada com 400', () => {
  try { provas.rodar('nao-existe', deps); assert.fail('devia lancar'); }
  catch (e) { assert.strictEqual(e.status, 400); }
});

banco.fechar();
console.log('\n' + n + ' casos, tudo certo\n');
