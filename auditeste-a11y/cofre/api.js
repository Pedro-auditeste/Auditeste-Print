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

function exigirSessao(req) {
  const s = contas.sessaoDe(req);
  if (!s) {
    const e = new Error('Entre para continuar.');
    e.status = 401;
    throw e;
  }
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
    /* ---------- sessão ---------- */

    if (p === '/api/entrar' && req.method === 'POST') {
      const c = await lerCorpo(req);
      const r = contas.entrar(req, c.email, c.senha, c.tenantId);
      json(res, 200, { ok: true, sessao: r.sessao }, { 'Set-Cookie': r.cookie });
      return true;
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
        tenantId: s.tenantId, tenantNome: s.tenantNome, retencaoDias: s.retencaoDias
      });
      return true;
    }

    /* ---------- projetos ---------- */

    if (p === '/api/projetos' && req.method === 'GET') {
      const s = exigirSessao(req);
      json(res, 200, { projetos: banco.listarProjetos(s.tenantId) });
      return true;
    }

    if (p === '/api/projetos' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'consultor');
      const c = await lerCorpo(req);
      if (!String(c.nome || '').trim()) { json(res, 400, { erro: 'nome do projeto é obrigatório' }); return true; }
      const proj = banco.criarProjeto(s.tenantId, s.usuarioId, c.nome, c.cliente);
      banco.auditar(s.tenantId, s.usuarioId, 'projeto.criado', proj.id, s.ip);
      json(res, 201, { projeto: proj });
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
      const pid = u.searchParams.get('projeto') || '';
      json(res, 200, { execucoes: banco.listarExecucoes(s.tenantId, pid) });
      return true;
    }

    if (p === '/api/execucoes' && req.method === 'POST') {
      const s = exigirSessao(req);
      contas.podeOuErro(s, 'consultor');
      const c = await lerCorpo(req);
      const x = banco.criarExecucao(s.tenantId, s.usuarioId, c.projetoId, c.titulo);
      banco.auditar(s.tenantId, s.usuarioId, 'execucao.criada', x.id, s.ip);
      json(res, 201, { execucao: x });
      return true;
    }

    /* ---------- evidências ---------- */

    if (p === '/api/evidencias' && req.method === 'GET') {
      const s = exigirSessao(req);
      const xid = u.searchParams.get('execucao') || '';
      const lista = banco.listarEvidencias(s.tenantId, xid);
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
      const ev = banco.criarEvidencia(s.tenantId, s.usuarioId, c.execucaoId, {
        ordem: c.ordem,
        titulo: c.titulo, obs: c.obs, acao: c.acao, elemento: c.elemento,
        valor: c.valor, html: c.html, url_antes: c.urlAntes, url_depois: c.urlDepois
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
      delete ev.tenant_id;
      banco.auditar(s.tenantId, s.usuarioId, 'evidencia.vista', m[1], s.ip);
      json(res, 200, { evidencia: ev, objetos: banco.objetosDe(s.tenantId, m[1]) });
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
    if (status >= 500) console.log('cofre FALHOU ' + p + ': ' + err.message);
    json(res, status, { erro: err.message });
    return true;
  }
}

module.exports = { tratar, assinar, assinaturaValida, bytesDe, MAX_OBJETO, LINK_VALE_MS };
