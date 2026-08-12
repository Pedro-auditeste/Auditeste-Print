# auditeste-a11y

axe-core, Pa11y e Lighthouse instalados e prontos, com saída no formato que o
**Audi Print** importa direto — sem conversão.

## Instalar (já feito, refaça só em outra máquina)

```bash
npm install
npx playwright install chromium
npx puppeteer browsers install chrome
```

Os dois últimos baixam navegadores: o Playwright usa o dele, o Pa11y usa o do
Puppeteer, e o Lighthouse usa o Chrome do sistema. Juntos passam de 400 MB.

## Usar

Cada comando aceita uma ou várias URLs e grava um JSON em `saida/`.

```bash
npm run axe   -- https://sistema.cliente.com/checkout
npm run pa11y -- https://sistema.cliente.com https://sistema.cliente.com/ajuda
npm run nota  -- https://sistema.cliente.com
```

| Comando | Ferramenta | Para quê |
|---|---|---|
| `axe` | axe-core via Playwright | detecção principal, uma página |
| `pa11y` | Pa11y | varredura em largura, muitas URLs |
| `nota` | Lighthouse | nota de 0 a 100 para o relatório |

Depois, no Audi Print: **Nova gravação → + Importar acessibilidade** e escolha o
JSON. Cada violação vira um passo de evidência.

## Sem sair do Audi Print

```bash
npm run servidor
```

Deixe rodando. No gravador do Print abra **Escanear acessibilidade**, informe a
URL e clique em `axe-core`, `Pa11y` ou `Lighthouse` — o resultado entra direto
como passo de evidência, sem baixar nem importar arquivo.

Por padrão escuta só em `127.0.0.1`. Com a ponte desligada o Print avisa e
continua funcionando — a importação manual de arquivo segue disponível.

## Cenários de teste

Dois caminhos no Print (registro aberto):

| Botão | Precisa de chave? | O que faz |
|---|---|---|
| **Montar cenários** | Não | Monta Gherkin offline a partir da ficha e dos passos |
| **Gerar com IA** | Sim (`ANTHROPIC_API_KEY`) | Envia ficha, passos, capturas e quadros do vídeo à Claude e devolve Gherkin |

A chave fica **na ponte, nunca no Print**.

### Local

1. Copie `auditeste-a11y/.env.example` para `auditeste-a11y/.env`
2. Cole a chave Anthropic (`sk-ant-...`) em `ANTHROPIC_API_KEY=`
3. Reinicie: `npm run servidor`

### Railway

No painel do serviço → Variables → adicione:

- `ANTHROPIC_API_KEY` = sua chave
- opcional: `CENARIOS_MODELO` = `claude-sonnet-4-6` (padrão)

Depois do redeploy, `/ping` deve mostrar `"cenarios": true`.

| Variável | Padrão |
|---|---|
| `ANTHROPIC_API_KEY` | obrigatória para Gerar com IA |
| `CENARIOS_MODELO` | `claude-sonnet-4-6` |
| `CENARIOS_MAX_IMAGENS` | `20` |
| `PONTE_LIMITE_MB` | `25` |

**O que sobe para a IA:** a ficha, o título e a observação de cada passo, e as capturas
reduzidas para 1200px em JPEG. O vídeo não sobe como vídeo — o Print amostra 4 quadros.

## Subir na Railway (ou qualquer host com Docker)

Hospedado, **tudo vira uma URL só**: a ponte serve o Print em `/`, e o Print
detecta que veio da mesma origem — ninguém cola endereço nem chave.

```
analista abre  https://seu-app.up.railway.app
   ↓
scans, cenários por IA, PDF, export — zero configuração
```

Conecte o repositório e defina as variáveis:

| Variável | Valor |
|---|---|
| `PONTE_TOKEN` | **obrigatória** — string longa e aleatória. Sem ela o servidor se recusa a subir exposto |
| `ANTHROPIC_API_KEY` | habilita o botão **Gerar com IA**. Sem ela, só o montador local funciona |
| `PONTE_DOMINIOS` | allowlist dos domínios que podem ser escaneados — a defesa mais forte contra SSRF |
| `PORT` | a Railway injeta sozinha; o servidor já lê |

O `Dockerfile` cuida do resto. `HOST=0.0.0.0` já vem definido nele.

**Quando alterar o Print**, copie a versão nova por cima de `publico/index.html`
antes do commit — é dela que o servidor serve.

**Dimensionamento:** a imagem passa de 2 GB (Chromium do Playwright + Chrome do
Puppeteer) e rodar navegador quer 1–2 GB de RAM. Se quiser enxugar, dá para
cortar Pa11y e Lighthouse do `package.json` e deixar só o axe.

**Cada analista precisa do token** em *Endereço da ponte* → campo do token, ou o
scan e a IA respondem 401. É isso que impede alguém que ache a URL de gastar a
sua chave.

## Subir a ponte online

**Este serviço busca URLs por conta de quem pedir.** Exposto sem trava, vira um
SSRF: alguém manda escanear `169.254.169.254` e recebe as credenciais da sua
instância. Por isso o servidor **se recusa a subir** com `HOST` público sem
`PONTE_TOKEN`.

```bash
docker build -t ponte-a11y .
docker run -p 8900:8900 \
  -e PONTE_TOKEN=um-token-longo-e-aleatorio \
  -e PONTE_DOMINIOS=cliente.com,outrocliente.com.br \
  ponte-a11y
```

| Variável | Para quê |
|---|---|
| `PONTE_TOKEN` | obrigatório quando exposto. Vai no header `Authorization: Bearer` |
| `PONTE_DOMINIOS` | allowlist de domínios — **o controle mais forte**, use sempre que der |
| `PONTE_ORIGENS` | origens de CORS aceitas, padrão `*` |
| `PONTE_MAX` | scans simultâneos, padrão 2. Cada um sobe um navegador |
| `PONTE_PRIVADO=1` | libera IP privado. **Só local**, nunca exposto |
| `HOST` / `PORT` | padrão `127.0.0.1` e `8900` |

Travas já ativas: IP privado, loopback, link-local e multicast bloqueados;
protocolo restrito a http/https; token conferido antes de qualquer navegação;
429 ao passar do limite de simultâneos.

**O que isso ainda não cobre:** a checagem de IP acontece antes de navegar, então
um domínio que troque de resposta no meio (DNS rebinding) escapa. A defesa real é
a allowlist — com `PONTE_DOMINIOS` preenchido, o resto é reforço.

No Print, abra **Endereço da ponte** dentro da caixa de scan e informe a URL
hospedada e o token. Fica guardado no navegador.

## Fluxo autenticado

`npm run axe` só alcança página pública. Para o que está atrás do login, use
`fluxo.js` — você escreve o percurso uma vez e ele escaneia em cada parada.

```bash
BASE=https://sistema.cliente.com A11Y_USUARIO=qa@cliente.com A11Y_SENHA=xxx npm run fluxo
```

Edite duas coisas no arquivo:

1. **`entrar()`** — descomente e ajuste os seletores do formulário de login
2. **`PARADAS`** — cada item é um estado que você quer avaliar (carrinho aberto,
   modal de pagamento, formulário em erro)

Gera um JSON por parada. Para ver o navegador trabalhando, `VISIVEL=1`.

Credencial vai por variável de ambiente de propósito: não escreva senha no
arquivo, ele vai para o git.

## O que já foi verificado

Rodado contra o próprio Audi Print servido em localhost:

| Comando | Resultado |
|---|---|
| `axe` | 1 regra, 1 elemento |
| `pa11y` | 8 achados, 8 erros |
| `nota` | 94/100, 2 audits reprovados |
| `fluxo` | 3 paradas, 5 elementos — e achou mais a cada estado |

As 6 saídas foram importadas no Print com sucesso, nos três formatos.

## Limites

- axe-core cobre o que é verificável por máquina — rótulo, contraste, ARIA,
  estrutura. Ordem lógica de foco, clareza de mensagem e compreensão do fluxo
  continuam exigindo pessoa.
- Nada disso alcança tela nativa Android. Para o `automacao-viz-delivery`, que é
  Appium em `View` nativa, o caminho é outro.
