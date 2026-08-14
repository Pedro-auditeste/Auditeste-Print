/* Agente de cenários: Gherkin + mapeamento QA a partir das evidências do Audi Print.
 *
 * Padrão: API NVIDIA (OpenAI-compatible). Mora na ponte — a chave nunca vive
 * no HTML exportado ao cliente. Vídeo não sobe como vídeo: o Print amostra
 * quadros e manda data URLs.
 *
 *   AGENTE_API_KEY      chave NVIDIA (nvapi-...) ou OpenAI (sk-...)
 *   AGENTE_BASE_URL     padrão https://integrate.api.nvidia.com/v1
 *   AGENTE_MODELO       padrão meta/llama-3.2-11b-vision-instruct
 */
const BASE_URL = String(process.env.AGENTE_BASE_URL || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/$/, '');
const MODELO = String(process.env.AGENTE_MODELO || 'meta/llama-3.2-11b-vision-instruct').trim();
const MODELO_FALLBACK = String(process.env.AGENTE_MODELO_FALLBACK || 'meta/llama-3.2-11b-vision-instruct').trim();
const MAX_IMAGENS = /llama-3\.2-.*vision|integrate\.api\.nvidia/i.test(MODELO + BASE_URL)
  ? 0
  : (Number(process.env.AGENTE_MAX_IMAGENS) || 8);
const MAX_TOKENS = Number(process.env.AGENTE_MAX_TOKENS) || 2048;
const TIMEOUT_MS = Number(process.env.AGENTE_TIMEOUT_MS) || 20000;
const TIMEOUT_CENARIOS_MS = Math.max(90000, TIMEOUT_MS);

const SISTEMA = `Você gera a entrada da skill automacao-web-qa / SKILL-MAPEAMENTO-QA a partir dos PRINTS do Audi Print.

IDIOMA: somente português do Brasil. Proibido inglês (The image shows, Clicked, product listing, Before, After).
NUNCA recuse. NUNCA diga que não pode ajudar. Sempre gere os dois blocos.

Cada PRINT = 1 passo Gherkin + 1 bloco MAPEAMENTO, na mesma ordem das abas (use o título e a observação escritos).
Não invente cliques. Não inverta a ordem: print 1 é origem do clique, print 2 é o destino.
CEP ≠ CPF ≠ CNPJ. CEP = frete/região no topo. CPF/CNPJ = tela Identificação / Entre ou cadastre-se.
1 cenário cobrindo o fluxo. Variáveis entre aspas duplas.

GHERKIN:
- # language: pt
- # Feature / Steps / Page em snake_case
- Funcionalidade + Como / Quero / Para
- @smoke @regressivo
- Cenário: [Modulo][Funcionalidade] <nome> - <condicao>
- Dado / Quando / E / Então a partir de cada print

MAPEAMENTO (skill §2, um bloco por print):
Passo: N
Elemento Web: copie EXATO o seletor inspecionado do passo. Preferência: #id → [name=] → xpath //*[@id='...']. NUNCA invente id. Sem seletor: (a confirmar).
Ação: só Preencher | Clicar | Ler | Limpar | Verificar | Comparar | Acessar | Upload
Valor: se Preencher, Comparar ou Upload
Step: a frase Gherkin correspondente

Resposta: comece em ===GHERKIN===. Depois ===MAPEAMENTO===. Nada antes, nada depois, sem repetir ===GHERKIN=== no mapeamento.

Exemplo (print: clicou no card Smart TV Philco e abriu a PDP):
===GHERKIN===
# language: pt
# Feature: features/compras/compras.feature
# Steps: features/steps/compras/compras_steps.py
# Page: pages/compras/compras_page.py

Funcionalidade: Compras
  Como cliente
  Quero abrir o produto a partir da vitrine
  Para ver preço e comprar

  @smoke @regressivo
  Cenário: [Compras][Produto] Abrir página da Smart TV Philco - sucesso
    Quando eu clico no card "Smart TV 43' Philco"
    Então eu vejo o texto "R$ 1.449,90"
    E eu vejo o botão "Comprar"

===MAPEAMENTO===
Passo: 1
Elemento Web: #card-tv-philco
Ação: Clicar
Step: Quando eu clico no card "Smart TV 43' Philco"

Passo: 2
Elemento Web: #preco-produto
Ação: Verificar
Step: Então eu vejo o texto "R$ 1.449,90"

Passo: 3
Elemento Web: #btn-comprar
Ação: Verificar
Step: E eu vejo o botão "Comprar"
`;

function descreverFicha(ficha) {
  const rotulos = {
    registro: 'Registro nº', executor: 'Executado por', data: 'Data', modulo: 'Módulo',
    demanda: 'Demanda', versao: 'Versão', ambiente: 'Ambiente', tipo: 'Tipo de teste',
    resultado: 'Resultado', observacoes: 'Observações'
  };
  const linhas = Object.entries(rotulos)
    .map(([chave, rot]) => [rot, (ficha && ficha[chave] || '').trim()])
    .filter(([, valor]) => valor)
    .map(([rot, valor]) => `${rot}: ${valor}`);
  return 'Ficha de identificação da evidência (Audi Print):\n' + (linhas.join('\n') || '(não preenchida)');
}

function dataUrlValida(dataUrl) {
  return /^data:image\/(?:png|jpeg|webp);base64,.+/.test(dataUrl || '');
}

function blocoImagem(dataUrl) {
  return { type: 'image_url', image_url: { url: dataUrl } };
}

function montarConteudoUsuario({ ficha, passos, quadros }) {
  const partes = [{ type: 'text', text: descreverFicha(ficha) }];
  let imagens = 0;

  partes.push({
    type: 'text',
    text: 'PRINTS do Audi Print (1 bloco = 1 print / aba). Use título e observação de cada um:'
  });

  passos.forEach((p, i) => {
    const linhas = [`Print ${i + 1}: ${(p.titulo || '').trim() || '(sem título)'}`];
    if ((p.obs || '').trim()) linhas.push(`O que está na aba: ${p.obs.trim()}`);
    if ((p.acao || '').trim()) linhas.push(`Ação: ${p.acao.trim()}`);
    if ((p.elemento || '').trim()) linhas.push(`Elemento Web (inspecionado): ${p.elemento.trim()}`);
    if ((p.html || '').trim()) linhas.push(`HTML: ${p.html.trim().slice(0, 280)}`);
    if ((p.valor || '').trim()) linhas.push(`Valor: ${p.valor.trim()}`);
    partes.push({ type: 'text', text: linhas.join('\n') });

    for (const img of (p.imagens || [])) {
      if (imagens >= MAX_IMAGENS) break;
      if (!dataUrlValida(img)) continue;
      partes.push(blocoImagem(img));
      imagens++;
    }
  });

  if (Array.isArray(quadros) && quadros.length && imagens < MAX_IMAGENS) {
    partes.push({ type: 'text', text: 'Quadros do vídeo, em ordem:' });
    for (const q of quadros) {
      if (imagens >= MAX_IMAGENS) break;
      if (!dataUrlValida(q)) continue;
      partes.push(blocoImagem(q));
      imagens++;
    }
  }

  partes.push({
    type: 'text',
    text: 'Gere ===GHERKIN=== completo e em seguida ===MAPEAMENTO===. Um passo Gherkin e um bloco de mapeamento por print. Somente português.'
  });

  return { partes, imagens };
}

function pareceGherkin(t) {
  return /#\s*language\s*:\s*pt|^\s*Funcionalidade\s*:/im.test(t || '');
}

function pareceMapa(t) {
  return /Passo\s*:\s*\d+/i.test(t || '') && /A[cç][aã]o\s*:/i.test(t || '');
}

function extrairBlocos(texto) {
  const bruto = String(texto || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  if (!bruto) throw new Error('a resposta veio sem texto');

  const re = /=\s*=\s*=\s*(GHERKIN|MAPEAMENTO)\s*=\s*=\s*=/gi;
  const marks = [];
  let m;
  while ((m = re.exec(bruto))) marks.push({ tipo: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });

  const gherkins = [];
  const mapas = [];
  if (!marks.length) {
    const idxP = bruto.search(/Passo\s*:\s*1\b/i);
    if (pareceGherkin(bruto) && idxP > 0) {
      gherkins.push(bruto.slice(0, idxP).trim());
      mapas.push(bruto.slice(idxP).trim());
    }
  } else {
    for (let i = 0; i < marks.length; i++) {
      const corpo = bruto.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : bruto.length).trim();
      if (!corpo) continue;
      (marks[i].tipo === 'GHERKIN' ? gherkins : mapas).push(corpo);
    }
  }

  let cenarios = gherkins.find(pareceGherkin) || gherkins.sort((a, b) => b.length - a.length)[0] || '';
  let mapeamento = mapas.find(pareceMapa) || mapas.sort((a, b) => b.length - a.length)[0] || '';

  if (!pareceGherkin(cenarios) && mapeamento) {
    const idxG = mapeamento.search(/#\s*language\s*:\s*pt|Funcionalidade\s*:/i);
    const idxP = mapeamento.search(/Passo\s*:\s*1\b/i);
    if (idxG >= 0 && (idxP < 0 || idxG < idxP)) {
      cenarios = mapeamento.slice(idxG, idxP < 0 ? undefined : idxP).trim();
      if (idxP >= 0) mapeamento = mapeamento.slice(idxP).trim();
    }
  }

  mapeamento = mapeamento.replace(/=\s*=\s*=\s*GHERKIN\s*=\s*=\s*=[\s\S]*?(?=Passo\s*:\s*\d+)/i, '').trim();
  cenarios = cenarios.replace(/=\s*=\s*=\s*(GHERKIN|MAPEAMENTO)\s*=\s*=\s*=/gi, '').trim();
  mapeamento = mapeamento.replace(/=\s*=\s*=\s*(GHERKIN|MAPEAMENTO)\s*=\s*=\s*=/gi, '').trim();

  if (!pareceGherkin(cenarios) || cenarios.length < 50) {
    throw new Error('Gherkin inválido na resposta do agente');
  }
  if (!pareceMapa(mapeamento)) {
    throw new Error('mapeamento inválido na resposta do agente');
  }
  return { cenarios, mapeamento };
}

const ACOES_SKILL = ['Preencher', 'Clicar', 'Ler', 'Limpar', 'Verificar', 'Comparar', 'Acessar', 'Upload'];

function slugModulo(ficha) {
  const b = String((ficha && (ficha.modulo || ficha.demanda || ficha.tipo)) || 'fluxo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'fluxo';
  return b.slice(0, 40);
}

function inferirAcao(p) {
  const a = String(p.acao || '').trim();
  if (ACOES_SKILL.includes(a)) return a;
  const tit = p.titulo || '';
  const t = `${tit} ${p.obs || ''}`;
  if (/upload|anex|arquivo/i.test(t)) return 'Upload';
  if (/preencheu|digitou|pesquisou/i.test(t)) return 'Preencher';
  if (/limpou/i.test(t)) return 'Limpar';
  if (/compar/i.test(t)) return 'Comparar';
  if (/^acessou|^entrou na tela|^está na tela|^esta na tela/i.test(tit.trim())) return 'Acessar';
  if (/verific|então eu vejo|^entao eu vejo/i.test(tit) && !/clicou/i.test(tit)) return 'Verificar';
  if (/clicou|abriu|selecionou/i.test(t)) return 'Clicar';
  return 'Clicar';
}

function extrairAlvo(p) {
  const el = String(p.elemento || '').trim();
  if (el) return el;
  const t = p.titulo || '';
  const q = /["“”«»]([^"“”«»]+)["“”«»]/.exec(t);
  if (q) return q[1].trim();
  return t.replace(/^(Clicou|Digitou|Pesquisou|Abriu|Entrou|Preencheu|Acessou)\s+(em\s+|na\s+|no\s+)?/i, '').trim().slice(0, 90) || '(a confirmar)';
}

function linhaGherkin(acao, alvo, i, valor) {
  const primeiro = i === 0;
  if (acao === 'Acessar') return `    ${primeiro ? 'Dado que' : 'E'} eu acesso a tela "${alvo}"`;
  if (acao === 'Preencher') {
    const v = valor ? ` com "${valor}"` : '';
    return `    ${primeiro ? 'Quando' : 'E'} eu preencho o campo "${alvo}"${v}`;
  }
  if (acao === 'Verificar') return `    ${primeiro ? 'Então' : 'E'} eu vejo o texto "${alvo}"`;
  if (acao === 'Ler') return `    ${primeiro ? 'Quando' : 'E'} eu leio o texto "${alvo}"`;
  if (acao === 'Limpar') return `    ${primeiro ? 'Quando' : 'E'} eu limpo o campo "${alvo}"`;
  if (acao === 'Upload') return `    ${primeiro ? 'Quando' : 'E'} eu envio o arquivo "${valor || alvo}" no campo de anexo`;
  if (acao === 'Comparar') return `    ${primeiro ? 'Então' : 'E'} eu comparo o campo "${alvo}"${valor ? ` com "${valor}"` : ''}`;
  return `    ${primeiro ? 'Quando' : 'E'} eu clico em "${alvo}"`;
}

function montarCenariosDosPassos({ ficha, passos }) {
  const lista = (passos || []).filter((p) => (p.titulo || p.obs || p.acao || p.elemento));
  if (!lista.length) throw new Error('nenhum passo enviado');
  const mod = slugModulo(ficha);
  const nomeMod = String((ficha && ficha.modulo) || 'Fluxo').trim() || 'Fluxo';
  const primeiroAlvo = extrairAlvo(lista[0]);
  const linhasG = [
    '# language: pt',
    `# Feature: features/${mod}/${mod}.feature`,
    `# Steps: features/steps/${mod}/${mod}_steps.py`,
    `# Page: pages/${mod}/${mod}_page.py`,
    '',
    `Funcionalidade: ${nomeMod}`,
    '  Como cliente',
    '  Quero executar o fluxo registrado nos prints',
    '  Para validar a navegação',
    '',
    '  @smoke @regressivo',
    `  Cenário: [${nomeMod}][Fluxo] ${primeiroAlvo.slice(0, 60)} - sucesso`
  ];
  const linhasM = [];
  lista.forEach((p, i) => {
    const acao = inferirAcao(p);
    const alvo = extrairAlvo(p);
    const step = linhaGherkin(acao, alvo, i, (p.valor || '').trim()).trim();
    linhasG.push(step);
    linhasM.push(`Passo: ${i + 1}`);
    linhasM.push(`Elemento Web: ${alvo}`);
    linhasM.push(`Ação: ${acao}`);
    if ((p.valor || '').trim() && /Preencher|Comparar|Upload/.test(acao)) {
      linhasM.push(`Valor: ${p.valor.trim()}`);
    }
    linhasM.push(`Step: ${step.trim()}`);
    linhasM.push('');
  });
  const ultimoObs = String(lista[lista.length - 1].obs || '');
  const visto = /["“”]([^"“”]{3,80})["“”]/.exec(ultimoObs);
  if (visto && !linhasG.some((l) => l.includes(visto[1]))) {
    linhasG.push(`    Então eu vejo o texto "${visto[1]}"`);
  } else if (!/Então|Entao/i.test(linhasG.join('\n'))) {
    linhasG.push('    Então eu vejo a tela de destino do último print');
  }
  return {
    cenarios: linhasG.join('\n').trim(),
    mapeamento: linhasM.join('\n').trim()
  };
}

function exigirChave() {
  if ((process.env.AGENTE_API_KEY || '').trim()) return;
  const visiveis = Object.keys(process.env).filter(k => /^AGENTE_/i.test(k)).sort();
  const naNuvem = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID
    || (process.env.HOST && process.env.HOST !== '127.0.0.1' && process.env.HOST !== 'localhost'));
  const e = new Error(naNuvem
    ? ('Falta a 4ª variável AGENTE_API_KEY neste serviço. Já existem: '
      + (visiveis.join(', ') || '(nenhuma)')
      + '. No card do serviço audiprint → Variables → New → nome AGENTE_API_KEY, valor nvapi-... (Runtime) → Redeploy. Não use só BASE_URL/MODELO.')
    : 'AGENTE_API_KEY não está definida. Crie auditeste-a11y/.env (veja .env.example) ou chave.txt e reinicie a ponte.');
  e.semChave = true;
  throw e;
}

function tratarErroAgente(err) {
  const msg = (err && err.message) || String(err);
  const status = err && (err.status || err.statusCode);
  if (status === 401 || /invalid.?api.?key|authentication|incorrect.?api.?key|unauthorized/i.test(msg)) {
    const e = new Error('Chave do agente inválida ou sem permissão. Confira AGENTE_API_KEY.');
    e.semChave = true;
    throw e;
  }
  if (status === 404 || /model.?not.?found|does not exist|unknown.?model/i.test(msg)) {
    throw new Error('Modelo não disponível (' + MODELO + '). Defina AGENTE_MODELO com um modelo válido da sua conta NVIDIA.');
  }
  throw err;
}

function modelosTentativa() {
  const principal = MODELO;
  const fallback = MODELO_FALLBACK || 'meta/llama-3.2-11b-vision-instruct';
  if (/90b/i.test(principal)) {
    return [fallback, principal].filter((m, i, a) => m && a.indexOf(m) === i);
  }
  return [principal, fallback].filter((m, i, a) => m && a.indexOf(m) === i);
}

/** Chamada no formato oficial NVIDIA (chat/completions), sem SDK. */
async function chamarNvidia({ messages, maxTokens, temperature, timeoutMs }) {
  exigirChave();
  let ultimo = null;
  for (const model of modelosTentativa()) {
    try {
      const resp = await fetch(BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.AGENTE_API_KEY,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages,
          model,
          frequency_penalty: 0,
          max_tokens: maxTokens || 512,
          presence_penalty: 0,
          stream: false,
          temperature: temperature == null ? 0.2 : temperature,
          top_p: 1
        }),
        signal: AbortSignal.timeout(timeoutMs || TIMEOUT_MS)
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const bruto = (dados.error && (dados.error.message || dados.error)) || dados.erro || ('HTTP ' + resp.status);
        const err = new Error(typeof bruto === 'string' ? bruto : JSON.stringify(bruto));
        err.status = resp.status;
        throw err;
      }
      const choice = dados.choices && dados.choices[0];
      const texto = choice && choice.message && choice.message.content;
      if (!texto) throw new Error('a resposta veio sem texto');
      return {
        texto,
        model: dados.model || model,
        usage: dados.usage || {},
        finish_reason: choice.finish_reason
      };
    } catch (err) {
      ultimo = err;
      if (err.status === 401 || /invalid.?api.?key|unauthorized/i.test(err.message || '')) {
        tratarErroAgente(err);
      }
    }
  }
  tratarErroAgente(ultimo || new Error('falha na API NVIDIA'));
}

function eRecusaModelo(texto, finish) {
  if (finish === 'content_filter') return true;
  return /i\s*(can'?t|cannot)\s+(help|assist)|i'?m\s+not\s+able|as an ai|i am unable|sorry[,.]?\s+i\s+can'?t|não\s+posso\s+(ajudar|assistir|descrever)|n[aã]o\s+consigo\s+(ajudar|descrever)|unable to (help|assist|describe)/i.test(texto || '');
}

function cortarPalavra(t, max) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const sp = corte.lastIndexOf(' ');
  return (sp > 12 ? corte.slice(0, sp) : corte).replace(/[.,;:]+$/, '');
}

function encurtarObs(t, max) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const uma = s.match(/^[\s\S]{8,240}?[.!?…](?=\s|$)/);
  return cortarPalavra(uma ? uma[0] : s, max);
}

function parseDescricaoTela(texto) {
  const bruto = String(texto || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/\*\*/g, '')
    .trim();
  if (!bruto) throw new Error('a descrição veio vazia');
  if (eRecusaModelo(bruto)) throw new Error('recusa do modelo');
  const t = /(?:t[íi]tulo|a[cç][aã]o)\s*[:\-–]\s*(.+)/i.exec(bruto);
  const o = /observa[cç][aã]o\s*[:\-–]\s*([\s\S]+)/i.exec(bruto);
  const linhas = bruto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let titulo = cortarPalavra((t ? t[1] : linhas[0] || '').replace(/^["'#*\s]+|["'#*\s]+$/g, ''), 90);
  let obs = encurtarObs((o ? o[1] : linhas.slice(1).join(' ').trim() || titulo)
    .replace(/^["'#*\s]+|["'#*\s]+$/g, ''), 220);
  if (!titulo) throw new Error('não foi possível ler o título da tela');
  if (!obs) obs = titulo;
  return { titulo, obs };
}

const FALLBACK_PRINT = { titulo: 'Ação na tela', obs: 'O cliente avançou da tela anterior para a tela seguinte.' };

const PROMPT_ANTES = [
  'IMAGEM 1: tela ANTES. Descreva o que está escrito (logo, heading, produto, botão).',
  'Só diga "Clicou em ..." se o cursor estiver em cima do controle OU o rótulo for óbvio e único.',
  'Proibido inventar clique, menu, banner ou botão. Se não tiver certeza, NÃO use a palavra Clicou.',
  'Título: Tela "..." (heading/produto lido)  OU  Clicou em "..." (só se visível)',
  'Observação: 1 frase só sobre esta tela.'
].join('\n');

const PROMPT_DEPOIS = [
  'IMAGEM 2: tela DEPOIS (o que abriu). Descreva heading, produto, campos, botões lidos.',
  'Proibido inventar. Não adivinhe o que foi clicado na imagem 1.',
  'Título: Entrou em "..." (heading/produto desta imagem)',
  'Observação: 1 frase só sobre esta tela.'
].join('\n');

const PROMPT_UMA = [
  'Uma captura. Descreva a tela pelo texto visível. Não invente clique.',
  'Título: Acessou a tela "..."',
  'Observação: 1 frase com heading/produto/campos lidos.'
].join('\n');

function limparContexto(entrada) {
  const texto = (valor, max) => String(valor || '').replace(/\s+/g, ' ').trim().slice(0, max);
  return {
    elemento: texto(entrada && entrada.elemento, 300),
    rotulo: texto(entrada && entrada.rotulo, 120),
    urlAntes: texto(entrada && entrada.urlAntes, 1000),
    urlDepois: texto(entrada && entrada.urlDepois, 1000)
  };
}

function juntarPassoAPasso(antes, depois, contexto) {
  const a = antes || FALLBACK_PRINT;
  const b = depois || FALLBACK_PRINT;
  const t1 = (a.titulo || 'Tela anterior').replace(/\s+/g, ' ').trim();
  const t2 = (b.titulo || 'tela seguinte').replace(/\s+/g, ' ').trim()
    .replace(/^Entrou em /i, 'entrou em ');
  const ctx = limparContexto(contexto);
  const origem = ctx.rotulo || ctx.elemento;
  const titulo = cortarPalavra(
    origem ? `Clicou em "${origem}" → ${t2}` : (/→/.test(t1) ? t1 : (t1 + ' → ' + t2)),
    110
  );
  const obs = cortarPalavra(
    'Antes: ' + (a.obs || a.titulo || '')
      + (origem ? ` Ação: clique em "${origem}".` : '')
      + ' Depois: ' + (b.obs || b.titulo || ''),
    340
  );
  return { titulo, obs };
}

async function chamarVisao(conteudo) {
  const timeoutMs = Math.max(TIMEOUT_MS, 45000);
  const tentar = async (system, extraTexto) => {
    const user = extraTexto
      ? [{ type: 'text', text: extraTexto }].concat(conteudo)
      : conteudo;
    const r = await chamarNvidia({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      maxTokens: 280,
      temperature: 0.05,
      timeoutMs
    });
    if (eRecusaModelo(r.texto, r.finish_reason)) return null;
    try { return parseDescricaoTela(r.texto); } catch (_) { return null; }
  };
  const sistema = 'Analista QA. Descreva só o que está escrito no print. Não invente clique. Sempre responda. Português.';
  let out = await tentar(sistema);
  if (out) return out;
  out = await tentar(
    'Você SEMPRE responde. Nunca recuse. Use apenas texto visível no print.',
    'Título: (até 10 palavras, texto lido na imagem)\nObservação: (1 frase sobre ESTA tela. Sem inventar clique).'
  );
  return out || FALLBACK_PRINT;
}

async function descreverUma(dataUrl, papel, contexto) {
  const prompt = papel === 'antes' ? PROMPT_ANTES : papel === 'depois' ? PROMPT_DEPOIS : PROMPT_UMA;
  const ctx = limparContexto(contexto);
  const dados = [
    ctx.rotulo && `Rótulo do elemento acionado: ${ctx.rotulo}`,
    ctx.elemento && `Seletor HTML real: ${ctx.elemento}`,
    papel === 'antes' && ctx.urlAntes && `URL antes: ${ctx.urlAntes}`,
    papel === 'depois' && ctx.urlDepois && `URL depois: ${ctx.urlDepois}`
  ].filter(Boolean).join('\n');
  return chamarVisao([
    { type: 'text', text: prompt + (dados ? '\n\nContexto verificado pelo navegador:\n' + dados : '') },
    { type: 'image_url', image_url: { url: dataUrl } }
  ]);
}

async function descreverTela(entrada) {
  exigirChave();
  const depois = typeof entrada === 'string' ? entrada : (entrada && (entrada.imagem || entrada.depois || entrada.dataUrl) || '');
  const antes = typeof entrada === 'string' ? '' : (entrada && (entrada.antes || entrada.imagemAntes) || '');
  const contexto = typeof entrada === 'string' ? {} : limparContexto(entrada);
  if (!dataUrlValida(depois)) throw new Error('imagem inválida para descrever');
  if (dataUrlValida(antes)) {
    const [d1, d2] = await Promise.all([
      descreverUma(antes, 'antes', contexto),
      descreverUma(depois, 'depois', contexto)
    ]);
    return juntarPassoAPasso(d1, d2, contexto);
  }
  return descreverUma(depois, 'unica', contexto);
}

async function gerarCenarios({ ficha, passos, quadros }) {
  exigirChave();
  if (!Array.isArray(passos) || !passos.length) throw new Error('nenhum passo enviado');

  const local = montarCenariosDosPassos({ ficha, passos });
  const { partes, imagens } = montarConteudoUsuario({ ficha, passos, quadros });
  let r;
  try {
    r = await chamarNvidia({
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: partes }
      ],
      maxTokens: Math.min(MAX_TOKENS, 2048),
      temperature: 0.15,
      timeoutMs: TIMEOUT_CENARIOS_MS
    });
  } catch (err) {
    if (err && err.semChave) throw err;
    return {
      cenarios: local.cenarios,
      mapeamento: local.mapeamento,
      modelo: 'montado dos prints (IA indisponível)',
      imagens: 0,
      uso: { entrada: 0, saida: 0 }
    };
  }

  if (r.finish_reason === 'content_filter' || eRecusaModelo(r.texto, r.finish_reason)) {
    return {
      cenarios: local.cenarios,
      mapeamento: local.mapeamento,
      modelo: 'montado dos prints',
      imagens: 0,
      uso: { entrada: 0, saida: 0 }
    };
  }

  try {
    const parsed = extrairBlocos(r.texto);
    return {
      cenarios: parsed.cenarios,
      mapeamento: parsed.mapeamento,
      modelo: r.model || MODELO,
      imagens,
      uso: {
        entrada: (r.usage && r.usage.prompt_tokens) || 0,
        saida: (r.usage && r.usage.completion_tokens) || 0
      }
    };
  } catch (_) {
    return {
      cenarios: local.cenarios,
      mapeamento: local.mapeamento,
      modelo: (r.model || MODELO) + ' + montado dos prints',
      imagens,
      uso: {
        entrada: (r.usage && r.usage.prompt_tokens) || 0,
        saida: (r.usage && r.usage.completion_tokens) || 0
      }
    };
  }
}

module.exports = {
  gerarCenarios,
  descreverTela,
  parseDescricaoTela,
  juntarPassoAPasso,
  montarCenariosDosPassos,
  MODELO,
  BASE_URL,
  extrairBlocos
};
