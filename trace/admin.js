/* Trace: administracao por linha de comando.
 *
 * Conta de producao nasce AQUI, nunca pelo formulario: assim ninguem se
 * cadastra sozinho num ambiente que deveria ser fechado.
 *
 *   node admin.js criar-equipe <nome>
 *   node admin.js criar-conta <email> <senha> <equipe> [papel]
 *   node admin.js listar
 *   node admin.js backup [destino]
 *   node admin.js conferir <arquivo>
 *   node admin.js restaurar <arquivo>
 */
const fs = require('fs');
const banco = require('./banco.js');
const contas = require('./contas.js');

function abrirOuSair() {
  banco.abrir();
  if (!banco.ligado()) { console.error('banco desligado:', banco.porque()); process.exit(1); }
}

const cmd = process.argv[2];
const arg = process.argv.slice(3);

const acoes = {
  'criar-equipe'(nome) {
    if (!nome) { console.error('uso: criar-equipe <nome>'); process.exit(1); }
    abrirOuSair();
    const t = banco.criarTenant(nome);
    console.log('equipe criada:', t.nome, t.id);
  },

  'criar-conta'(email, senha, equipe, papel) {
    if (!email || !senha || !equipe) { console.error('uso: criar-conta <email> <senha> <equipe> [papel]'); process.exit(1); }
    abrirOuSair();
    let t = banco.tenantPorNome(equipe);
    if (!t) t = banco.criarTenant(equipe);
    let u = banco.usuarioPorEmail(email);
    if (!u) u = banco.criarUsuario(email, contas.hashSenha(senha));
    else console.log('(usuario ja existia, so vinculando)');
    banco.vincular(t.id, u.id, papel || 'admin');
    banco.registrar(t.id, u.id, 'admin:criar-conta', 'equipe:' + t.nome, 'cli');
    console.log('conta pronta:', email, 'na equipe', t.nome, 'como', papel || 'admin');
  },

  listar() {
    abrirOuSair();
    const db = banco.exigir();
    for (const t of db.prepare('SELECT * FROM tenants ORDER BY nome').all()) {
      const membros = db.prepare('SELECT u.email, m.papel FROM memberships m JOIN usuarios u ON u.id = m.usuario_id WHERE m.tenant_id = ?').all(t.id);
      console.log('- ' + t.nome + ' (' + t.id + ')');
      for (const m of membros) console.log('    ' + m.papel.padEnd(10) + m.email);
    }
  },

  sso(tenant, issuer, clientId, clientSecret, dominio, papel) {
    if (!tenant || !issuer || !clientId || !clientSecret || !dominio) { console.error('uso: sso <equipe> <issuer> <clientId> <clientSecret> <dominio> [papel]'); process.exit(1); }
    abrirOuSair();
    const t = banco.tenantPorNome(tenant) || banco.criarTenant(tenant);
    banco.ssoConfigurar(t.id, { issuer, clientId, clientSecret, dominio, papelPadrao: papel || 'consultor' });
    console.log('SSO configurado para', t.nome, 'no dominio', dominio, '(segredo guardado cifrado)');
  },

  poda() {
    abrirOuSair();
    const r = banco.podarVencidos();
    console.log('poda: ' + r.removidos + ' recurso(s) vencido(s) removido(s)');
  },

  backup(destino) {
    abrirOuSair();
    const alvo = destino || (banco.onde() + '.backup-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
    banco.snapshot(alvo);
    const conta = banco.conferirArquivo(alvo);
    const bytes = fs.statSync(alvo).size;
    console.log('backup criado e conferido');
    console.log('  arquivo  ' + alvo);
    console.log('  tamanho  ' + (bytes / 1048576).toFixed(2) + ' MB');
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
  },

  conferir(arquivo) {
    if (!arquivo) { console.error('uso: conferir <arquivo>'); process.exit(1); }
    const conta = banco.conferirArquivo(arquivo);
    console.log('arquivo integro e com cara de Trace');
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
  },

  restaurar(arquivo) {
    if (!arquivo) { console.error('uso: restaurar <arquivo>'); process.exit(1); }
    const atual = process.env.TRACE_BANCO;
    if (!atual) { console.error('TRACE_BANCO nao definido'); process.exit(1); }
    const conta = banco.conferirArquivo(arquivo);   // confere ANTES de encostar no que vale
    banco.fechar();
    const guardado = atual + '.antes-de-restaurar-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (fs.existsSync(atual)) fs.renameSync(atual, guardado);   // nao apaga: renomeia, para nao ser irreversivel
    fs.copyFileSync(arquivo, atual);
    console.log('restaurado. o banco anterior ficou em', guardado);
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
  },
};

if (!acoes[cmd]) {
  console.error('comandos: criar-equipe, criar-conta, sso, poda, listar, backup, conferir, restaurar');
  process.exit(1);
}
acoes[cmd](...arg);
