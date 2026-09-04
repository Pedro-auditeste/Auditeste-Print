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

caso('CRITERIO: um segmento nao cria outro segmento (400)', () => {
  const dono = banco.usuarioPorEmail('dono-seg@x.com');
  const seg = banco.tenantPorNome('OrgSeg · Alpha');
  // sessao DENTRO do segmento tentando criar sub-segmento
  assert.ok(recusa(() => contas.criarSegmento(reqFalso, sess(dono, seg), 'Neto'), 400),
    'de dentro de um segmento, criar segmento tem de ser recusado');
  assert.strictEqual(banco.tenantPorNome('OrgSeg · Alpha · Neto'), null, 'nao empilhou');
  assert.strictEqual(banco.tenantPorNome('OrgSeg · Neto'), null, 'nem reancorou na base as escondidas');
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

console.log('');
console.log('criar projeto dentro de um segmento');
console.log('');

caso('da base, escolher um segmento manda o projeto para la', () => {
  const org = banco.criarTenant('OrgProj', 90);
  const dono = banco.criarUsuario('dono-proj@x.com', 'h');
  banco.vincular(org.id, dono.id, 'admin');
  const s = sess(dono, org);
  contas.criarSegmento(reqFalso, s, 'Alpha');
  const seg = banco.tenantPorNome('OrgProj · Alpha');

  const destino = contas.destinoDoProjeto(s, seg.id);
  assert.strictEqual(destino, seg.id, 'o destino tem de ser o segmento');
  banco.criarProjeto(destino, dono.id, 'Projeto no segmento', 'C');
  assert.strictEqual(banco.listarProjetos(seg.id).length, 1, 'aparece no segmento');
  assert.strictEqual(banco.listarProjetos(org.id).length, 0, 'e NAO na base');
});

caso('sem escolher nada, o projeto vai para a equipe da sessao', () => {
  const org = banco.tenantPorNome('OrgProj');
  const dono = banco.usuarioPorEmail('dono-proj@x.com');
  assert.strictEqual(contas.destinoDoProjeto(sess(dono, org), ''), org.id);
  assert.strictEqual(contas.destinoDoProjeto(sess(dono, org), undefined), org.id);
});

caso('CRITERIO: id de segmento de OUTRA empresa e recusado (404)', () => {
  const org = banco.tenantPorNome('OrgProj');
  const dono = banco.usuarioPorEmail('dono-proj@x.com');
  banco.criarTenant('OutraOrg', 90);
  const alheio = banco.criarTenant('OutraOrg · Secreto', 90);
  const estranho = banco.criarUsuario('estranho-proj@x.com', 'h');
  banco.vincular(alheio.id, estranho.id, 'admin');
  assert.ok(recusa(() => contas.destinoDoProjeto(sess(dono, org), alheio.id), 404),
    'segmento de outra base nao pode ser destino');
  assert.strictEqual(banco.listarProjetos(alheio.id).length, 0, 'nada foi escrito la');
});

caso('CRITERIO: segmento da minha base em que NAO sou membro e recusado (403)', () => {
  const org = banco.tenantPorNome('OrgProj');
  const dono = banco.usuarioPorEmail('dono-proj@x.com');
  const semVinculo = banco.criarTenant('OrgProj · SemMim', 90);
  assert.ok(recusa(() => contas.destinoDoProjeto(sess(dono, org), semVinculo.id), 403));
});

caso('CRITERIO: leitor do segmento nao cria projeto la (403)', () => {
  const org = banco.tenantPorNome('OrgProj');
  const seg = banco.tenantPorNome('OrgProj · Alpha');
  const leitor = banco.criarUsuario('leitor-proj@x.com', 'h');
  banco.vincular(org.id, leitor.id, 'admin');
  banco.vincular(seg.id, leitor.id, 'leitor');
  assert.ok(recusa(() => contas.destinoDoProjeto(sess(leitor, org), seg.id), 403));
});

caso('CRITERIO: vinculo VALIDO em OUTRA equipe nao serve para criar aqui (404)', () => {
  // Nao e um estranho: a pessoa e admin de verdade da outra equipe. O ponto
  // e que "Criar em" so pode apontar para a base ATUAL da sessao ou um
  // segmento dela -- nunca para outra equipe, mesmo uma onde a pessoa tem
  // vinculo legitimo. Trocar de equipe existe para isso; este seletor nao.
  const org = banco.tenantPorNome('OrgProj');
  const outraEquipe = banco.criarTenant('EquipeVizinha', 90);
  const membroDasDuas = banco.criarUsuario('membro-duas-equipes@x.com', 'h');
  banco.vincular(org.id, membroDasDuas.id, 'consultor');
  banco.vincular(outraEquipe.id, membroDasDuas.id, 'admin');   // admin de verdade la
  assert.ok(recusa(() => contas.destinoDoProjeto(sess(membroDasDuas, org), outraEquipe.id), 404),
    'vinculo legitimo em outra equipe nao pode ser usado como destino a partir desta sessao');
  assert.strictEqual(banco.listarProjetos(outraEquipe.id).length, 0, 'nada foi escrito na equipe vizinha');
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
