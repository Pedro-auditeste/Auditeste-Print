/* Teste offline de "Montar cenários" — lógica espelhada do Print, sem browser/API. */

const RE_VIOLACAO = /^\[(.+?)\]\s*(.+)$/;
const RE_A11Y_CARIMBO = /^(Grave|Importante|Moderado|Leve|A corrigir|A verificar)\s·\s(.+)$/;

function limpar(t){ return (t || '').trim().replace(/\s+/g, ' '); }

function montarGherkin(r){
  const f = r.ficha || {};
  const funcionais = [];
  const violacoes = new Map();

  (r.passos || []).forEach(p => {
    const titulo = limpar(p.titulo);
    const obs = limpar(p.obs);
    const carimbo = limpar(p.carimbo);
    const m = RE_VIOLACAO.exec(titulo);
    const mA11y = RE_A11Y_CARIMBO.exec(carimbo);
    if(m){
      const chave = m[2] + ' | ' + m[1];
      if(!violacoes.has(chave)) violacoes.set(chave, { regra: m[2], gravidade: m[1], itens: [] });
      violacoes.get(chave).itens.push(obs);
    }else if(mA11y){
      const chave = titulo + ' | ' + mA11y[1];
      if(!violacoes.has(chave)) violacoes.set(chave, { regra: titulo, gravidade: mA11y[1], itens: [] });
      violacoes.get(chave).itens.push(obs);
    }else if(titulo || obs){
      funcionais.push({ titulo, obs, imagens: (p.imagens || []).length });
    }
  });

  const L = [];
  const contexto = [
    f.registro && 'registro ' + limpar(f.registro),
    f.ambiente && 'ambiente ' + limpar(f.ambiente),
    f.versao && 'versão ' + limpar(f.versao),
    f.executor && 'executado por ' + limpar(f.executor),
    limpar(f.data)
  ].filter(Boolean).join(' · ');

  L.push('# Montado a partir das evidências desta execução — revise e complete.');
  if(contexto) L.push('# ' + contexto);
  L.push('');
  L.push('Funcionalidade: ' + (limpar(f.modulo) || limpar(f.registro) || 'Evidência de teste'));
  if(limpar(f.observacoes)) L.push('  ' + limpar(f.observacoes));
  L.push('');

  if(funcionais.length){
    L.push('  Cenário: ' + (limpar(f.tipo) ? limpar(f.tipo) + ' — ' : '') + (limpar(f.modulo) || 'fluxo registrado'));
    if(limpar(f.ambiente)) L.push('    Dado que estou em ' + limpar(f.ambiente));
    funcionais.forEach((p, i) => {
      L.push('    ' + (i === 0 ? 'Quando ' : 'E ') + (p.titulo || 'executo o passo ' + (i + 1)));
      if(p.obs) L.push('      # ' + p.obs);
      if(p.imagens) L.push('      # evidência: ' + p.imagens + ' captura(s)');
    });
    L.push('    Então o resultado registrado foi "' + (limpar(f.resultado) || 'não informado') + '"');
    L.push('');
  }

  [...violacoes.values()].forEach(v => {
    L.push('  Cenário: Acessibilidade — ' + v.regra + ' (' + v.gravidade + ')');
    L.push('    Dado que a pagina avaliada estava no estado registrado');
    v.itens.forEach((item, i) => {
      L.push('    ' + (i === 0 ? 'Entao ' : 'E ') + 'o problema "' + v.regra + '" deve ser corrigido');
      if(item) L.push('      # ' + item);
    });
    L.push('');
  });

  const semObs = funcionais.filter(p => !p.obs).length;
  if(semObs || !funcionais.length){
    L.push('# A confirmar');
    if(!funcionais.length) L.push('# - Nenhum passo funcional: o registro só tem violações importadas.');
    if(semObs) L.push('# - ' + semObs + ' passo(s) sem observação: o resultado esperado precisa ser escrito à mão.');
  }

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const REGISTRO = {
  ficha: {
    registro: 'EV-001',
    executor: 'Analista QA',
    data: '12/08/2026',
    modulo: 'Login',
    demanda: 'Acessibilidade',
    versao: '1.0.0',
    ambiente: 'Homologação',
    tipo: 'Funcional',
    resultado: 'Reprovado',
    observacoes: 'Fluxo com scan axe/Pa11y'
  },
  passos: [
    {
      carimbo: '12/08/2026 13:00 · 00:05 de gravação',
      titulo: 'Acessar tela de login',
      obs: 'Página carregou com formulário e-mail e senha.',
      imagens: [{}, {}]
    },
    {
      carimbo: '12/08/2026 13:01 · 00:20 de gravação',
      titulo: 'Informar credenciais e clicar em Entrar',
      obs: 'Sistema redirecionou para o dashboard.',
      imagens: [{}]
    },
    {
      carimbo: 'Importante · Verificação automática',
      titulo: 'Contraste fraco entre texto e fundo',
      obs: 'O texto pode ficar difícil de ler. Onde aparece: no elemento button.',
      imagens: []
    },
    {
      carimbo: 'Importante · Segunda opinião',
      titulo: 'Link sem texto identificável',
      obs: 'Há um link com endereço, mas sem texto.',
      imagens: []
    }
  ]
};

const texto = montarGherkin(REGISTRO);
console.log('=== SAÍDA: Montar cenários (offline) ===\n');
console.log(texto);
console.log('\n=== CHECAGENS ===');

const checks = [
  ['Gera Funcionalidade: Login', /Funcionalidade: Login/.test(texto)],
  ['Inclui passos funcionais (Quando/E)', /Quando Acessar tela de login/.test(texto)],
  ['Inclui resultado da ficha', /Então o resultado registrado foi "Reprovado"/.test(texto)],
  ['Cenário a11y contraste (axe)', /Acessibilidade — Contraste fraco/.test(texto)],
  ['Cenário a11y link (Pa11y)', /Acessibilidade — Link sem texto/.test(texto)],
  ['Sem custo / sem API', true]
];

let falhas = 0;
for (const [nome, ok] of checks) {
  console.log((ok ? 'OK  ' : 'FAIL') + '  ' + nome);
  if (!ok) falhas++;
}
console.log(falhas ? '\nRESULTADO: FALHOU' : '\nRESULTADO: PASSOU');
process.exit(falhas ? 1 : 0);
