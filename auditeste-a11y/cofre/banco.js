/* Cofre de evidências: o banco.
 *
 * SQLite pelo módulo do próprio Node, sem dependência nova. A alternativa
 * era Postgres, que traria durabilidade gerenciada de graça, mas nesta
 * máquina não existe Postgres nem Docker, e subir autenticação e isolamento
 * entre clientes sem conseguir testar nada seria pior que qualquer vantagem
 * do servidor gerenciado.
 *
 *   COFRE_BANCO   caminho do arquivo. Na Railway TEM que apontar para um
 *                 volume, senão o deploy seguinte apaga a evidência.
 *
 * A regra que vale mais que o esquema: NENHUMA função aqui aceita ser
 * chamada sem tenant. O isolamento não é uma checagem que o handler pode
 * esquecer, é um argumento obrigatório da consulta.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* Node < 22 */ }

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  retencao_dias INTEGER NOT NULL DEFAULT 90,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  ultimo_acesso INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  papel TEXT NOT NULL DEFAULT 'consultor',
  UNIQUE(tenant_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  criada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  revogada_em INTEGER
);

CREATE TABLE IF NOT EXISTS projetos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  cliente TEXT,
  criado_em INTEGER NOT NULL,
  criado_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execucoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  projeto_id TEXT NOT NULL,
  titulo TEXT,
  iniciada_em INTEGER NOT NULL,
  criada_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidencias (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  execucao_id TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  titulo TEXT,
  obs TEXT,
  acao TEXT,
  elemento TEXT,
  valor TEXT,
  html TEXT,
  url_antes TEXT,
  url_depois TEXT,
  criada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ativa',
  criada_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objetos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  evidencia_id TEXT NOT NULL,
  papel TEXT NOT NULL,
  tipo TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  dados BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  usuario_id TEXT,
  acao TEXT NOT NULL,
  recurso TEXT,
  ip TEXT,
  quando INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS convites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  papel TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER,
  usado_por TEXT
);

CREATE TABLE IF NOT EXISTS tentativas (
  chave TEXT PRIMARY KEY,
  contagem INTEGER NOT NULL,
  ate INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_memb_usuario ON memberships(usuario_id);
CREATE INDEX IF NOT EXISTS ix_proj_tenant ON projetos(tenant_id);
CREATE INDEX IF NOT EXISTS ix_exec_tenant ON execucoes(tenant_id, projeto_id);
CREATE INDEX IF NOT EXISTS ix_evid_tenant ON evidencias(tenant_id, execucao_id);
CREATE INDEX IF NOT EXISTS ix_evid_expira ON evidencias(expira_em);
CREATE INDEX IF NOT EXISTS ix_obj_evid ON objetos(tenant_id, evidencia_id);
CREATE INDEX IF NOT EXISTS ix_audit ON auditoria(tenant_id, quando);
CREATE INDEX IF NOT EXISTS ix_convite_tenant ON convites(tenant_id);
`;

let db = null;
let motivoDesligado = '';
let semVolume = false;

/* Onde o banco fica quando ninguem disse.
 *
 * A versao anterior exigia COFRE_BANCO e ficava desligada sem ele. O efeito
 * pratico foi pior que o risco que eu queria evitar: o login simplesmente
 * nao existia em producao, e quem precisava dele nao tinha como ligar sem
 * mexer em variavel de ambiente.
 *
 * Entao liga sozinho. O risco do disco efemero nao sumiu, mas mentir sobre
 * ele e que era inaceitavel: quando cai aqui, semVolume vira true e o
 * sistema avisa na tela e no /ping, em vez de perder evidencia calado. */
/* Dois nomes porque a Railway usa os dois nos exemplos, e montar em /data
 * quando o codigo so olha /dados falharia calado: o cofre subiria efemero e
 * o aviso continuaria na tela sem ninguem entender por que. */
const VOLUMES = ['/dados', '/data'];
let ondeEstou = '';

function caminhoPadrao() {
  for (const v of VOLUMES) {
    try {
      if (fs.existsSync(v) && fs.statSync(v).isDirectory()) {
        semVolume = false;
        ondeEstou = path.join(v, 'cofre.db');
        return ondeEstou;
      }
    } catch (e) { /* sem acesso: tenta o proximo */ }
  }
  semVolume = true;
  ondeEstou = path.join(__dirname, '..', 'dados', 'cofre.db');
  return ondeEstou;
}

/** true quando o banco esta em disco que o proximo deploy apaga. */
const efemero = () => semVolume;

/** Onde o banco ficou, para conferir sem adivinhar. Caminho nao e segredo. */
const onde = () => ondeEstou;

const id = () => crypto.randomUUID();
const agora = () => Date.now();

/* Chamado uma vez, na subida. Falhar aqui NAO derruba o servidor: o Print
 * local funciona sem cofre nenhum, e derrubar tudo por causa de um recurso
 * novo transformaria uma melhoria em indisponibilidade. */
function abrir(caminho) {
  if (db) return db;
  if (!DatabaseSync) {
    motivoDesligado = 'este Node não tem node:sqlite (precisa de 22 ou mais novo)';
    return null;
  }
  const arquivo = caminho || process.env.COFRE_BANCO || caminhoPadrao();
  if (caminho || process.env.COFRE_BANCO) {
    ondeEstou = arquivo;
    // Caminho dado a mao: so e volume se apontar para um dos pontos de
    // montagem conhecidos. Fora deles, tratamos como efemero e avisamos.
    semVolume = !VOLUMES.some(v => path.resolve(arquivo).replace(/\\/g, '/').startsWith(v + '/'));
  }
  try {
    if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true });
    db = new DatabaseSync(arquivo);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(ESQUEMA);
    migrar();
    motivoDesligado = '';
    return db;
  } catch (err) {
    motivoDesligado = 'não consegui abrir ' + arquivo + ': ' + err.message;
    db = null;
    return null;
  }
}

const ligado = () => !!db;
const porque = () => motivoDesligado;
function fechar() { if (db) { db.close(); db = null; } }

function exigir() {
  if (!db) {
    const e = new Error('Cofre desligado: ' + (motivoDesligado || 'sem banco'));
    e.status = 503;
    throw e;
  }
  return db;
}

/* O guarda que faz o isolamento ser estrutural.
 *
 * Toda função abaixo passa por aqui antes de montar SQL. Sem isso o dia em
 * que alguem escrever uma consulta nova e esquecer o tenant, a consulta
 * roda e devolve dado do cliente errado — o furo classico de SaaS B2B, e
 * ele nao aparece em teste feliz nenhum, so em incidente. */
function exigirTenant(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    const e = new Error('consulta sem tenant no contexto');
    e.status = 500;
    throw e;
  }
  return tenantId;
}

/* Colunas que nasceram depois. CREATE TABLE IF NOT EXISTS nao acrescenta
 * coluna em tabela que ja existe, entao banco antigo subiria sem ela e
 * quebraria na primeira consulta. */
function migrar() {
  const colunas = db.prepare('PRAGMA table_info(tenants)').all().map(c => c.name);
  if (!colunas.includes('provedor')) {
    db.exec('ALTER TABLE tenants ADD COLUMN provedor INTEGER NOT NULL DEFAULT 0');
  }
}

/* ---------- tenants, usuários, vínculos ---------- */

/* Equipe provedora: a consultoria que atende varios clientes.
 *
 * Quem pertence a ela alcanca a equipe de cada cliente, levando o proprio
 * papel, e cada entrada fica registrada na auditoria DO CLIENTE, para o
 * cliente conseguir ver quem entrou.
 *
 * A marca so se poe por linha de comando, nunca por rota. Se uma conta
 * pudesse se declarar provedora, bastaria criar uma equipe para enxergar
 * todas as outras, e o isolamento viraria enfeite. */
function marcarProvedor(tenantId, ligado) {
  exigirTenant(tenantId);
  exigir();
  db.prepare('UPDATE tenants SET provedor = ? WHERE id = ?').run(ligado ? 1 : 0, tenantId);
  return obterTenant(tenantId);
}

/** O vinculo do usuario numa equipe provedora, se houver. */
const vinculoProvedor = usuarioId => (exigir(), db.prepare(
  `SELECT m.tenant_id, m.papel, t.nome AS tenant_nome
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.usuario_id = ? AND t.provedor = 1
    ORDER BY t.nome LIMIT 1`).get(usuarioId) || null);

/* Toda equipe que este usuario pode abrir: as dele, mais as dos clientes
 * quando ele e da provedora. `via` diz por qual porta ele entra, e a tela
 * usa isso para mostrar que aquele acesso e da consultoria. */
function equipesAlcancaveis(usuarioId) {
  exigir();
  const proprias = vinculosDoUsuario(usuarioId).map(v => ({
    id: v.tenant_id, nome: v.tenant_nome, papel: v.papel, via: 'membro'
  }));
  const prov = vinculoProvedor(usuarioId);
  if (!prov) return proprias;
  /* Mesma regra do portao, no mesmo lugar conceitual. O teste pegou os dois
   * discordando: acessoA recusava o leitor, e esta listagem entregava a ele
   * a relacao inteira de clientes. Nao vazava acesso, vazava a carteira de
   * clientes da consultoria, que e informacao comercial. */
  if (prov.papel === 'leitor') return proprias;

  const jaTem = new Set(proprias.map(t => t.id));
  const clientes = db.prepare('SELECT id, nome FROM tenants WHERE provedor = 0 ORDER BY nome').all();
  for (const c of clientes) {
    if (jaTem.has(c.id)) continue;
    proprias.push({ id: c.id, nome: c.nome, papel: prov.papel, via: 'provedor' });
  }
  return proprias;
}

/* Como este usuario alcanca ESTA equipe, ou null se nao alcanca.
 * E o unico lugar que decide isso; sessao e troca de equipe passam por aqui. */
function acessoA(tenantId, usuarioId) {
  exigirTenant(tenantId);
  exigir();
  const direto = vinculo(tenantId, usuarioId);
  if (direto) return { papel: direto.papel, via: 'membro' };

  const prov = vinculoProvedor(usuarioId);
  if (!prov) return null;
  const alvo = obterTenant(tenantId);
  /* Provedora nao entra em outra provedora: sao pares, nao cliente uma da
   * outra, e permitir isso seria escalonamento lateral. */
  if (!alvo || alvo.provedor) return null;
  /* Leitor da provedora fica na provedora: papel mais fraco nao sai visitando
   * cliente. */
  if (prov.papel === 'leitor') return null;
  return { papel: prov.papel, via: 'provedor', provedorNome: prov.tenant_nome };
}

function criarTenant(nome, retencaoDias) {
  exigir();
  const t = { id: id(), nome: String(nome), retencao_dias: Number(retencaoDias) || 90, criado_em: agora() };
  db.prepare('INSERT INTO tenants (id, nome, retencao_dias, criado_em) VALUES (?,?,?,?)')
    .run(t.id, t.nome, t.retencao_dias, t.criado_em);
  return t;
}

const obterTenant = tid => (exigir(), db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid) || null);
const listarTenants = () => (exigir(), db.prepare('SELECT * FROM tenants ORDER BY nome').all());

function criarUsuario(email, senhaHash) {
  exigir();
  const u = { id: id(), email: String(email).trim().toLowerCase(), senha_hash: senhaHash, criado_em: agora() };
  db.prepare('INSERT INTO usuarios (id, email, senha_hash, criado_em) VALUES (?,?,?,?)')
    .run(u.id, u.email, u.senha_hash, u.criado_em);
  return u;
}

const usuarioPorEmail = email =>
  (exigir(), db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).trim().toLowerCase()) || null);

const usuarioPorId = uid => (exigir(), db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid) || null);

function trocarSenha(usuarioId, senhaHash) {
  exigir();
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(senhaHash, usuarioId);
}

function marcarAcesso(usuarioId) {
  exigir();
  db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').run(agora(), usuarioId);
}

function vincular(tenantId, usuarioId, papel) {
  exigirTenant(tenantId);
  exigir();
  const m = { id: id(), tenant_id: tenantId, usuario_id: usuarioId, papel: papel || 'consultor' };
  db.prepare('INSERT OR REPLACE INTO memberships (id, tenant_id, usuario_id, papel) VALUES (?,?,?,?)')
    .run(m.id, m.tenant_id, m.usuario_id, m.papel);
  return m;
}

const vinculosDoUsuario = usuarioId => (exigir(), db.prepare(
  `SELECT m.tenant_id, m.papel, t.nome AS tenant_nome, t.retencao_dias
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.usuario_id = ? ORDER BY t.nome`).all(usuarioId));

const vinculo = (tenantId, usuarioId) => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT * FROM memberships WHERE tenant_id = ? AND usuario_id = ?').get(tenantId, usuarioId) || null);

/* ---------- convites ---------- */

/* Entrar numa equipe que ja existe precisa de convite, e nao de digitar o
 * nome dela: sem isto, "cadastrar" viraria porta para escolher de qual
 * cliente se quer ver a evidencia, que e exatamente o furo que o tenant
 * existe para fechar.
 *
 * O banco guarda so o hash do codigo, como faz com a sessao: uma copia do
 * banco nao pode entregar convite valido de ninguem. */
function criarConvite(tenantId, usuarioId, papel, hashCodigo, dias) {
  exigirTenant(tenantId);
  exigir();
  const c = {
    id: hashCodigo, tenant_id: tenantId, papel: papel || 'consultor',
    criado_por: usuarioId, criado_em: agora(),
    expira_em: agora() + (Number(dias) || 7) * 86400000
  };
  db.prepare(`INSERT INTO convites (id, tenant_id, papel, criado_por, criado_em, expira_em)
              VALUES (?,?,?,?,?,?)`)
    .run(c.id, c.tenant_id, c.papel, c.criado_por, c.criado_em, c.expira_em);
  return c;
}

/* Sem tenant de proposito: quem chega com um convite ainda nao pertence a
 * equipe nenhuma, entao aqui o proprio codigo e a credencial. E o unico
 * ponto do arquivo que consulta sem tenant, e por isso ele so aceita busca
 * pelo hash, nunca listagem. */
const convitePorHash = h => (exigir(), db.prepare(
  `SELECT c.*, t.nome AS tenant_nome FROM convites c JOIN tenants t ON t.id = c.tenant_id
    WHERE c.id = ? AND c.usado_em IS NULL AND c.expira_em > ?`).get(h, agora()) || null);

function marcarConviteUsado(h, usuarioId) {
  exigir();
  db.prepare('UPDATE convites SET usado_em = ?, usado_por = ? WHERE id = ?')
    .run(agora(), usuarioId, h);
}

const listarConvites = tenantId => (exigirTenant(tenantId), exigir(), db.prepare(
  `SELECT c.id, c.papel, c.criado_em, c.expira_em, c.usado_em, u.email AS usado_por_email
     FROM convites c LEFT JOIN usuarios u ON u.id = c.usado_por
    WHERE c.tenant_id = ? ORDER BY c.criado_em DESC LIMIT 50`).all(tenantId));

/* Cadastro numa transacao so.
 *
 * Criar o usuario e vincular em passos separados podia deixar conta orfa se
 * o segundo passo falhasse: conta que existe, entra em lugar nenhum, e
 * bloqueia o e-mail para sempre. */
function cadastrar({ email, senhaHash, equipe, convite, retencaoDias }) {
  exigir();
  db.exec('BEGIN');
  try {
    const u = {
      id: id(), email: String(email).trim().toLowerCase(),
      senha_hash: senhaHash, criado_em: agora()
    };
    db.prepare('INSERT INTO usuarios (id, email, senha_hash, criado_em) VALUES (?,?,?,?)')
      .run(u.id, u.email, u.senha_hash, u.criado_em);

    let tenantId, papel, tenantNome;
    if (convite) {
      tenantId = convite.tenant_id;
      papel = convite.papel;
      tenantNome = convite.tenant_nome;
      db.prepare('UPDATE convites SET usado_em = ?, usado_por = ? WHERE id = ?')
        .run(agora(), u.id, convite.id);
    } else {
      tenantId = id();
      papel = 'admin';
      tenantNome = String(equipe);
      db.prepare('INSERT INTO tenants (id, nome, retencao_dias, criado_em) VALUES (?,?,?,?)')
        .run(tenantId, tenantNome, Number(retencaoDias) || 90, agora());
    }
    db.prepare('INSERT INTO memberships (id, tenant_id, usuario_id, papel) VALUES (?,?,?,?)')
      .run(id(), tenantId, u.id, papel);

    db.exec('COMMIT');
    return { usuario: u, tenantId, tenantNome, papel };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ---------- sessões ---------- */

function criarSessao(idHash, usuarioId, tenantId, duracaoMs) {
  exigirTenant(tenantId);
  exigir();
  const s = {
    id: idHash, usuario_id: usuarioId, tenant_id: tenantId,
    criada_em: agora(), expira_em: agora() + duracaoMs
  };
  db.prepare('INSERT INTO sessoes (id, usuario_id, tenant_id, criada_em, expira_em) VALUES (?,?,?,?,?)')
    .run(s.id, s.usuario_id, s.tenant_id, s.criada_em, s.expira_em);
  return s;
}

const obterSessao = idHash => (exigir(), db.prepare(
  'SELECT * FROM sessoes WHERE id = ? AND revogada_em IS NULL AND expira_em > ?').get(idHash, agora()) || null);

function revogarSessao(idHash) {
  exigir();
  db.prepare('UPDATE sessoes SET revogada_em = ? WHERE id = ?').run(agora(), idHash);
}

function revogarSessoesDoUsuario(usuarioId) {
  exigir();
  db.prepare('UPDATE sessoes SET revogada_em = ? WHERE usuario_id = ? AND revogada_em IS NULL')
    .run(agora(), usuarioId);
}

/* ---------- projetos ---------- */

function criarProjeto(tenantId, usuarioId, nome, cliente) {
  exigirTenant(tenantId);
  exigir();
  const p = {
    id: id(), tenant_id: tenantId, nome: String(nome), cliente: cliente ? String(cliente) : null,
    criado_em: agora(), criado_por: usuarioId
  };
  db.prepare('INSERT INTO projetos (id, tenant_id, nome, cliente, criado_em, criado_por) VALUES (?,?,?,?,?,?)')
    .run(p.id, p.tenant_id, p.nome, p.cliente, p.criado_em, p.criado_por);
  return p;
}

const listarProjetos = tenantId => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT * FROM projetos WHERE tenant_id = ? ORDER BY criado_em DESC').all(tenantId));

/* O tenant entra no WHERE, nunca numa checagem depois do SELECT: buscar
 * pelo id e conferir o dono em seguida ja e ter lido o dado do outro. */
const obterProjeto = (tenantId, pid) => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT * FROM projetos WHERE tenant_id = ? AND id = ?').get(tenantId, pid) || null);

/* ---------- execuções ---------- */

function criarExecucao(tenantId, usuarioId, projetoId, titulo) {
  exigirTenant(tenantId);
  exigir();
  if (!obterProjeto(tenantId, projetoId)) {
    const e = new Error('projeto não encontrado neste cliente');
    e.status = 404;
    throw e;
  }
  const x = {
    id: id(), tenant_id: tenantId, projeto_id: projetoId,
    titulo: titulo ? String(titulo) : null, iniciada_em: agora(), criada_por: usuarioId
  };
  db.prepare('INSERT INTO execucoes (id, tenant_id, projeto_id, titulo, iniciada_em, criada_por) VALUES (?,?,?,?,?,?)')
    .run(x.id, x.tenant_id, x.projeto_id, x.titulo, x.iniciada_em, x.criada_por);
  return x;
}

const listarExecucoes = (tenantId, projetoId) => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT * FROM execucoes WHERE tenant_id = ? AND projeto_id = ? ORDER BY iniciada_em DESC')
  .all(tenantId, projetoId));

const obterExecucao = (tenantId, xid) => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT * FROM execucoes WHERE tenant_id = ? AND id = ?').get(tenantId, xid) || null);

/* ---------- cifra do conteudo da evidencia ---------- */

/* O print E a evidencia. Cifrar o resto e deixar o print em claro seria
 * teatro, entao o que vai cifrado aqui e o corpo do objeto.
 *
 * AES-256-GCM: alem de esconder, ele detecta adulteracao. Sem isso alguem
 * com acesso ao arquivo poderia trocar o conteudo de um print sem deixar
 * marca, e evidencia que se altera sem quebrar nao e evidencia.
 *
 * COFRE_CHAVE ausente = grava em claro, e o /ping diz isso. Preferi degradar
 * a recusar: recusar transformaria "esqueceu uma variavel" em perda de
 * servico, e o cofre ja funcionava sem cifra antes disso existir.
 *
 * PERDER A CHAVE E PERDER OS PRINTS. Nao ha recuperacao, e e isso que faz
 * cifra ser cifra. A chave nao pode morar no mesmo lugar do backup. */
const CIFRA = 'aes-256-gcm';
const MARCA = Buffer.from('AUDIENC1');   // 8 bytes, identifica objeto cifrado

function chaveDaCifra() {
  const bruta = String(process.env.COFRE_CHAVE || '').trim();
  if (!bruta) return null;
  /* Aceita hex de 64, que e o formato que o comando de gerar produz. Outra
   * coisa vira chave por derivacao, para nao recusar quem colou uma frase. */
  if (/^[0-9a-f]{64}$/i.test(bruta)) return Buffer.from(bruta, 'hex');
  return crypto.createHash('sha256').update(bruta).digest();
}

const cifraLigada = () => chaveDaCifra() !== null;

function cifrar(buf) {
  const chave = chaveDaCifra();
  if (!chave) return buf;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(CIFRA, chave, iv);
  const corpo = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MARCA, iv, c.getAuthTag(), corpo]);
}

/* Le os dois formatos. Banco que ja tinha print em claro continua abrindo
 * depois de ligar a cifra: o que estava la fica como esta, o novo entra
 * cifrado. Sem isso ligar a chave apagaria o passado na pratica. */
function decifrar(dados) {
  const buf = Buffer.from(dados);
  if (buf.length < MARCA.length || !buf.subarray(0, MARCA.length).equals(MARCA)) return buf;
  const chave = chaveDaCifra();
  if (!chave) {
    const e = new Error('Este arquivo está cifrado e COFRE_CHAVE não está definida.');
    e.status = 503;
    throw e;
  }
  const iv = buf.subarray(8, 20);
  const tag = buf.subarray(20, 36);
  const d = crypto.createDecipheriv(CIFRA, chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(36)), d.final()]);
}

/* ---------- evidências e objetos ---------- */

const CAMPOS_EVID = ['titulo', 'obs', 'acao', 'elemento', 'valor', 'html', 'url_antes', 'url_depois'];

function criarEvidencia(tenantId, usuarioId, execucaoId, campos, retencaoDias) {
  exigirTenant(tenantId);
  exigir();
  if (!obterExecucao(tenantId, execucaoId)) {
    const e = new Error('execução não encontrada neste cliente');
    e.status = 404;
    throw e;
  }
  const dias = Number(retencaoDias) || 90;
  const ev = {
    id: id(), tenant_id: tenantId, execucao_id: execucaoId,
    ordem: Number(campos.ordem) || 0,
    criada_em: agora(),
    expira_em: agora() + dias * 86400000,
    estado: 'ativa',
    criada_por: usuarioId
  };
  for (const c of CAMPOS_EVID) ev[c] = campos[c] == null ? null : String(campos[c]);

  db.prepare(`INSERT INTO evidencias
      (id, tenant_id, execucao_id, ordem, titulo, obs, acao, elemento, valor, html,
       url_antes, url_depois, criada_em, expira_em, estado, criada_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ev.id, ev.tenant_id, ev.execucao_id, ev.ordem, ev.titulo, ev.obs, ev.acao,
      ev.elemento, ev.valor, ev.html, ev.url_antes, ev.url_depois,
      ev.criada_em, ev.expira_em, ev.estado, ev.criada_por);
  return ev;
}

function anexar(tenantId, evidenciaId, papel, tipo, buffer) {
  exigirTenant(tenantId);
  exigir();
  const dono = db.prepare('SELECT id FROM evidencias WHERE tenant_id = ? AND id = ?')
    .get(tenantId, evidenciaId);
  if (!dono) {
    const e = new Error('evidência não encontrada neste cliente');
    e.status = 404;
    throw e;
  }
  const o = {
    id: id(), tenant_id: tenantId, evidencia_id: evidenciaId,
    papel: String(papel), tipo: String(tipo || 'application/octet-stream'),
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
  /* bytes e sha256 sao do conteudo ORIGINAL, nao do cifrado: e por eles que
   * se confere que o print voltou igual depois de um restore. */
  db.prepare('INSERT INTO objetos (id, tenant_id, evidencia_id, papel, tipo, bytes, sha256, dados) VALUES (?,?,?,?,?,?,?,?)')
    .run(o.id, o.tenant_id, o.evidencia_id, o.papel, o.tipo, o.bytes, o.sha256, cifrar(buffer));
  return o;
}

const listarEvidencias = (tenantId, execucaoId) => (exigirTenant(tenantId), exigir(), db.prepare(
  `SELECT id, execucao_id, ordem, titulo, obs, acao, elemento, valor,
          url_antes, url_depois, criada_em, expira_em, estado, criada_por
     FROM evidencias WHERE tenant_id = ? AND execucao_id = ? AND estado = 'ativa'
    ORDER BY ordem, criada_em`).all(tenantId, execucaoId));

const obterEvidencia = (tenantId, eid) => (exigirTenant(tenantId), exigir(), db.prepare(
  "SELECT * FROM evidencias WHERE tenant_id = ? AND id = ? AND estado = 'ativa'").get(tenantId, eid) || null);

const objetosDe = (tenantId, evidenciaId) => (exigirTenant(tenantId), exigir(), db.prepare(
  'SELECT id, papel, tipo, bytes, sha256 FROM objetos WHERE tenant_id = ? AND evidencia_id = ?')
  .all(tenantId, evidenciaId));

function obterObjeto(tenantId, oid) {
  exigirTenant(tenantId);
  exigir();
  const o = db.prepare('SELECT * FROM objetos WHERE tenant_id = ? AND id = ?').get(tenantId, oid);
  if (!o) return null;
  o.dados = decifrar(o.dados);
  return o;
}

/* Exclusão de verdade: metadado e arquivo saem juntos, na mesma transação.
 * Apagar só a linha da evidência deixaria o objeto órfão no banco, e um
 * órfão é exatamente o arquivo que ninguém sabe que ainda existe. */
function excluirEvidencia(tenantId, eid) {
  exigirTenant(tenantId);
  exigir();
  const alvo = db.prepare('SELECT id FROM evidencias WHERE tenant_id = ? AND id = ?').get(tenantId, eid);
  if (!alvo) return false;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM objetos WHERE tenant_id = ? AND evidencia_id = ?').run(tenantId, eid);
    db.prepare('DELETE FROM evidencias WHERE tenant_id = ? AND id = ?').run(tenantId, eid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}

function excluirProjeto(tenantId, pid) {
  exigirTenant(tenantId);
  exigir();
  if (!obterProjeto(tenantId, pid)) return null;
  const execs = listarExecucoes(tenantId, pid);
  let evidencias = 0;
  db.exec('BEGIN');
  try {
    for (const x of execs) {
      const ids = db.prepare('SELECT id FROM evidencias WHERE tenant_id = ? AND execucao_id = ?')
        .all(tenantId, x.id);
      for (const e of ids) {
        db.prepare('DELETE FROM objetos WHERE tenant_id = ? AND evidencia_id = ?').run(tenantId, e.id);
        db.prepare('DELETE FROM evidencias WHERE tenant_id = ? AND id = ?').run(tenantId, e.id);
        evidencias++;
      }
      db.prepare('DELETE FROM execucoes WHERE tenant_id = ? AND id = ?').run(tenantId, x.id);
    }
    db.prepare('DELETE FROM projetos WHERE tenant_id = ? AND id = ?').run(tenantId, pid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { execucoes: execs.length, evidencias };
}

/* "Excluir tudo deste cliente", que é a pergunta que chega junto com a
 * rescisão de contrato. Deixa o tenant e os vínculos: quem apagou, quando e
 * o que apagou continua respondível na auditoria. */
function excluirDadosDoTenant(tenantId) {
  exigirTenant(tenantId);
  exigir();
  const conta = {
    objetos: db.prepare('SELECT count(*) c FROM objetos WHERE tenant_id = ?').get(tenantId).c,
    evidencias: db.prepare('SELECT count(*) c FROM evidencias WHERE tenant_id = ?').get(tenantId).c,
    execucoes: db.prepare('SELECT count(*) c FROM execucoes WHERE tenant_id = ?').get(tenantId).c,
    projetos: db.prepare('SELECT count(*) c FROM projetos WHERE tenant_id = ?').get(tenantId).c
  };
  db.exec('BEGIN');
  try {
    for (const t of ['objetos', 'evidencias', 'execucoes', 'projetos']) {
      db.prepare('DELETE FROM ' + tabela(t) + ' WHERE tenant_id = ?').run(tenantId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return conta;
}

/* ---------- retenção ---------- */

function varrerVencidas(limite) {
  exigir();
  const teto = limite || agora();
  const vencidas = db.prepare('SELECT id, tenant_id FROM evidencias WHERE expira_em <= ?').all(teto);
  for (const e of vencidas) excluirEvidencia(e.tenant_id, e.id);
  const orfaos = db.prepare(
    'DELETE FROM objetos WHERE evidencia_id NOT IN (SELECT id FROM evidencias)').run();
  return { evidencias: vencidas.length, orfaos: orfaos.changes || 0 };
}

/* ---------- backup ---------- */

/* Copia consistente de um banco em uso.
 *
 * VACUUM INTO, e nao copiar o arquivo: o SQLite em WAL guarda escrita
 * recente num arquivo separado (-wal), entao copiar so o .db no meio de uma
 * gravacao produz um backup que abre e esta incompleto, que e o pior tipo de
 * backup: o que parece bom ate a hora de precisar dele. */
function snapshot(destino) {
  exigir();
  if (fs.existsSync(destino)) {
    const e = new Error('já existe arquivo em ' + destino);
    e.status = 409;
    throw e;
  }
  fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
  /* Caminho vem da linha de comando, nunca de requisicao, e ainda assim vai
   * escapado: e a unica string que este arquivo concatena em SQL, e a regra
   * de "so parametro" nao pode ter excecao sem trava. */
  db.exec("VACUUM INTO '" + String(destino).replace(/'/g, "''") + "'");
  return destino;
}

const TABELAS = ['tenants', 'usuarios', 'memberships', 'projetos',
  'execucoes', 'evidencias', 'objetos', 'auditoria'];

/* Nome de tabela nao vai como parametro em SQL, entao as poucas consultas que
 * o montam passam por aqui. Hoje o nome vem de lista fixa no proprio codigo,
 * mas "hoje vem de lista fixa" e exatamente o que se diz antes de alguem
 * passar a receber isso de fora. */
const NOMES_OK = new Set(TABELAS.concat(['sessoes', 'convites', 'tentativas']));
function tabela(nome) {
  if (!NOMES_OK.has(nome)) throw new Error('tabela desconhecida: ' + nome);
  return nome;
}

/* Abre um arquivo QUALQUER e diz se ele e um cofre inteiro.
 *
 * Restaurar sem conferir e como ter backup sem testar restauracao: o erro so
 * aparece depois que o original ja foi por cima. Confere integridade fisica,
 * presenca das tabelas e ainda devolve a contagem, para dar para comparar com
 * o que se esperava antes de trocar. */
function conferirArquivo(caminho) {
  if (!DatabaseSync) throw new Error('este Node não tem node:sqlite');
  if (!fs.existsSync(caminho)) throw new Error('arquivo não existe: ' + caminho);
  const outro = new DatabaseSync(caminho, { readOnly: true });
  try {
    const integridade = outro.prepare('PRAGMA integrity_check').get();
    const veredito = integridade && (integridade.integrity_check || Object.values(integridade)[0]);
    if (veredito !== 'ok') throw new Error('arquivo corrompido: ' + veredito);

    const contagem = {};
    for (const t of TABELAS) {
      try {
        contagem[t] = outro.prepare('SELECT count(*) c FROM ' + tabela(t)).get().c;
      } catch (err) {
        throw new Error('não parece um cofre: falta a tabela ' + t);
      }
    }
    return contagem;
  } finally {
    outro.close();
  }
}

/* ---------- auditoria ---------- */

function auditar(tenantId, usuarioId, acao, recurso, ip) {
  if (!db) return;
  db.prepare('INSERT INTO auditoria (tenant_id, usuario_id, acao, recurso, ip, quando) VALUES (?,?,?,?,?,?)')
    .run(tenantId || null, usuarioId || null, String(acao), recurso ? String(recurso) : null,
      ip ? String(ip) : null, agora());
}

const listarAuditoria = (tenantId, limite) => (exigirTenant(tenantId), exigir(), db.prepare(
  `SELECT a.*, u.email FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.tenant_id = ? ORDER BY a.quando DESC LIMIT ?`)
  .all(tenantId, Math.min(Number(limite) || 200, 1000)));

/* ---------- força bruta ---------- */

function tentativaFalhou(chave, janelaMs) {
  exigir();
  const t = db.prepare('SELECT * FROM tentativas WHERE chave = ?').get(chave);
  const ate = agora() + janelaMs;
  if (!t || t.ate <= agora()) {
    db.prepare('INSERT OR REPLACE INTO tentativas (chave, contagem, ate) VALUES (?,?,?)').run(chave, 1, ate);
    return 1;
  }
  const n = t.contagem + 1;
  db.prepare('UPDATE tentativas SET contagem = ?, ate = ? WHERE chave = ?').run(n, ate, chave);
  return n;
}

function tentativasDe(chave) {
  exigir();
  const t = db.prepare('SELECT * FROM tentativas WHERE chave = ?').get(chave);
  if (!t || t.ate <= agora()) return 0;
  return t.contagem;
}

function limparTentativas(chave) {
  exigir();
  db.prepare('DELETE FROM tentativas WHERE chave = ?').run(chave);
}

module.exports = {
  abrir, fechar, ligado, porque, efemero, onde, exigirTenant,
  cifraLigada, cifrar, decifrar,
  criarTenant, obterTenant, listarTenants,
  criarUsuario, usuarioPorEmail, usuarioPorId, trocarSenha, marcarAcesso,
  vincular, vinculosDoUsuario, vinculo,
  marcarProvedor, vinculoProvedor, equipesAlcancaveis, acessoA,
  criarSessao, obterSessao, revogarSessao, revogarSessoesDoUsuario,
  criarConvite, convitePorHash, marcarConviteUsado, listarConvites, cadastrar,
  criarProjeto, listarProjetos, obterProjeto, excluirProjeto,
  criarExecucao, listarExecucoes, obterExecucao,
  criarEvidencia, anexar, listarEvidencias, obterEvidencia, excluirEvidencia,
  objetosDe, obterObjeto,
  excluirDadosDoTenant, varrerVencidas,
  snapshot, conferirArquivo, TABELAS, tabela,
  auditar, listarAuditoria,
  tentativaFalhou, tentativasDe, limparTentativas
};
