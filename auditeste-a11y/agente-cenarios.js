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
const MAX_IMAGENS = Number(process.env.AGENTE_MAX_IMAGENS) || 20;
const MAX_TOKENS = Number(process.env.AGENTE_MAX_TOKENS) || 4096;
const TIMEOUT_MS = Number(process.env.AGENTE_TIMEOUT_MS) || 20000;

const SISTEMA = `Você é o agente de automação web QA da Auditeste (skill automacao-web-qa / SKILL-MAPEAMENTO-QA).
A partir das evidências do Audi Print você produz a ENTRADA padronizada para gerar feature Behave, steps e Page Object.

Contexto do Audi Print:
- Cada passo é evidência (ação + observação + captura). Campos opcionais: acao, elemento, valor.
- Acessibilidade: gravidade Grave/Importante/Moderado/Leve. "Verificação automática"=axe; "Segunda opinião"=Pa11y; "Nota"=Lighthouse.

Regras gerais:
- Só o que as evidências mostram. Não invente telas, campos, mensagens, URLs ou seletores.
- Poucos cenários corretos. 1 intenção por cenário.
- Credenciais/URLs concretas só se aparecerem nas evidências; senão use aspas com placeholder e "# A confirmar".
- Se o resultado da ficha for Reprovado/Bloqueado, priorize o defeito observado.

GHERKIN (padrão automacao-web-qa):
- Cabeçalho obrigatório: # language: pt
- Comentário com artefatos sugeridos em snake_case: Feature, Steps e Page (ex. features/login/login.feature, features/steps/login/login_steps.py, pages/login/login_page.py).
- Funcionalidade: + Como / Quero / Para quando der para inferir.
- Tags: @smoke @regressivo e tags de domínio (@login, @ui, etc.).
- Nome do Cenário EXATO: [Módulo][Funcionalidade] <Cenário> - <Condição>
- Passos em português, indentados. Variáveis SEMPRE entre aspas duplas, no estilo:
  Dado que eu acesso a URL "https://..."
  Quando eu preencho o campo "E-mail" com "qa@teste.com"
  E eu clico em "Entrar"
  Então eu vejo o texto "Maria Santos"
- Comparar: explícito, ex. "igual ao inserido no Passo 4" / "igual ao CPF informado no passo anterior".
- Upload: Quando eu envio o arquivo "documento_teste.pdf" no campo de anexo
- Acessibilidade: cenário separado citando o problema em linguagem clara.

MAPEAMENTO (entrada da skill §2 — um bloco por passo de automação, na ordem):
- Passo: N
- Elemento Web: XPath, ID, seletor CSS, rótulo do componente ou URL. Sem evidência: "(a confirmar)"
- Ação: SOMENTE Preencher | Clicar | Ler | Limpar | Verificar | Comparar | Acessar | Upload
- Valor: obrigatório para Preencher, Comparar e Upload
- Relacionar ao Gherkin: linha "Step: ..." com a frase Dado/Quando/Então correspondente
- Upload: incluir "Diretório: features/data/..." quando houver arquivo

Formato obrigatório da resposta (somente estes dois blocos, sem prosa nem markdown extra):

===GHERKIN===
# language: pt
# Feature: features/<modulo>/<nome>.feature
# Steps: features/steps/<modulo>/<nome>_steps.py
# Page: pages/<modulo>/<nome>_page.py

Funcionalidade: <Nome do fluxo>
  Como <persona>
  Quero <acao>
  Para <beneficio>

  @smoke @regressivo
  Cenário: [Modulo][Funcionalidade] <Cenario> - <Condicao>
    Dado que eu ...
    Quando eu ...
    Então eu ...

===MAPEAMENTO===
Passo: 1
Elemento Web: ...
Ação: Acessar
Step: Dado que eu acesso a URL "..."

Passo: 2
Elemento Web: ...
Ação: Preencher
Valor: ...
Step: Quando eu preencho o campo "..." com "..."
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
  const partes = [
    { type: 'text', text: SISTEMA },
    { type: 'text', text: descreverFicha(ficha) }
  ];
  let imagens = 0;

  passos.forEach((p, i) => {
    const linhas = [`Passo ${i + 1}: ${(p.titulo || '').trim() || '(sem descrição)'}`];
    if ((p.obs || '').trim()) linhas.push(`Observação: ${p.obs.trim()}`);
    if ((p.acao || '').trim()) linhas.push(`Ação sugerida: ${p.acao.trim()}`);
    if ((p.elemento || '').trim()) linhas.push(`Elemento Web: ${p.elemento.trim()}`);
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
    partes.push({ type: 'text', text: 'Quadros amostrados do vídeo da sessão, em ordem cronológica:' });
    for (const q of quadros) {
      if (imagens >= MAX_IMAGENS) break;
      if (!dataUrlValida(q)) continue;
      partes.push(blocoImagem(q));
      imagens++;
    }
  }

  partes.push({
    type: 'text',
    text: 'Gere agora a entrada da skill automacao-web-qa no formato ===GHERKIN=== e ===MAPEAMENTO===. Nome do cenário no padrão [Módulo][Funcionalidade] <Cenário> - <Condição>. Aspas duplas nas variáveis. Ações só do enum da skill.'
  });

  return { partes, imagens };
}

function extrairBlocos(texto) {
  const bruto = (texto || '').trim();
  if (!bruto) throw new Error('a resposta veio sem texto');

  const reG = /===GHERKIN===\s*([\s\S]*?)(?====MAPEAMENTO===|$)/i;
  const reM = /===MAPEAMENTO===\s*([\s\S]*?)$/i;
  const g = reG.exec(bruto);
  const m = reM.exec(bruto);

  if (!g || !m) {
    throw new Error(
      'Resposta do agente sem delimitadores ===GHERKIN=== / ===MAPEAMENTO===. '
      + 'Tente de novo ou revise o modelo em AGENTE_MODELO.'
    );
  }

  const cenarios = g[1].trim();
  const mapeamento = m[1].trim();
  if (!cenarios) throw new Error('bloco Gherkin vazio na resposta do agente');
  if (!mapeamento) throw new Error('bloco mapeamento vazio na resposta do agente');

  return { cenarios, mapeamento };
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
async function chamarNvidia({ messages, maxTokens, temperature }) {
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
        signal: AbortSignal.timeout(TIMEOUT_MS)
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

function parseDescricaoTela(texto) {
  const bruto = String(texto || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/\*\*/g, '')
    .trim();
  if (!bruto) throw new Error('a descrição veio vazia');
  const t = /(?:t[íi]tulo|a[cç][aã]o)\s*[:\-–]\s*(.+)/i.exec(bruto);
  const o = /observa[cç][aã]o\s*[:\-–]\s*([\s\S]+)/i.exec(bruto);
  const linhas = bruto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let titulo = (t ? t[1] : linhas[0] || '').replace(/^["'#*\s]+|["'#*\s]+$/g, '').slice(0, 160);
  let obs = (o ? o[1] : linhas.slice(1).join(' ').trim() || titulo)
    .replace(/^["'#*\s]+|["'#*\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  if (!titulo) throw new Error('não foi possível ler o título da tela');
  if (!obs) obs = titulo;
  return { titulo, obs };
}

async function chamarVisao(conteudo) {
  const r = await chamarNvidia({
    messages: [{ role: 'user', content: conteudo }],
    maxTokens: 180,
    temperature: 0.1
  });
  return parseDescricaoTela(r.texto);
}

async function descreverTela(entrada) {
  exigirChave();
  const depois = typeof entrada === 'string' ? entrada : (entrada && (entrada.imagem || entrada.depois || entrada.dataUrl) || '');
  const antes = typeof entrada === 'string' ? '' : (entrada && (entrada.antes || entrada.imagemAntes) || '');
  if (!dataUrlValida(depois)) throw new Error('imagem inválida para descrever');
  const promptPar = [
    'Você é analista QA escrevendo o PASSO do cenário de teste, em português do Brasil.',
    'Há DUAS capturas: Imagem 1 = TELA A (antes da ação); Imagem 2 = TELA B (depois da ação).',
    'Descreva o que o USUÁRIO FEZ para ir da tela A para a tela B.',
    'Título: uma linha, verbo + alvo entre aspas. Verbos: Clicou, Digitou, Pesquisou, Abriu, Entrou, Preencheu.',
    'Observação: 1 ou 2 frases no formato: O usuário estava na tela "...". Clicou em "..." / preencheu "...". Entrou na tela/área "...".',
    'Proibido: inventariar a tela, listar links, menus, URLs, HTML, CSS, produtos patrocinados, layout, cores.',
    'Se o rótulo do botão/campo não estiver claro, use o texto visível mais próximo (ex. "Entrar", "Buscar", nome do card).',
    'Sem introdução, sem markdown, sem bullet.',
    'Formato exato:',
    'Título: Clicou em "Entrar"',
    'Observação: O usuário estava na tela de login. Clicou em "Entrar" e acessou a área logada / dashboard.'
  ].join('\n');
  const promptUma = [
    'Você é analista QA. Há UMA captura (tela atual, início ou print único).',
    'Diga em qual TELA o usuário está. Não inventarie links nem layout.',
    'Título: Acessou a tela "...".',
    'Observação: O usuário entrou na tela "...". Ainda não houve clique nesta captura.',
    'Sem introdução, sem markdown.',
    'Formato exato:',
    'Título: Acessou a tela "Login"',
    'Observação: O usuário está na tela inicial de login, pronto para clicar em "Entrar" ou preencher os campos.'
  ].join('\n');
  const par = dataUrlValida(antes)
    ? [
      { type: 'text', text: promptPar },
      { type: 'text', text: 'Imagem 1 — ANTES (tela em que o cliente agiu):' },
      { type: 'image_url', image_url: { url: antes } },
      { type: 'text', text: 'Imagem 2 — DEPOIS (tela após a mudança):' },
      { type: 'image_url', image_url: { url: depois } }
    ]
    : null;
  const uma = [
    { type: 'text', text: promptUma },
    { type: 'image_url', image_url: { url: depois } }
  ];
  if (par) {
    try {
      return await chamarVisao(par);
    } catch (_) {
      return chamarVisao(uma);
    }
  }
  return chamarVisao(uma);
}

async function gerarCenarios({ ficha, passos, quadros }) {
  exigirChave();
  if (!Array.isArray(passos) || !passos.length) throw new Error('nenhum passo enviado');

  const { partes, imagens } = montarConteudoUsuario({ ficha, passos, quadros });
  const r = await chamarNvidia({
    messages: [{ role: 'user', content: partes }],
    maxTokens: MAX_TOKENS,
    temperature: 0.2
  });

  if (r.finish_reason === 'content_filter') {
    const e = new Error('O modelo recusou gerar a partir dessas evidências (filtro de conteúdo).');
    e.recusa = true;
    throw e;
  }

  const { cenarios, mapeamento } = extrairBlocos(r.texto);

  return {
    cenarios,
    mapeamento,
    modelo: r.model || MODELO,
    imagens,
    uso: {
      entrada: (r.usage && r.usage.prompt_tokens) || 0,
      saida: (r.usage && r.usage.completion_tokens) || 0
    }
  };
}

module.exports = { gerarCenarios, descreverTela, parseDescricaoTela, MODELO, BASE_URL, extrairBlocos };
