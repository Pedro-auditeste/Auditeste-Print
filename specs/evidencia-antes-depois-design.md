# Evidência antes/depois

## Escopo

- O teste automático captura um par antes/depois para cada clique e guarda seletor, rótulo, HTML, timestamps e URLs.
- O teste manual com DOM usa a extensão Chrome, pois `getDisplayMedia` entrega pixels e não identifica o elemento clicado.
- O Audi Print importa o JSON da extensão no mesmo formato do teste automático.
- A ponte descreve cada par de forma assíncrona com a NVIDIA e devolve JSON validado com legenda, descrição, Gherkin, alternativas e alerta QA; uma falha nunca remove os prints.

## Fluxo

1. A extensão registra `pointerdown`/teclado, monta o seletor e captura a tela antes.
2. Após a ação ou navegação, captura a tela depois e vincula ambas pelo mesmo identificador.
3. O usuário exporta a sessão e importa o JSON no Audi Print.
4. O Print exibe o par, chama `/descrever` no backend e mantém o seletor como detalhe técnico.
5. O QA pode copiar o Gherkin e transformar uma sugestão alternativa em cenário manual.
6. O registro e o HTML exportado preservam o agrupamento, a análise e os metadados.

## Segurança e falhas

- A chave permanece apenas na ponte e aceita `NVIDIA_NIM_API_KEY` ou o nome legado `AGENTE_API_KEY`.
- O backend limita textos recebidos e valida as duas imagens.
- Se a descrição falhar, o passo continua editável e oferece nova tentativa.
- JSON inválido da NVIDIA é descartado campo a campo e recua para a descrição simples.
- A extensão só registra quando o usuário inicia explicitamente uma sessão.

## Aceite

- Cada clique registrado possui duas imagens, seletor, timestamps e URLs.
- A descrição é assíncrona e não bloqueia o salvamento.
- Pares ficam em duas colunas acima de 800 px e em uma coluna abaixo disso.
- O HTML exportado mantém cada par dentro do mesmo passo.
