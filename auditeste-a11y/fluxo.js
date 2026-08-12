/* Percorre um fluxo autenticado e escaneia acessibilidade em cada parada.
 *
 * É isto que a extensão não faz: aqui o percurso é escrito uma vez e roda
 * sozinho a cada release. Um JSON por parada, todos importáveis no Print.
 *
 *   BASE=https://sistema.cliente.com A11Y_USUARIO=... A11Y_SENHA=... npm run fluxo
 *
 * Senha vai por variável de ambiente de propósito — não escreva credencial
 * neste arquivo, ele mora no git.
 */
const { chromium } = require('playwright');
const mod = require('@axe-core/playwright');
const AxeBuilder = mod.default || mod.AxeBuilder || mod;
const path = require('path');
const { gravar, nomeArquivo } = require('./a11y.js');

const BASE = process.env.BASE || 'http://localhost:8777/print.html';
const USUARIO = process.env.A11Y_USUARIO;
const SENHA = process.env.A11Y_SENHA;
const VISIVEL = process.env.VISIVEL === '1';

/* ---- 1. login: descomente e ajuste os seletores do seu sistema ---- */
async function entrar(pagina) {
  if (!USUARIO || !SENHA) {
    console.log('sem A11Y_USUARIO/A11Y_SENHA definidos, seguindo sem login');
    return;
  }
  // await pagina.fill('#email', USUARIO);
  // await pagina.fill('#senha', SENHA);
  // await pagina.click('button[type="submit"]');
  // await pagina.waitForURL('**/home');
  console.log('bloco de login está comentado — ajuste os seletores em fluxo.js');
}

/* ---- 2. paradas: cada uma é um estado que você quer avaliar ---- */
const PARADAS = [
  {
    nome: 'inicio',
    chegar: async () => {}
  },
  {
    nome: 'lista-de-projetos',
    chegar: async (pagina) => {
      await pagina.click('#entrarSite');
      await pagina.waitForTimeout(1200);
    }
  },
  {
    nome: 'modal-novo-projeto',
    chegar: async (pagina) => {
      await pagina.click('[data-acao="novoProjeto"]');
      await pagina.waitForTimeout(500);
    }
  }
];

async function principal() {
  const navegador = await chromium.launch({ headless: !VISIVEL });
  const contexto = await navegador.newContext();
  const pagina = await contexto.newPage();
  let total = 0;

  try {
    await pagina.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await entrar(pagina);

    for (const parada of PARADAS) {
      await parada.chegar(pagina);
      /* deixa a tela assentar: em SPA o axe mede o esqueleto se medir cedo */
      await pagina.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const r = await new AxeBuilder({ page: pagina }).analyze();
      const n = r.violations.reduce((a, v) => a + v.nodes.length, 0);
      total += n;
      const arq = gravar(nomeArquivo(`fluxo-${parada.nome}`, BASE), {
        url: pagina.url(), parada: parada.nome,
        gerado: new Date().toISOString(), violations: r.violations
      });
      console.log(`${parada.nome.padEnd(22)} ${r.violations.length} regra(s), ${n} elemento(s)  ->  saida/${path.basename(arq)}`);
    }

    console.log(`\n${PARADAS.length} parada(s), ${total} elemento(s) com violação no total.`);
  } finally {
    await navegador.close();
  }
}

principal().catch(err => { console.error('falhou:', err.message); process.exit(1); });
