/* Traducao das mensagens do HTML_CodeSniffer (Pa11y) para portugues.
 * Chaves = codigo sniff (ex: 4_1_2_H91.A.NoContent), iguais ao Translations/en.js.
 * Placeholders {{id}}, {{expected}} etc. sao preenchidos a partir da mensagem original.
 */

const POR_CODIGO = {
  '1_1_1_H30.2': 'A imagem e o unico conteudo do link, mas esta sem texto alternativo. O alt deve descrever o proposito do link.',
  '1_1_1_H67.1': 'Imagem com alt vazio deve ter o atributo title ausente ou vazio.',
  '1_1_1_H67.2': 'Imagem marcada para ser ignorada por tecnologias assistivas.',
  '1_1_1_H37': 'Imagem sem atributo alt. Use alt para descrever a imagem de forma breve.',
  '1_1_1_G94.Image': 'Verifique se o texto alternativo da imagem transmite o mesmo proposito e informacao.',
  '1_1_1_H36': 'Botao de envio com imagem sem atributo alt. Descreva a funcao do botao no alt.',
  '1_1_1_G94.Button': 'Verifique se o alt do botao de imagem identifica o proposito do botao.',
  '1_1_1_H24': 'Area de mapa de imagem sem atributo alt.',
  '1_1_1_H2.EG5': 'Imagem dentro de um link nao deve usar alt igual ao texto do link.',
  '1_1_1_H2.EG4': 'Imagem dentro de um link com alt vazio, enquanto ha texto no link ao lado. Considere unificar os links.',
  '1_1_1_H2.EG3': 'Imagem dentro de um link nao deve repetir o texto de um link ao lado.',

  '1_3_1_F92,ARIA4': 'Este elemento tem role "presentation", mas contem filhos com significado semantico.',
  '1_3_1_H44.NonExistent': 'O atributo for deste label aponta para um ID que nao existe na pagina.',
  '1_3_1_H44.NotFormControl': 'O atributo for deste label aponta para um elemento que nao e campo de formulario.',
  '1_3_1_H65': 'Campo com atributo title vazio. Ele sera ignorado na rotulagem.',
  '1_3_1_ARIA6': 'Campo com aria-label vazio. Ele sera ignorado na rotulagem.',
  '1_3_1_F68': 'Este campo de formulario precisa de um rotulo (label, title, aria-label ou aria-labelledby).',
  '1_3_1_H49.': 'Marcacao apresentacional obsoleta no HTML5.',
  '1_3_1_H49.AlignAttr': 'Atributos de alinhamento incorretos ou obsoletos.',
  '1_3_1_H49.Semantic': 'Use marcacao semantica para destacar texto especial, para que possa ser determinado programaticamente.',
  '1_3_1_H49.AlignAttr.Semantic': 'Use marcacao semantica para destacar texto especial, para que possa ser determinado programaticamente.',
  '1_3_1_H42': 'Use marcacao de titulo (heading) se este conteudo for um cabecalho.',
  '1_3_1_H63.3': 'Celula de tabela com atributo scope invalido. Valores validos: row, col, rowgroup ou colgroup.',
  '1_3_1_H63.2': 'Atributo scope em td usado como cabecalho esta obsoleto no HTML5. Use th.',
  '1_3_1_H43.IncorrectAttr': 'Atributo headers incorreto nesta celula td. Esperado "{{expected}}", encontrado "{{actual}}".',
  '1_3_1_H43.HeadersRequired': 'A relacao entre celulas td e th nao esta definida. Use o atributo headers nas celulas td.',
  '1_3_1_H43.MissingHeaderIds': 'Nem todos os th desta tabela tem atributo id.',
  '1_3_1_H43.MissingHeadersAttrs': 'Nem todos os td desta tabela tem atributo headers.',
  '1_3_1_H43,H63': 'A relacao entre td e th nao esta definida. Use scope nos th ou headers nos td.',
  '1_3_1_H63.1': 'Nem todos os th desta tabela tem atributo scope.',
  '1_3_1_H71.NoLegend': 'Fieldset sem elemento legend. Todo fieldset deve ter um legend descrevendo o grupo.',
  '1_3_1_H85.2': 'Se esta lista de selecao tem grupos de opcoes, agrupe-as com optgroup.',
  '1_3_1_H71.SameName': 'Se estes radios ou checkboxes precisam de descricao em grupo, coloque-os em um fieldset.',
  '1_3_1_H48.1': 'Este conteudo parece simular uma lista nao ordenada. Se for o caso, use o elemento ul.',
  '1_3_1_H48.2': 'Este conteudo parece simular uma lista ordenada. Se for o caso, use o elemento ol.',
  '1_3_1_G141_a': 'A estrutura de titulos nao esta aninhada logicamente. Este h{{headingNum}} parece ser o titulo principal e deveria ser h1.',
  '1_3_1_G141_b': 'A estrutura de titulos nao esta aninhada logicamente. Este h{{headingNum}} deveria ser h{{properHeadingNum}}.',

  '1_4_3_G18': 'Este elemento tem contraste insuficiente com o fundo. O contraste minimo e 4.5:1.',
  '1_4_3_G145': 'Este elemento tem contraste insuficiente com o fundo. O contraste minimo e 3:1 para texto grande.',
  '1_4_3_F24': 'Verifique se o contraste entre a cor do texto e do fundo atende o minimo exigido.',
  '1_4_4_G142': 'Verifique se o texto pode ser redimensionado ate 200% sem perda de conteudo ou funcionalidade.',
  '1_4_5_G140,C22,C30.NoChangeHuge': 'Se a imagem contem texto que transmite informacao, verifique se o texto tambem esta disponivel em formato real.',

  '2_1_1_G90': 'Verifique se toda funcionalidade desta pagina pode ser operada pelo teclado.',
  '2_1_2_F10': 'Verifique se o foco do teclado nao fica preso neste elemento.',
  '2_2_1_F40.2': 'Meta refresh com redirecionamento automatico. Remova ou permita ao usuario controlar o tempo.',
  '2_2_1_F41.2': 'Meta refresh com recarregamento automatico. Remova ou permita ao usuario controlar o tempo.',
  '2_2_2_SCR33,SCR22,G187,G152,G186,G191': 'Verifique se ha mecanismo para pausar, parar ou ocultar conteudo em movimento, piscante ou rolagem.',
  '2_2_2_F4': 'Verifique se ha mecanismo para parar este conteudo piscante em ate 5 segundos.',
  '2_2_2_F47': 'Elementos blink nao devem ser usados.',

  '2_4_1_H64.1': 'Iframe precisa de um atributo title nao vazio que identifique o quadro.',
  '2_4_1_H64.2': 'Verifique se o title deste elemento identifica o quadro corretamente.',
  '2_4_1_G1,G123,G124,H69': 'Garanta que a navegacao comum possa ser pulada (links de pular, cabecalhos ou landmarks ARIA).',
  '2_4_1_G1,G123,G124.NoSuchID': 'Este link aponta para a ancora "{{id}}" na pagina, mas essa ancora nao existe.',
  '2_4_1_G1,G123,G124.NoSuchIDFragment': 'Este link aponta para a ancora "{{id}}" no fragmento testado, mas essa ancora nao existe.',

  '2_4_2_H25.1.NoHeadEl': 'Nao ha secao head para colocar um titulo descritivo.',
  '2_4_2_H25.1.NoTitleEl': 'A pagina precisa de um elemento title nao vazio na secao head.',
  '2_4_2_H25.1.EmptyTitle': 'O elemento title na secao head nao deve estar vazio.',
  '2_4_2_H25.2': 'Verifique se o title descreve o documento.',

  '2_4_4_H77,H78,H79,H80,H81,H33': 'Verifique se o texto do link (ou seu title) identifica o proposito do link.',
  '2_4_4_H77,H78,H79,H80,H81': 'Verifique se o texto do link identifica o proposito do link.',
  '2_4_6_G130,G131': 'Verifique se titulos e rotulos descrevem o topico ou proposito.',
  '2_4_9_H30': 'Verifique se o texto do link descreve o proposito do link.',

  '3_1_1_H57.2': 'O elemento html deve ter atributo lang (ou xml:lang) descrevendo o idioma da pagina.',
  '3_1_1_H57.3.Lang': 'O idioma informado no atributo lang nao parece bem formado.',
  '3_1_1_H57.3.XmlLang': 'O idioma informado no atributo xml:lang nao parece bem formado.',
  '3_1_2_H58': 'Marque mudancas de idioma com lang e/ou xml:lang no elemento adequado.',

  '3_2_2_H32.2': 'Este formulario nao tem botao de envio, o que dificulta quem usa apenas teclado.',
  '3_3_2_G131,G89,G184,H90': 'Verifique se ha rotulos ou instrucoes descritivas para os campos deste formulario.',

  '4_1_1_F77': 'Valor de id duplicado "{{id}}" encontrado na pagina.',
  '4_1_2_H91.A.Empty': 'Link ancora com ID, mas sem href nem texto. Considere mover o ID para um elemento pai.',
  '4_1_2_H91.A.EmptyWithName': 'Link ancora com name, mas sem href nem texto. Considere transformar o name em id de um elemento pai.',
  '4_1_2_H91.A.EmptyNoId': 'Link ancora sem conteudo e sem name/ID.',
  '4_1_2_H91.A.NoHref': 'Nao use elementos a so para definir alvos de link na pagina. Prefira id em um elemento pai.',
  '4_1_2_H91.A.Placeholder': 'Link ancora com texto, mas sem href, ID ou name.',
  '4_1_2_H91.A.NoContent': 'Link com href valido, mas sem texto ou conteudo identificavel.',
  '4_1_2_msg_pattern': 'Este {{msgNodeType}} nao tem nome disponivel para a API de acessibilidade. Nomes validos: {{builtAttrs}}.',
  '4_1_2_msg_pattern_role_of_button': 'Este elemento tem role "button", mas nao tem nome disponivel para a API de acessibilidade. Nomes validos: {{builtAttrs}}.',
  '4_1_2_msg_pattern2': 'Este {{msgNodeType}} nao tem valor disponivel para a API de acessibilidade.'
};

/* Fallbacks por padrao da mensagem (quando o codigo nao casa). */
const POR_PADRAO = [
  {
    re: /^align attributes\.?\s*$/i,
    pt: 'Atributos de alinhamento incorretos ou obsoletos.'
  },
  {
    re: /^Anchor element found with a valid href attribute, but no link content has been supplied\.?$/i,
    pt: 'Link com href valido, mas sem texto ou conteudo identificavel.'
  },
  {
    re: /^This link points to a named anchor "([^"]+)" within the document, but no anchor exists with that name\.?$/i,
    pt: (_, id) => `Este link aponta para a ancora "${id}" na pagina, mas essa ancora nao existe.`
  },
  {
    re: /^This link points to a named anchor "([^"]+)" within the document, but no anchor exists with that name in the fragment tested\.?$/i,
    pt: (_, id) => `Este link aponta para a ancora "${id}" no fragmento testado, mas essa ancora nao existe.`
  },
  {
    re: /^Duplicate id attribute value "([^"]+)" found on the web page\.?$/i,
    pt: (_, id) => `Valor de id duplicado "${id}" encontrado na pagina.`
  },
  {
    re: /^Img element missing an alt attribute/i,
    pt: 'Imagem sem atributo alt. Use alt para descrever a imagem de forma breve.'
  },
  {
    re: /^This form field should be labelled in some way/i,
    pt: 'Este campo de formulario precisa de um rotulo (label, title, aria-label ou aria-labelledby).'
  },
  {
    re: /^Presentational markup used that has become obsolete in HTML5\.?$/i,
    pt: 'Marcacao apresentacional obsoleta no HTML5.'
  },
  {
    re: /^Heading markup should be used if this content is intended as a heading\.?$/i,
    pt: 'Use marcacao de titulo se este conteudo for um cabecalho.'
  },
  {
    re: /^The html element should have a lang/i,
    pt: 'O elemento html deve ter atributo lang descrevendo o idioma da pagina.'
  },
  {
    re: /^Iframe element requires a non-empty title attribute/i,
    pt: 'Iframe precisa de um atributo title nao vazio que identifique o quadro.'
  },
  {
    re: /^A title should be provided for the document/i,
    pt: 'A pagina precisa de um elemento title nao vazio na secao head.'
  }
];

function extrairCodigoSniff(code) {
  const s = String(code || '');
  // WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent → 4_1_2_H91.A.NoContent
  const m = s.match(/\.(\d_\d_\d)\.(.+)$/);
  if (m) return m[1] + '_' + m[2];
  // ja no formato do HTMLCS
  if (/^\d_\d_\d_/.test(s)) return s;
  return '';
}

function extrairVars(msg) {
  const vars = {};
  const id = msg.match(/"([^"]+)"/);
  if (id) vars.id = id[1];
  const esperado = msg.match(/Expected "([^"]+)" but found "([^"]+)"/i);
  if (esperado) {
    vars.expected = esperado[1];
    vars.actual = esperado[2];
  }
  const heading = msg.match(/This h(\d+)/i);
  if (heading) vars.headingNum = heading[1];
  const proper = msg.match(/should be an? h(\d+)/i);
  if (proper) vars.properHeadingNum = proper[1];
  return vars;
}

function aplicarVars(tpl, vars) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? vars[k] : '{{' + k + '}}'));
}

function traduzirMensagemPa11y(message, code) {
  const msg = String(message || '').trim();
  if (!msg) return msg;

  const sniff = extrairCodigoSniff(code);
  const vars = extrairVars(msg);

  if (sniff && POR_CODIGO[sniff]) {
    return aplicarVars(POR_CODIGO[sniff], vars);
  }

  // tentativa parcial: so o sufixo H91.A.NoContent
  if (sniff) {
    const sufixo = sniff.replace(/^\d_\d_\d_/, '');
    const chave = Object.keys(POR_CODIGO).find(k => k.endsWith('_' + sufixo) || k === sufixo);
    if (chave) return aplicarVars(POR_CODIGO[chave], vars);
  }

  for (const p of POR_PADRAO) {
    const m = msg.match(p.re);
    if (m) return typeof p.pt === 'function' ? p.pt(...m) : p.pt;
  }

  return msg;
}

function traduzirIssuePa11y(issue) {
  const msg = (issue.message || '').trim();
  const pt = traduzirMensagemPa11y(msg, issue.code);
  if (pt === msg) return issue;
  return Object.assign({}, issue, { message: pt, messageEn: msg });
}

module.exports = { traduzirIssuePa11y, traduzirMensagemPa11y, extrairCodigoSniff };
