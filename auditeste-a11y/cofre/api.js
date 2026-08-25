/* Rotas do cofre. Tudo abaixo de /api.
 *
 * Duas regras que valem para cada handler daqui:
 *
 *   1. o tenant vem da sessão, nunca do pedido. Aceitar tenant no corpo ou
 *      na query seria entregar ao cliente a chave do próprio isolamento;
 *   2. nenhuma consulta busca por id e confere o dono depois. O tenant entra
 *      no WHERE (é o banco.js que obriga), então id de outro cliente não
 *      volta como "achei mas não é seu": volta como não existe.
 */
const crypto = require('crypto');
const banco = require('./banco.js');
const contas = require('./contas.js');
const sso = require('./sso.js');

const MAX_OBJETO = Number(process.env.COFRE_MAX_OBJETO_MB || 20) * 1024 * 1024;
const LINK_VALE_MS = Number(process.env.COFRE_LINK_MS) || 5 * 60 * 1000;
const TIPOS_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4']);

/* Segredo dos links assinados. Sem COFRE_SEGREDO, um por processo: os links
 * param de valer no redeploy, o que para link de 5 minutos é irrelevante e é
 * melhor que um segredo fixo escrito no código. */
const SEGREDO = process.env.COFRE_SEGREDO || crypto.randomBytes(32).toString('hex');

const json = (res, status, corpo, extra) => {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {}));
  res.end(JSON.stringify(corpo));
};

/* Freio por sessao nas rotas do cofre.
 *
 * O login ja tinha o dele. Faltava o resto: com uma sessao valida dava para
 * varrer a API a vontade, baixar tudo em minutos ou encher o banco. Nao e
 * defesa contra ataque distribuido, e teto de uso por sessao, que e o que
 * cabe num monolito e o que pega o caso real: script solto e automacao
 * descontrolada. Memoria, nao banco: reiniciar zerar o contador nao e
 * problema, e escrever no SQLite a cada request seria. */
const JANELA_MS = 60000;
const TETO_JANELA = Number(process.env.COFRE_TETO_MINUTO) || 240;
const usos = new Map();

function freio(sessao) {
  const agora = Date.now();
  const atual = usos.get(sessao.tokenHash);
  if (!atual || agora > atual.ate) {
    usos.set(sessao.tokenHash, { n: 1, ate: agora + JANELA_MS });
    /* Limpeza barata: sem isto o mapa cresce com toda sessao que ja morreu. */
    if (usos.size > 5000) {
      for (const [k, v] of usos) if (agora > v.ate) usos.delete(k);
    }
    return;
  }
  if (++atual.n > TETO_JANELA) {
    const e = new Error('Muitas chamadas seguidas. Espere um minuto.');
    e.status = 429;
    throw e;
  }
}

/* Freio por ORIGEM, alem do freio por sessao.
 *
 * O de sessao so pega quem ja entrou. Antes disso, /api/entrar e
 * /api/cadastrar ficavam sem teto por IP: o de login e por conta, entao
 * varrer mil contas diferentes de um IP so nao encostava em nenhum limite. */
const JANELA_IP_MS = 60000;
/* Alto de proposito, e mais alto que o teto por sessao.
 *
 * Um IP nao e uma pessoa: um escritorio inteiro atras de um NAT chega aqui
 * como uma origem so, e cada tela do cofre faz varias chamadas. Um teto
 * apertado nao para ataque nenhum e derruba equipe legitima, que e o pior
 * dos dois mundos. Isto e teto contra varredura, nao contra uso. */
const TETO_IP = Number(process.env.COFRE_TETO_IP) || 600;
const usosIp = new Map();

const ehLocal = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function freioDeOrigem(req) {
  const ip = contas.ipDe(req) || 'desconhecido';
  /* Mesma razao do portao e do token: quem chega por loopback ja esta na
   * maquina. Frear ali so atrapalha quem roda o Print local. */
  if (ehLocal(ip)) return;
  const agora = Date.now();
  const atual = usosIp.get(ip);
  if (!atual || agora > atual.ate) {
    usosIp.set(ip, { n: 1, ate: agora + JANELA_IP_MS });
    if (usosIp.size > 5000) {
      for (const [k, v] of usosIp) if (agora > v.ate) usosIp.delete(k);
    }
    return;
  }
  if (++atual.n > TETO_IP) {
    const e = new Error('Muitas chamadas desta origem. Espere um minuto.');
    e.status = 429;
    throw e;
  }
}

/* Entrada do cliente e sempre suspeita, ate provar o contrario.
 *
 * Nao e so tamanho: um campo que chega como objeto ou array, e nao como
 * texto, atravessa String() virando "[object Object]" e vira lixo gravado.
 * Aqui ele e recusado na porta. */
function texto(valor, campo, max, obrigatorio) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) {
      const e = new Error(campo + ' é obrigatório.');
      e.status = 400;
      throw e;
    }
    return null;
  }
  if (typeof valor !== 'string') {
    const e = new Error(campo + ': esperava texto.');
    e.status = 400;
    throw e;
  }
  const t = valor.trim();
  if (t.length > max) {
    const e = new Error(campo + ': acima de ' + max + ' caracteres.');
    e.status = 413;
    throw e;
  }
  return t;
}

function inteiro(valor, campo, min, max) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) {
    const e = new Error(campo + ': número fora do intervalo.');
    e.status = 400;
    throw e;
  }
  return Math.trunc(n);
}

/* A resposta leva o que a tela usa, e nada alem.
 *
 * tenant_id e criado_por sao identificadores internos: nao ajudam quem esta
 * do lado de fora e ajudam quem esta mapeando o sistema. */
const podarProjeto = p => ({
  id: p.id, nome: p.nome, cliente: p.cliente, criado_em: p.criado_em
});
const podarExecucao = x => ({
  id: x.id, projeto_id: x.projeto_id, titulo: x.titulo, iniciada_em: x.iniciada_em
});
const podarEvidencia = e => ({
  id: e.id, execucao_id: e.execucao_id, ordem: e.ordem, titulo: e.titulo, obs: e.obs,
  acao: e.acao, elemento: e.elemento, valor: e.valor, html: e.html,
  url_antes: e.url_antes, url_depois: e.url_depois,
  criada_em: e.criada_em, expira_em: e.expira_em, estado: e.estado
});

function exigirSessao(req) {
  const s = contas.sessaoDe(req);
  if (!s) {
    const e = new Error('Entre para continuar.');
    e.status = 401;
    throw e;
  }
  freio(s);
  return s;
}

/* data URL -> bytes, com o tipo validado contra a allowlist. O tipo declarado
 * pelo cliente não é confiança, é rótulo: por isso a allowlist e o teto. */
function bytesDe(dataUrl, papel) {
  if (!dataUrl) return null;
  const m = /^data:([\w.+/-]+);base64,([\s\S]+)$/.exec(String(dataUrl));
  if (!m) {
    const e = new Error(papel + ': formato inesperado, esperava data URL base64');
    e.status = 400;
    throw e;
  }
  const tipo = m[1].toLowerCase();
  if (!TIPOS_OK.has(tipo)) {
    const e = new Error(papel + ': tipo não aceito (' + tipo + ')');
    e.status = 415;
    throw e;
  }
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) {
    const e = new Error(papel + ': vazio');
    e.status = 400;
    throw e;
  }
  if (buf.length > MAX_OBJETO) {
    const e = new Error(papel + ': ' + (buf.length / 1048576).toFixed(1)
      + ' MB acima do limite de ' + (MAX_OBJETO / 1048576) + ' MB');
    e.status = 413;
    throw e;
  }
  return { tipo, buf };
}

function assinar(objetoId, tenantId, ate) {
  return crypto.createHmac('sha256', SEGREDO)
    .update([objetoId, tenantId, ate].join('|')).digest('base64url');
}

function assinaturaValida(objetoId, tenantId, ate, dada) {
  if (!objetoId || !tenantId || !ate || !dada) return false;
  if (Date.now() > Number(ate)) return false;
  const esperada = Buffer.from(assinar(objetoId, tenantId, Number(ate)));
  const recebida = Buffer.from(String(dada));
  if (esperada.length !== recebida.length) return false;
  return crypto.timingSafeEqual(esperada, recebida);
}

/** Devolve true quando tratou o pedido. */
async function tratar(req, res, u, lerCorpo) {
  const p = u.pathname;
  if (!p.startsWith('/api/')) return false;

  if (!banco.ligado()) {
    json(res, 503, {
      erro: 'Cofre desligado: ' + (banco.porque() || 'sem banco')
        + '. Defina COFRE_BANCO apontando para um volume.'
    });
    return true;
  }

  try {
    freioDeOrigem(req);

    /* ---------- sessão ---------- */

    if (p === '/api/entrar' && req.method === 'POST') {
      const c = await lerCorpo(req);
      const r = contas.entrar(req, c.email, c.senha, c.tenantId);
      json(res, 200, { ok: true, sessao: r.sessao }, { 'Set-Cookie': r.cookie });
      return true;
    }

    if (p === '/api/cadastrar' && req.method === 'POST') {
      const c = await lerCorpo(req);
      const r = contas.cadastrar(req, c);
      json(res, 201, { ok: true, sessao: r.sessao }, { 'Set-Cookie': r.cookie });
      return true;
    }

    /* O que a tela de entrada precisa saber antes de desenhar as abas. */
    if (p === '/api/cadastro') {
      json(res, 200, { aberto: contas.CADASTRO_ABERTO, senhaMinima: contas.SENHA_MINIMA });
      return true;
    }

    if (p === '/api/trocar-equipe' && req.method === 'POST') {
      const s = exigirSessao(req);
      const c = await lerCorpo(req);
      const r = contas.trocarEquipe(req, s, String(c.tenantId || ''));
      json(res, 200, { ok: true, sessao: r.sessao }, { 'Set-Cookie': r.cookie });
      return true;
    }

    /* ---------- convites ---------- */

    if (p === '/api/convites' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'gestor');
      const c = await lerCorpo(req);
      const papel = ['leitor', 'consultor', 'gestor', 'admin'].includes(c.papel) ? c.papel : 'consultor';
      /* Ninguem convida para um papel acima do seu: senao "gestor" seria so
       * o caminho mais longo para virar admin. */
      if (contas.PAPEIS[papel] > contas.PAPEIS[s.papel]) {
        json(res, 403, { erro: 'Você não pode convidar para um papel acima do seu.' });
        return true;
      }
      const codigo = contas.novoCodigo();
      banco.criarConvite(s.tenantId, s.usuarioId, papel, contas.hashToken(codigo), c.dias);
      banco.auditar(s.tenantId, s.usuarioId, 'convite.criado', 'papel ' + papel, s.ip);
      /* O codigo aparece uma vez. Depois disso so existe o hash. */
      json(res, 201, { codigo, papel });
      return true;
    }

    if (p === '/api/convites' && req.method === 'GET') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'gestor');
      const lista = banco.listarConvites(s.tenantId)
        .map(c => ({ papel: c.papel, criado_em: c.criado_em, expira_em: c.expira_em,
          usado_em: c.usado_em, usado_por_email: c.usado_por_email }));
      json(res, 200, { convites: lista });
      return true;
    }

    /* ---------- entrada por provedor de identidade ---------- */

    /* O endereco de retorno e montado a partir do host da requisicao, e nao
     * de algo que o cliente mande: aceitar redirect_uri do pedido e o furo
     * classico de OIDC, porque o codigo de autorizacao vai parar onde quem
     * pediu mandar. */
    const urlDeRetorno = () => {
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        || (req.socket.encrypted ? 'https' : 'http');
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0].trim();
      return proto + '://' + host + '/api/sso/retorno';
    };

    if (p === '/api/sso/inicio' && req.method === 'POST') {
      const c = await lerCorpo(req);
      const email = texto(c.email, 'E-mail', 200, true);
      const destino = /^\/($|[^\/\\])/.test(String(c.ir || '')) ? String(c.ir) : '/';
      const r = await sso.iniciar(email, urlDeRetorno(), destino);
      /* Dominio sem provedor nao e erro: e a tela sabendo que aquele e-mail
       * segue pelo caminho de senha. */
      json(res, 200, r ? { provedor: true, url: r.url } : { provedor: false });
      return true;
    }

    if (p === '/api/sso/retorno' && (req.method === 'GET' || req.method === 'POST')) {
      const erroProvedor = u.searchParams.get('error');
      if (erroProvedor) {
        res.writeHead(302, { Location: '/cofre.html?sso=' + encodeURIComponent(erroProvedor) });
        return void res.end();
      }
      try {
        const dados = await sso.concluir(
          u.searchParams.get('code'), u.searchParams.get('state'), urlDeRetorno());
        const r = contas.entrarPorProvedor(req, dados);
        res.writeHead(302, { Location: dados.destino || '/', 'Set-Cookie': r.cookie });
        return void res.end();
      } catch (err) {
        banco.auditar(null, null, 'login.provedor_falhou', String(err.message).slice(0, 120),
          contas.ipDe(req));
        res.writeHead(302, {
          Location: '/cofre.html?sso=' + encodeURIComponent(String(err.message).slice(0, 160))
        });
        return void res.end();
      }
    }

    if (p === '/api/sair' && req.method === 'POST') {
      json(res, 200, { ok: true }, { 'Set-Cookie': contas.sair(req) });
      return true;
    }

    if (p === '/api/eu') {
      const s = contas.sessaoDe(req);
      if (!s) { json(res, 200, { autenticado: false }); return true; }
      json(res, 200, {
        autenticado: true, email: s.email, papel: s.papel,
        tenantId: s.tenantId, tenantNome: s.tenantNome, retencaoDias: s.retencaoDias,
        via: s.via, provedorNome: s.provedorNome,
        equipes: banco.equipesAlcancaveis(s.usuarioId)
      });
      return true;
    }

    /* ---------- projetos ---------- */

    if (p === '/api/projetos' && req.method === 'GET') {
      const s = exigirSessao(req);
      json(res, 200, { projetos: banco.listarProjetos(s.tenantId).map(podarProjeto) });
      return true;
    }

    if (p === '/api/projetos' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'consultor');
      const c = await lerCorpo(req);
      const nome = texto(c.nome, 'Nome do projeto', 120, true);
      const cliente = texto(c.cliente, 'Cliente', 120, false);
      const proj = banco.criarProjeto(s.tenantId, s.usuarioId, nome, cliente);
      banco.auditar(s.tenantId, s.usuarioId, 'projeto.criado', proj.id, s.ip);
      json(res, 201, { projeto: podarProjeto(proj) });
      return true;
    }

    let m = /^\/api\/projetos\/([\w-]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'gestor');
      const r = banco.excluirProjeto(s.tenantId, m[1]);
      if (!r) { json(res, 404, { erro: 'projeto não encontrado' }); return true; }
      banco.auditar(s.tenantId, s.usuarioId, 'projeto.excluido',
        m[1] + ' (' + r.evidencias + ' evidência(s))', s.ip);
      json(res, 200, { ok: true, removido: r });
      return true;
    }

    /* ---------- execuções ---------- */

    if (p === '/api/execucoes' && req.method === 'GET') {
      const s = exigirSessao(req);
      const pid = texto(u.searchParams.get('projeto'), 'projeto', 64, false) || '';
      json(res, 200, { execucoes: banco.listarExecucoes(s.tenantId, pid).map(podarExecucao) });
      return true;
    }

    if (p === '/api/execucoes' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'consultor');
      const c = await lerCorpo(req);
      const projetoId = texto(c.projetoId, 'projetoId', 64, true);
      const titulo = texto(c.titulo, 'Título', 200, false);
      const x = banco.criarExecucao(s.tenantId, s.usuarioId, projetoId, titulo);
      banco.auditar(s.tenantId, s.usuarioId, 'execucao.criada', x.id, s.ip);
      json(res, 201, { execucao: podarExecucao(x) });
      return true;
    }

    /* ---------- evidências ---------- */

    if (p === '/api/evidencias' && req.method === 'GET') {
      const s = exigirSessao(req);
      const xid = texto(u.searchParams.get('execucao'), 'execucao', 64, false) || '';
      const lista = banco.listarEvidencias(s.tenantId, xid).map(podarEvidencia);
      banco.auditar(s.tenantId, s.usuarioId, 'evidencia.listada',
        xid + ' (' + lista.length + ')', s.ip);
      json(res, 200, { evidencias: lista });
      return true;
    }

    if (p === '/api/evidencias' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'consultor');
      const c = await lerCorpo(req);
      const antes = bytesDe(c.antes, 'antes');
      const depois = bytesDe(c.depois, 'depois');
      /* Campo a campo, com teto por campo. Nunca o corpo inteiro: passar o
       * objeto do cliente adiante e como um campo que ninguem previu vira
       * coluna gravada. */
      const ev = banco.criarEvidencia(s.tenantId, s.usuarioId,
        texto(c.execucaoId, 'execucaoId', 64, true), {
          ordem: inteiro(c.ordem, 'ordem', 0, 100000),
          titulo: texto(c.titulo, 'Título', 300, false),
          obs: texto(c.obs, 'Observação', 4000, false),
          acao: texto(c.acao, 'Ação', 60, false),
          elemento: texto(c.elemento, 'Elemento', 1000, false),
          valor: texto(c.valor, 'Valor', 500, false),
          html: texto(c.html, 'HTML', 4000, false),
          url_antes: texto(c.urlAntes, 'URL antes', 2000, false),
          url_depois: texto(c.urlDepois, 'URL depois', 2000, false)
        }, s.retencaoDias);
      if (antes) banco.anexar(s.tenantId, ev.id, 'antes', antes.tipo, antes.buf);
      if (depois) banco.anexar(s.tenantId, ev.id, 'depois', depois.tipo, depois.buf);
      banco.auditar(s.tenantId, s.usuarioId, 'evidencia.criada', ev.id, s.ip);
      json(res, 201, { evidencia: { id: ev.id, expira_em: ev.expira_em } });
      return true;
    }

    m = /^\/api\/evidencias\/([\w-]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const s = exigirSessao(req);
      const ev = banco.obterEvidencia(s.tenantId, m[1]);
      if (!ev) { json(res, 404, { erro: 'evidência não encontrada' }); return true; }
      banco.auditar(s.tenantId, s.usuarioId, 'evidencia.vista', m[1], s.ip);
      json(res, 200, {
        evidencia: podarEvidencia(ev),
        objetos: banco.objetosDe(s.tenantId, m[1])
          .map(o => ({ id: o.id, papel: o.papel, tipo: o.tipo, bytes: o.bytes }))
      });
      return true;
    }

    if (m && req.method === 'DELETE') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'gestor');
      const foi = banco.excluirEvidencia(s.tenantId, m[1]);
      if (!foi) { json(res, 404, { erro: 'evidência não encontrada' }); return true; }
      banco.auditar(s.tenantId, s.usuarioId, 'evidencia.excluida', m[1], s.ip);
      json(res, 200, { ok: true });
      return true;
    }

    /* ---------- objetos ---------- */

    /* Link autônomo, curto, para quando é preciso uma URL que se sustente
     * sozinha (um <img> num relatório, por exemplo). A assinatura amarra
     * objeto, cliente e validade: nenhum dos três é editável no endereço. */
    m = /^\/api\/objetos\/([\w-]+)\/link$/.exec(p);
    if (m && req.method === 'GET') {
      const s = exigirSessao(req);
      const o = banco.obterObjeto(s.tenantId, m[1]);
      if (!o) { json(res, 404, { erro: 'objeto não encontrado' }); return true; }
      const ate = Date.now() + LINK_VALE_MS;
      json(res, 200, {
        url: '/api/objetos/' + o.id + '?t=' + encodeURIComponent(s.tenantId)
          + '&ate=' + ate + '&a=' + assinar(o.id, s.tenantId, ate),
        expiraEm: ate
      });
      return true;
    }

    m = /^\/api\/objetos\/([\w-]+)$/.exec(p);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      const oid = m[1];
      const assinatura = u.searchParams.get('a');
      let tenantId = null;
      let quem = null;

      if (assinatura) {
        const tPedido = u.searchParams.get('t') || '';
        const ate = u.searchParams.get('ate') || '';
        if (!assinaturaValida(oid, tPedido, ate, assinatura)) {
          json(res, 403, { erro: 'link inválido ou expirado' });
          return true;
        }
        tenantId = tPedido;
      } else {
        const s = exigirSessao(req);
        tenantId = s.tenantId;
        quem = s;
      }

      const o = banco.obterObjeto(tenantId, oid);
      if (!o) { json(res, 404, { erro: 'objeto não encontrado' }); return true; }

      banco.auditar(tenantId, quem ? quem.usuarioId : null, 'objeto.baixado',
        oid + ' (' + o.papel + ')', contas.ipDe(req));

      const corpo = Buffer.from(o.dados);
      res.writeHead(200, {
        'Content-Type': o.tipo,
        'Content-Length': corpo.length,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline'
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      res.end(corpo);
      return true;
    }

    /* ---------- auditoria ---------- */

    if (p === '/api/auditoria' && req.method === 'GET') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'gestor');
      json(res, 200, { eventos: banco.listarAuditoria(s.tenantId, u.searchParams.get('limite')) });
      return true;
    }

    /* ---------- exclusão total do cliente ---------- */

    if (p === '/api/tenant/excluir-tudo' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'admin');
      const c = await lerCorpo(req);
      /* Confirmação pelo nome: é a operação que não tem volta, e um POST
       * disparado por engano não pode ser suficiente para executá-la. */
      if (String(c.confirmar || '').trim() !== s.tenantNome) {
        json(res, 400, { erro: 'para confirmar, envie o nome exato do cliente' });
        return true;
      }
      const conta = banco.excluirDadosDoTenant(s.tenantId);
      banco.auditar(s.tenantId, s.usuarioId, 'tenant.dados_excluidos', JSON.stringify(conta), s.ip);
      json(res, 200, { ok: true, removido: conta });
      return true;
    }

    json(res, 404, { erro: 'rota desconhecida no cofre' });
    return true;
  } catch (err) {
    const status = err.status || 500;
    if (status < 500) {
      /* 4xx e conversa com quem chamou: a mensagem existe para a pessoa
       * corrigir o que fez, entao vai inteira. */
      json(res, status, { erro: err.message });
      return true;
    }
    /* 5xx e falha nossa, e a mensagem dela carrega caminho de arquivo, nome
     * de tabela e texto de SQL. Isso ajuda quem esta mapeando o servidor e
     * nao ajuda em nada quem so queria usar o sistema.
     *
     * O detalhe fica no log, com um numero curto que a pessoa pode informar
     * ao suporte: assim da para achar a ocorrencia exata sem publicar nada. */
    const marca = crypto.randomBytes(4).toString('hex');
    console.log('cofre FALHOU [' + marca + '] ' + p + ': ' + (err && err.stack || err));
    json(res, status, { erro: 'Falha interna. Informe o código ' + marca + ' ao suporte.' });
    return true;
  }
}

module.exports = { tratar, assinar, assinaturaValida, bytesDe, texto, inteiro,
  MAX_OBJETO, LINK_VALE_MS, TETO_JANELA, TETO_IP };
