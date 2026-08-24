/* Administração do cofre pela linha de comando.
 *
 * A primeira conta não pode nascer por uma rota HTTP: uma rota de "criar o
 * primeiro admin" fica aberta até alguém usá-la, e quem chegar antes vira o
 * dono do sistema. Aqui exige acesso ao servidor, que é o que se espera de
 * quem provisiona.
 *
 *   node cofre/admin.js clientes
 *   node cofre/admin.js criar-cliente "Ailos" 90
 *   node cofre/admin.js criar-usuario pedro@auditeste.com <tenantId> admin
 *   node cofre/admin.js senha pedro@auditeste.com
 *   node cofre/admin.js vincular pedro@auditeste.com <tenantId> gestor
 *   node cofre/admin.js varrer
 *   node cofre/admin.js backup [destino]
 *   node cofre/admin.js conferir <arquivo>
 *   node cofre/admin.js restaurar <arquivo>
 *
 * A senha nunca vai na linha de comando: ela ficaria no histórico do shell.
 * Vem por COFRE_SENHA no ambiente, ou é sorteada e mostrada uma vez.
 */
require('../carregar-env.js').carregarEnvs();
const crypto = require('crypto');
const banco = require('./banco.js');
const contas = require('./contas.js');

function abrirOuSair() {
  if (banco.abrir()) return;
  console.error('Cofre desligado: ' + banco.porque());
  console.error('Defina COFRE_BANCO, por exemplo COFRE_BANCO=/dados/cofre.db');
  process.exit(1);
}

function senhaDeEntrada() {
  const dada = String(process.env.COFRE_SENHA || '').trim();
  if (dada) {
    if (dada.length < 12) {
      console.error('COFRE_SENHA muito curta: use pelo menos 12 caracteres.');
      process.exit(1);
    }
    return { senha: dada, sorteada: false };
  }
  return { senha: crypto.randomBytes(12).toString('base64url'), sorteada: true };
}

const comandos = {
  clientes() {
    const lista = banco.listarTenants();
    if (!lista.length) return console.log('nenhum cliente cadastrado');
    for (const t of lista) {
      console.log(t.id + '  ' + t.nome + '  retenção ' + t.retencao_dias + ' dias');
    }
  },

  'criar-cliente'(nome, dias) {
    if (!nome) { console.error('uso: criar-cliente "<nome>" [dias de retenção]'); process.exit(1); }
    const t = banco.criarTenant(nome, dias);
    console.log('cliente criado');
    console.log('  id        ' + t.id);
    console.log('  nome      ' + t.nome);
    console.log('  retenção  ' + t.retencao_dias + ' dias');
  },

  'criar-usuario'(email, tenantId, papel) {
    if (!email || !tenantId) {
      console.error('uso: criar-usuario <email> <tenantId> [papel]');
      process.exit(1);
    }
    if (!banco.obterTenant(tenantId)) { console.error('cliente não existe: ' + tenantId); process.exit(1); }
    if (banco.usuarioPorEmail(email)) { console.error('já existe usuário com este e-mail'); process.exit(1); }
    const { senha, sorteada } = senhaDeEntrada();
    const u = banco.criarUsuario(email, contas.hashSenha(senha));
    banco.vincular(tenantId, u.id, papel || 'consultor');
    /* Mudanca de permissao e evento auditavel como qualquer outro. Sem isto
     * a pergunta "quem deu acesso a essa pessoa, e quando" nao tinha resposta,
     * e ela vem junto com a primeira investigacao de verdade. */
    banco.auditar(tenantId, null, 'usuario.criado', u.email + ' como ' + (papel || 'consultor'), 'cli');
    console.log('usuário criado e vinculado');
    console.log('  email  ' + u.email);
    console.log('  papel  ' + (papel || 'consultor'));
    if (sorteada) console.log('  senha  ' + senha + '   (anote agora, não aparece de novo)');
  },

  senha(email) {
    if (!email) { console.error('uso: senha <email>'); process.exit(1); }
    const u = banco.usuarioPorEmail(email);
    if (!u) { console.error('usuário não encontrado'); process.exit(1); }
    const { senha, sorteada } = senhaDeEntrada();
    banco.trocarSenha(u.id, contas.hashSenha(senha));
    // Trocar a senha tem que derrubar o que já estava aberto, senão a sessão
    // de quem levou a senha antiga continua valendo.
    banco.revogarSessoesDoUsuario(u.id);
    for (const v of banco.vinculosDoUsuario(u.id)) {
      banco.auditar(v.tenant_id, u.id, 'senha.trocada', u.email, 'cli');
    }
    console.log('senha trocada e sessões abertas revogadas');
    if (sorteada) console.log('  senha  ' + senha + '   (anote agora, não aparece de novo)');
  },

  vincular(email, tenantId, papel) {
    if (!email || !tenantId) { console.error('uso: vincular <email> <tenantId> [papel]'); process.exit(1); }
    const u = banco.usuarioPorEmail(email);
    if (!u) { console.error('usuário não encontrado'); process.exit(1); }
    if (!banco.obterTenant(tenantId)) { console.error('cliente não existe'); process.exit(1); }
    banco.vincular(tenantId, u.id, papel || 'consultor');
    banco.auditar(tenantId, u.id, 'permissao.alterada', u.email + ' como ' + (papel || 'consultor'), 'cli');
    console.log('vínculo gravado: ' + u.email + ' -> ' + tenantId + ' como ' + (papel || 'consultor'));
  },

  varrer() {
    const r = banco.varrerVencidas();
    console.log('retenção aplicada: ' + r.evidencias + ' evidência(s) vencida(s), '
      + r.orfaos + ' objeto(s) órfão(s)');
  },

  backup(destino) {
    const alvo = destino || (process.env.COFRE_BANCO || 'cofre.db')
      + '.backup-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    banco.snapshot(alvo);
    /* Conferir agora, e nao na hora de precisar: backup que ninguem abriu e
     * so um arquivo grande com nome tranquilizador. */
    const conta = banco.conferirArquivo(alvo);
    const bytes = require('fs').statSync(alvo).size;
    console.log('backup criado e conferido');
    console.log('  arquivo  ' + alvo);
    console.log('  tamanho  ' + (bytes / 1048576).toFixed(2) + ' MB');
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
  },

  conferir(arquivo) {
    if (!arquivo) { console.error('uso: conferir <arquivo de backup>'); process.exit(1); }
    const conta = banco.conferirArquivo(arquivo);
    console.log('arquivo íntegro e com cara de cofre');
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
  },

  restaurar(arquivo) {
    if (!arquivo) { console.error('uso: restaurar <arquivo de backup>'); process.exit(1); }
    const fs = require('fs');
    const atual = process.env.COFRE_BANCO;
    if (!atual) { console.error('COFRE_BANCO não definido'); process.exit(1); }

    // Confere ANTES de encostar no que esta valendo.
    const conta = banco.conferirArquivo(arquivo);

    /* O banco atual nao e apagado, e renomeado. Restauracao e a operacao que
     * se faz com pressa e sob estresse, e restaurar o backup errado por cima
     * do bom nao pode ser irreversivel. */
    banco.fechar();
    const guardado = atual + '.antes-de-restaurar-'
      + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    try {
      if (fs.existsSync(atual)) fs.renameSync(atual, guardado);
      for (const sufixo of ['-wal', '-shm']) {
        if (fs.existsSync(atual + sufixo)) fs.rmSync(atual + sufixo);
      }
      fs.copyFileSync(arquivo, atual);
    } catch (err) {
      /* No Windows o sistema recusa mexer em arquivo aberto, e recusar e o
       * comportamento certo. O que nao pode e a pessoa ler EBUSY no meio de
       * uma restauracao e nao saber o que fazer. */
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        console.error('O banco está aberto por outro processo, então não dá para trocá-lo agora.');
        console.error('Pare o serviço (ou feche o que estiver usando ' + atual + ') e rode de novo.');
        console.error('Nada foi alterado.');
        process.exit(1);
      }
      throw err;
    }

    console.log('restaurado de ' + arquivo);
    for (const [t, n] of Object.entries(conta)) console.log('  ' + t.padEnd(12) + n);
    if (fs.existsSync(guardado)) console.log('  o banco anterior ficou em ' + guardado);
    console.log('');
    console.log('REINICIE o serviço: o servidor que já estava no ar continua');
    console.log('lendo o arquivo antigo até reiniciar.');
  }
};

const [comando, ...args] = process.argv.slice(2);
if (!comando || !comandos[comando]) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
  process.exit(comando ? 1 : 0);
}
abrirOuSair();
comandos[comando](...args);
