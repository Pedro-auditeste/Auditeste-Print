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
const contas = require('./cofre/contas.js');

const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eq-')), 'c.db');
banco.abrir(arq);

const reqFalso = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };

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

caso('sub-equipe nasce com o nome prefixado pela equipe atual, dona sua e isolada', () => {
  const mae = banco.criarTenant('Minha equipe', 90);
  const u = banco.criarUsuario('dona@x.com', 'hash');
  banco.vincular(mae.id, u.id, 'admin');
  const sessao = { usuarioId: u.id, email: 'dona@x.com', tenantNome: mae.nome, tokenHash: 'nao-existe' };

  const r = contas.criarEquipe(reqFalso, sessao, 'Confirmado');
  assert.strictEqual(r.sessao.tenantNome, 'Minha equipe · Confirmado', 'nome deveria vir prefixado');
  assert.strictEqual(r.sessao.papel, 'admin', 'quem cria vira admin');

  const filha = banco.tenantPorNome('Minha equipe · Confirmado');
  assert.ok(filha && filha.id !== mae.id, 'a sub-equipe e um tenant proprio, isolado');
  // so o dono e membro: ninguem entra sem convite
  const membros = banco.vinculo(filha.id, u.id);
  assert.ok(membros && membros.papel === 'admin');
  const estranho = banco.criarUsuario('estranho@x.com', 'hash');
  assert.strictEqual(banco.vinculo(filha.id, estranho.id), null, 'estranho nao entra sozinho');
});

caso('criar sub-equipe a partir de uma sub-equipe nao empilha o prefixo', () => {
  const u = banco.usuarioPorEmail('dona@x.com');
  const filha = banco.tenantPorNome('Minha equipe · Confirmado');
  const sessao = { usuarioId: u.id, email: u.email, tenantNome: filha.nome, tokenHash: 'nao-existe' };
  const r = contas.criarEquipe(reqFalso, sessao, 'Rascunho');
  assert.strictEqual(r.sessao.tenantNome, 'Minha equipe · Rascunho', 'reancora na raiz, sem A · B · C');
});

console.log('\nsegmentos da equipe\n');

const sess = (u, t) => ({ usuarioId: u.id, email: u.email, tenantId: t.id, tenantNome: t.nome, tokenHash: 'sess-' + t.id, ip: '127.0.0.1' });

caso('criar segmento nasce "Base · X", isolado, sem trocar de equipe', () => {
  const org = banco.criarTenant('OrgSeg', 90);
  const dono = banco.criarUsuario('dono-seg@x.com', 'h');
  banco.vincular(org.id, dono.id, 'admin');
  const r = contas.criarSegmento(reqFalso, sess(dono, org), 'Alpha');
  assert.strictEqual(r.segmento.nome, 'OrgSeg · Alpha');
  const seg = banco.tenantPorNome('OrgSeg · Alpha');
  assert.ok(seg && banco.vinculo(seg.id, dono.id).papel === 'admin');
});

caso('listar segmentos traz so os da base atual', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  const lista = contas.listarSegmentos(sess(dono, org));
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].sufixo, 'Alpha');
});

caso('renomear segmento troca o sufixo e mantem a base', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  const seg = banco.tenantPorNome('OrgSeg · Alpha');
  const r = contas.renomearSegmento(reqFalso, sess(dono, org), seg.id, 'Beta');
  assert.strictEqual(r.segmento.nome, 'OrgSeg · Beta');
  assert.strictEqual(banco.tenantPorNome('OrgSeg · Alpha'), null);
});

caso('excluir SEM escrever EXCLUIR e recusado (400)', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  const seg = banco.tenantPorNome('OrgSeg · Beta');
  assert.ok(recusa(() => contas.excluirSegmento(reqFalso, sess(dono, org), seg.id, 'sim'), 400));
  assert.ok(banco.obterTenant(seg.id), 'o segmento continua de pe');
});

caso('excluir a equipe BASE por aqui e recusado (404: nao e segmento)', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  assert.ok(recusa(() => contas.excluirSegmento(reqFalso, sess(dono, org), org.id, 'EXCLUIR'), 404));
  assert.ok(banco.obterTenant(org.id), 'a base continua');
});

caso('quem NAO e admin do segmento nao exclui (403)', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const seg = banco.tenantPorNome('OrgSeg · Beta');
  const outro = banco.criarUsuario('consultor-seg@x.com', 'h');
  banco.vincular(seg.id, outro.id, 'consultor');
  assert.ok(recusa(() => contas.excluirSegmento(reqFalso, sess(outro, org), seg.id, 'EXCLUIR'), 403));
  assert.ok(banco.obterTenant(seg.id), 'o segmento continua');
});

caso('excluir com EXCLUIR apaga; e se estava nele, volta para a base', () => {
  const org = banco.tenantPorNome('OrgSeg');
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  const seg = banco.tenantPorNome('OrgSeg · Beta');
  // sessao DENTRO do segmento
  const r = contas.excluirSegmento(reqFalso, sess(dono, seg), seg.id, 'EXCLUIR');
  assert.strictEqual(banco.obterTenant(seg.id), null, 'o segmento sumiu');
  assert.ok(r.sessao && r.sessao.tenantId === org.id, 'a sessao voltou para a base');
});

console.log('\nsegmento nao vaza para provedora\n');

caso('provedora ve cliente real, mas NAO ve nem entra em segmento alheio', () => {
  const gov = banco.criarTenant('GovX', 90);
  banco.marcarProvedor(gov.id, true);
  const prov = banco.criarUsuario('provedor@x.com', 'h');
  banco.vincular(gov.id, prov.id, 'admin');
  const cliente = banco.criarTenant('ClienteX', 90);
  const seg = banco.criarTenant('GovX · secreto', 90);
  const dono = banco.criarUsuario('dono-seg2@x.com', 'h');
  banco.vincular(seg.id, dono.id, 'admin');

  const nomes = banco.equipesAlcancaveis(prov.id).map(t => t.nome);
  assert.ok(nomes.includes('ClienteX'), 'cliente real deve aparecer para a provedora');
  assert.ok(!nomes.includes('GovX · secreto'), 'segmento alheio NAO pode aparecer');
  assert.strictEqual(banco.acessoA(seg.id, prov.id), null, 'provedora nao entra no segmento alheio');
  assert.ok(banco.acessoA(seg.id, dono.id), 'o membro direto do segmento entra normal');
});

banco.fechar();
console.log('\n' + n + ' casos, tudo certo\n');
