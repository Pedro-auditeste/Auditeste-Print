/* Gera cenários de teste em Gherkin a partir das evidências do Audi Print.
 *
 * Mora na ponte, não no Print: a chave de API não pode viver num HTML que é
 * exportado e entregue ao cliente.
 *
 * Vídeo não é enviado como vídeo — a API recebe imagem. O Print amostra
 * quadros do webm no navegador e manda os quadros.
 */
const MODELO = process.env.CENARIOS_MODELO || 'claude-opus-5';
const MAX_IMAGENS = Number(process.env.CENARIOS_MAX_IMAGENS) || 20;

const SISTEMA = `Você é analista de testes sênior. A partir de evidências de execução — capturas de tela, anotações do analista e a ficha de identificação — você escreve cenários de teste em Gherkin, em português do Brasil.

Regras:
- Descreva apenas o que as evidências mostram. Não invente telas, campos, mensagens de erro ou dados que não aparecem nas imagens ou nas anotações.
- Um Cenário por comportamento verificável. Poucos cenários corretos valem mais que muitos especulativos.
- Escreva os passos no nível do que a pessoa faz e vê, não em detalhe de implementação.
- Use os dados concretos que aparecem nas evidências (valores digitados, mensagens exibidas, rótulos de botão).
- Se algum passo trouxer violação de acessibilidade importada de scan, gere também cenários de acessibilidade citando a regra e o elemento.
- Quando a evidência for insuficiente para afirmar um comportamento, não suponha: registre a dúvida numa seção "# A confirmar" no final.

Formato da resposta: apenas o Gherkin, começando por "Funcionalidade:". Sem introdução, sem comentário sobre o que você fez.`;

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
  return 'Ficha de identificação da evidência:\n' + (linhas.join('\n') || '(não preenchida)');
}

async function gerarCenarios({ ficha, passos, quadros }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY não está definida na ponte. Defina a variável e reinicie: npm run servidor');
    e.semChave = true;
    throw e;
  }
  if (!Array.isArray(passos) || !passos.length) throw new Error('nenhum passo enviado');

  const Anthropic = require('@anthropic-ai/sdk');
  const cliente = new Anthropic();

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

  conteudo.push({ type: 'text', text: 'Escreva agora os cenários de teste em Gherkin a partir dessas evidências.' });

  const r = await cliente.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    system: SISTEMA,
    /* classificadores podem recusar; o fallback re-serve na mesma chamada */
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: conteudo }]
  });

  /* checar antes de ler content: numa recusa ele vem vazio ou parcial */
  if (r.stop_reason === 'refusal') {
    const cat = r.stop_details && r.stop_details.category;
    const e = new Error('O modelo recusou gerar a partir dessas evidências' + (cat ? ` (${cat})` : '') + '.');
    e.recusa = true;
    throw e;
  }

  const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!texto) throw new Error('a resposta veio sem texto');

  return {
    cenarios: texto,
    modelo: r.model,
    imagens,
    uso: {
      entrada: r.usage.input_tokens,
      saida: r.usage.output_tokens,
      cache_leitura: r.usage.cache_read_input_tokens
    }
  };
}

module.exports = { gerarCenarios, MODELO };
