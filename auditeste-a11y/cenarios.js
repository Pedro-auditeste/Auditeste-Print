/* Gera cenários de teste em Gherkin a partir das evidências do Audi Print.
 *
 * Mora na ponte, não no Print: a chave de API não pode viver num HTML que é
 * exportado e entregue ao cliente.
 *
 * Vídeo não é enviado como vídeo — a API recebe imagem. O Print amostra
 * quadros do webm no navegador e manda os quadros.
 */
const MODELO = process.env.CENARIOS_MODELO || 'claude-sonnet-4-6';
const MAX_IMAGENS = Number(process.env.CENARIOS_MAX_IMAGENS) || 20;

const SISTEMA = `Você é analista de testes sênior da Auditeste. A partir das evidências capturadas no Audi Print — ficha de identificação, passos anotados, capturas de tela, quadros de vídeo e achados de acessibilidade (axe-core, Pa11y, Lighthouse) — você escreve cenários de teste em Gherkin, em português do Brasil.

Contexto do Audi Print:
- Cada "passo" é uma evidência de execução (ação + observação + captura).
- Passos de acessibilidade vêm com gravidade (Grave, Importante, Moderado, Leve) e referência técnica da regra.
- Blocos "Verificação automática" = axe-core; "Segunda opinião" = Pa11y; "Nota de acessibilidade" = Lighthouse.

Regras:
- Descreva apenas o que as evidências mostram. Não invente telas, campos, mensagens ou dados que não aparecem nas imagens ou nas anotações.
- Um Cenário por comportamento verificável. Poucos cenários corretos valem mais que muitos especulativos.
- Escreva os passos no nível do que a pessoa faz e vê (Quando/Então), não em detalhe de implementação.
- Use os dados concretos das evidências (valores digitados, mensagens, rótulos de botão, URLs).
- Para achados de acessibilidade: gere cenários de acessibilidade citando o problema em linguagem clara e, se houver, a regra/técnica.
- Se o resultado da ficha for Reprovado/Bloqueado, priorize cenários que reproduzam o defeito observado.
- Quando a evidência for insuficiente, não invente: registre a dúvida em uma seção "# A confirmar" no final.

Formato da resposta: apenas o Gherkin, começando por "Funcionalidade:". Sem introdução, sem markdown fora do Gherkin, sem comentário sobre o que você fez.`;

function blocoImagem(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl || '');
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

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

function extrairTexto(r) {
  return (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function chamarClaude(cliente, conteudo) {
  try {
    return await cliente.messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: SISTEMA,
      messages: [{ role: 'user', content: conteudo }]
    });
  } catch (err) {
    if (!cliente.beta || !cliente.beta.messages) throw err;
    return cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: SISTEMA,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: conteudo }]
    });
  }
}

async function gerarCenarios({ ficha, passos, quadros }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error(
      'ANTHROPIC_API_KEY não está definida na ponte. '
      + 'Crie auditeste-a11y/.env com a chave (veja .env.example) ou defina a variável na Railway, depois reinicie a ponte.'
    );
    e.semChave = true;
    throw e;
  }
  if (!Array.isArray(passos) || !passos.length) throw new Error('nenhum passo enviado');

  const Anthropic = require('@anthropic-ai/sdk');
  const cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const conteudo = [{ type: 'text', text: descreverFicha(ficha) }];
  let imagens = 0;

  passos.forEach((p, i) => {
    const partes = [`Passo ${i + 1}: ${(p.titulo || '').trim() || '(sem descrição)'}`];
    if ((p.obs || '').trim()) partes.push(`Observação: ${p.obs.trim()}`);
    conteudo.push({ type: 'text', text: partes.join('\n') });
    for (const img of (p.imagens || [])) {
      if (imagens >= MAX_IMAGENS) break;
      const bloco = blocoImagem(img);
      if (bloco) { conteudo.push(bloco); imagens++; }
    }
  });

  if (Array.isArray(quadros) && quadros.length && imagens < MAX_IMAGENS) {
    conteudo.push({ type: 'text', text: 'Quadros amostrados do vídeo da sessão, em ordem cronológica:' });
    for (const q of quadros) {
      if (imagens >= MAX_IMAGENS) break;
      const bloco = blocoImagem(q);
      if (bloco) { conteudo.push(bloco); imagens++; }
    }
  }

  conteudo.push({
    type: 'text',
    text: 'Com base nessas evidências do Audi Print, escreva agora os cenários de teste em Gherkin (Funcionalidade / Cenário / Dado / Quando / Então).'
  });

  let r;
  try {
    r = await chamarClaude(cliente, conteudo);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/invalid.?api.?key|authentication|401/i.test(msg)) {
      const e = new Error('Chave Anthropic inválida ou sem permissão. Confira ANTHROPIC_API_KEY.');
      e.semChave = true;
      throw e;
    }
    if (/not.?found|model/i.test(msg)) {
      throw new Error('Modelo não disponível (' + MODELO + '). Defina CENARIOS_MODELO com um modelo válido da sua conta.');
    }
    throw err;
  }

  if (r.stop_reason === 'refusal') {
    const cat = r.stop_details && r.stop_details.category;
    const e = new Error('O modelo recusou gerar a partir dessas evidências' + (cat ? ` (${cat})` : '') + '.');
    e.recusa = true;
    throw e;
  }

  const texto = extrairTexto(r);
  if (!texto) throw new Error('a resposta veio sem texto');

  return {
    cenarios: texto,
    modelo: r.model || MODELO,
    imagens,
    uso: {
      entrada: (r.usage && r.usage.input_tokens) || 0,
      saida: (r.usage && r.usage.output_tokens) || 0,
      cache_leitura: (r.usage && r.usage.cache_read_input_tokens) || 0
    }
  };
}

module.exports = { gerarCenarios, MODELO };
