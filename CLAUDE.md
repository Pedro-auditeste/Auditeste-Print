# Auditeste-Print

Pacote de acessibilidade: grava evidências de clique (Antes/Depois), roda scans
(axe-core, Pa11y, Lighthouse) e monta cenários Gherkin.

Repo: https://github.com/Pedro-auditeste/Auditeste-Print (público, branch `main`)
Deploy: Railway da Auditeste (workspace Governança, projeto `cf00171c-f68c-4b48-a6f8-f0fa71d13e33`),
ligado a este repo (`Pedro-auditeste/Auditeste-Print`, branch `main`), build pelo `Dockerfile` da raiz,
volume em `/dados`. Endereço principal: https://audiprint.up.railway.app (também responde em auditeste-print-production.up.railway.app). Migrado em 12/11/2026
do projeto `gov-auditeste` (repo carvalh), cujo deploy travava em "in_progress" sem ninguém com acesso
ao painel. O endereço principal é `audiprint` de propósito: é o único que o complemento da
Chrome Web Store (2.3.1) já reconhece, então quem entra por ele grava id, xpath e HTML sem
atualizar nada. Esse domínio estava preso ao projeto pessoal antigo "attractive-analysis",
apagado em 12/11/2026 para liberar.

## Onde fica o quê

```
auditeste-a11y/     ponte Node (servidor.js) + scripts de scan e testes
audi-print/         Audi Print standalone, abre por file:// com duplo clique
audi-print-scanner/ extensão Chrome (grava cliques + roda axe)
specs/              notas de design
```

## `publico/index.html` é a única fonte

Existiu um espelho em `audi-print/evidencias-auditeste.html` para abrir por
`file://`, sem servidor. Ele parou de ser mantido, divergiu de `publico/`
por milhares de linhas sem ninguém notar, e derrubava `teste-privacidade.js`
sem que a falha fizesse sentido para quem lia. Removido em 08/09/2026: hoje
só existe `auditeste-a11y/publico/index.html`, servido pela Railway. Não
recriar um segundo caminho sem servidor sem repensar como mantê-lo em sincronia
de verdade (script de build, não cópia manual).

## Servidor (`auditeste-a11y/servidor.js`)

`http.createServer` puro, sem Express. Rotas roteadas na mão por `u.pathname`:

| Rota | O quê |
|---|---|
| `/ping`, `/health` | healthcheck + status dos motores (`"cenarios": true` = chave IA ok) |
| `/scan?tipo=axe\|pa11y\|nota&url=` | scans; exige `Authorization: Bearer $PONTE_TOKEN` |
| `/descrever` | descrição das telas via NVIDIA NIM |
| `/cenarios` | monta Gherkin |

A Railway injeta `PORT`. `HOST=0.0.0.0` vem do Dockerfile.

## Gerar cenários: o montador vem primeiro

`/cenarios` monta o Gherkin **dos textos das descrições** (`montarCenariosDosPassos`)
em ~0,03 s. A IA é enriquecimento com prazo curto, não dependência.

`AGENTE_ORCAMENTO_CENARIOS_MS` limita a **soma** das tentativas de IA (padrão 25000).
Ponha **0** para pular a IA e devolver sempre o montado, instantâneo e sem cota.

**Modelo padrão: `nvidia/nemotron-3.5-super-vl-120b-a12b`, com o 90B atrás.** A NVIDIA
aposentou o `llama-3.2-11b-vision` em 05/11/2026 (responde HTTP 410), e toda descrição
passou a falhar com "Falha interna ao processar". Medido em 12/11/2026: Nemotron 2 s por
imagem (8,7 s o par completo), 90B 11 s e descrição pior; gemma-3, phi-3-vision, vila e
kimi dão 404 nesta conta. O Nemotron precisa de `chat_template_kwargs.enable_thinking:
false`, senão gasta os tokens raciocinando e devolve texto vazio (`chamarNvidia` já manda).
Os padrões do código entram sempre no fim da fila de modelos: variável `AGENTE_MODELO`
apontando para modelo aposentado falha em 0,3 s e a chamada segue sozinha. Antes de trocar
de modelo, medir com imagem de verdade; a lista pública fica em
`https://integrate.api.nvidia.com/v1/models`, mas estar na lista não garante acesso da conta.

## Variáveis de ambiente

`NVIDIA_NIM_API_KEY` (obrigatória p/ descrever e cenários; `AGENTE_API_KEY` também aceito),
`AGENTE_BASE_URL`, `AGENTE_MODELO`, `PONTE_TOKEN`, `PONTE_DOMINIOS`.
Na Railway precisam estar **no card do serviço**, não só em Shared. Depois: Redeploy.

## Segredos

`chave.txt` e `.env` estão no `.gitignore` e nunca foram commitados — **o repo é
público, mantenha assim**. Nunca colar chave em arquivo rastreado.

## Rodar local

```bash
cd auditeste-a11y
npm install && npx playwright install chromium && npx puppeteer browsers install chrome
npm run servidor
```

Testes são scripts soltos (`node teste-*.js`), sem framework. `npm run teste-agente`,
`teste-pares`.

Sem rede: `teste-texto`, `teste-cenarios`, `teste-agendamento`, `teste-marca`,
`teste-inspecao`. Os três últimos abrem um Chrome headless mas não usam a NVIDIA.

Contra a ponte local não precisa de token (o servidor libera loopback). Contra a
hospedada, passe as duas: `PONTE_URL=https://audiprint.up.railway.app/
PONTE_TOKEN=... node teste-pares-ui.js`. Os testes de Chrome semeiam o
`localStorage.ponte_token` antes do `goto` — sem isso a página sobe mas a ponte
devolve 401 (só faz diferença se `PONTE_TOKEN` estiver definido na Railway).

## Gravação: quem tem DOM

A gravação por tela do Print usa `getDisplayMedia` — **pixels, sem DOM**. Ela não
vê clique nenhum, nem que houve, nem em quê. Não tente tirar seletor dela.

Quem tem DOM é o complemento do navegador (ver a seção seguinte). A partir do
print, o modelo só sugere um **localizador por papel e texto**
(`getByRole('button', { name: 'Comprar' })`), e `localizadorValido` recusa `#id`,
classe, `[data-*]` e xpath — nada disso está na imagem, então se vier foi
invenção, e seletor inventado não falha na hora: falha depois, no cliente.

Caminhos já tentados e removidos, com o motivo, para não repetir a volta:

| Tentativa | Por que caiu |
|---|---|
| Teste automático pelo link | navegação por heurística, frágil |
| Catálogo de elementos por URL (`/elementos`) | não alcança tela com login, e o complemento já dá o elemento certo |
| Navegação dentro do Print | antibot bloqueia IP de datacenter (Casas Bahia, `Client IP` de AWS) |
| Bookmarklet | funcionava, mas exigia arrastar favorito ou colar no console |
| Importar JSON do Chrome Recorder | traz seletor mas não `outerHTML` |

## Captura de elementos por código

O que registra o elemento de verdade é `audi-print-scanner/content.js`, dentro do
navegador, lendo o DOM. Sem modelo nenhum no caminho. Ele escuta `pointerdown`,
`keydown`, `change` e `mouseup` e registra quatro interações: **Clicar**,
**Preencher**, **Limpar**/**Marcar**/**Desmarcar** e **Capturar texto**.

O seletor é **sempre xpath** (`seletorDe`): xpath por `@id`, `@data-testid`,
`@name`, `@aria-label` ou texto exato quando aponta para um nó só, e xpath
posicional absoluto quando não há por onde ancorar. Um seletor CSS aparecendo
aqui é regressão — `teste-extensao-para-print.js` cobra isso em toda interação.

O Print busca essa captura pelo botão **Trazer captura do navegador**, por
`postMessage` na própria página (`pedirAoNavegador` → `aplicarEvidenciaImportada`).
O botão aparece porque o Print **pergunta** ao carregar: o anúncio
`AUDI_EXTENSAO_PRESENTE` sai em `document_start` e chega antes do script do Print
existir, então só o ouvinte não detectava nada.

Campo de senha nunca tem o valor gravado, e o rótulo de um campo nunca é o
`value` — senão o passo vira "Preencheu PROMO10 com PROMO10".

**`esc()` escapa aspas também.** O rótulo e o HTML vêm do site testado e têm
aspas o tempo todo; sem elas na lista, o primeiro uso de `esc()` dentro de um
atributo quebra o atributo. `teste-seguranca.js` trava isso, junto com as faixas
de IP privado (inclui `::ffff:` e CGNAT) e a comparação de token em tempo fixo.

**Digitar e clicar direto grava o Preencher primeiro.** O `pointerdown` do
botão chega antes do `change` do campo; o clique grava o campo com digitação
pendente (`campoSujo`) e o `change` seguinte não duplica. No `background.js`,
ação que chega com outro passo aberto entra em `sessao.fila`, nunca é
descartada. `teste-preencher-e-clicar.js` trava isso (e-mail, senha, Entrar).

**Passo sem xpath, sem id e sem HTML quer dizer complemento fora do ar, não
defeito na captura.** Sem ele respondendo, a gravação cai para o print da tela,
que é imagem e não tem DOM. Foi o "funciona na minha máquina e não na da
colega": o Chrome só põe o content script em página carregada depois da
instalação, então quem instalava e ia direto testar na aba já aberta não gravava
nada. Duas travas: o `onInstalled` do `background.js` injeta o `content.js` nas
abas abertas (e a cópia antiga, que sobra na atualização, se aposenta pelo evento
`TROCA`), e o Print mostra `#avisoSemComplemento` quando o pedido de armar não é
respondido. `teste-complemento-instalado-depois.js` instala o complemento com a
aba aberta e recarrega ele no meio; `teste-aviso-sem-complemento.js` cobre o
aviso. Janela anônima continua dependendo de o usuário permitir o complemento
nela: isso o código não alcança, só o aviso.

**Iniciar gravação arma o complemento, e o "armado" não pode morar em variável.**
O Print não grava a si mesmo: ao iniciar ele manda `AUDI_ARMAR`, e a sessão
começa na primeira aba de sistema que a pessoa focar. Esse caminho falhava calado
de dois jeitos, e nenhum teste passava por ele (todos iniciavam pelo popup, com
`AUDI_INICIAR`): o prazo ficava num `let` do service worker, que o Chrome encerra
depois de uns 30 s parado, então quem demorava para ir ao sistema encontrava o
complemento desarmado (com o painel do worker aberto ele nunca dorme, por isso
funcionava para quem desenvolve); e qualquer `localhost`/`127.0.0.1` contava como
"é o Print", então sistema rodando na própria máquina nunca gravava. Hoje o
armado fica em `chrome.storage.session` (com a aba e a origem de quem armou), e
endereço local só é Print quando é a mesma origem que armou.
`teste-iniciar-gravacao-arma.js` cobre os dois, derrubando o worker no meio.
Estado do complemento que precisa sobreviver a 30 s vai para storage, nunca para
variável de módulo.

**Trazer a captura nunca limpa a tela.** `acrescentarPassos` só adiciona o que
falta, deduplicando por id. A função anterior zerava a caixa de vídeo por esperar
um vídeo vindo do complemento — que ele nunca mandou —, e o vídeo da gravação de
tela sumia junto.

**O bloco do passo mostra o JSON capturado, não palpite lido do print.** O
localizador sugerido e a tabela de controles saíram: os dois vinham do modelo
olhando a imagem, e envelheciam mal. No lugar vai `jsonCapturado`, com xpath,
HTML, ação, valor e URLs que a gravação leu do DOM, e um botão de copiar.

**O print "antes" vem de uma reserva, não do clique.** Pedir a captura só depois
do clique chega tarde: quando a mensagem alcança o service worker, a página já
rodou o handler dela e o Chrome já repintou, então o "antes" saía mostrando a
tela DEPOIS. O `pointerover` num elemento clicável dispara `AUDI_PRE`, que guarda
um print de reserva; o clique consome essa reserva se ela for recente e da mesma
URL. `teste-antes-depois.js` mede isso com uma página que muda de cor no
pointerdown: se o "antes" sair colorido, o par está trocado. Limite conhecido:
duas interações em menos de ~500 ms não dão tempo da reserva ficar pronta.

O botão **Instalar complemento** baixa `/extensao.zip`, montado por `extensao.js`
(zip escrito na mão, método stored, sem dependência nova). Página web **não
instala complemento sozinha** — o Chrome tirou isso em 2018 —, então o download
vem acompanhado dos três passos do `chrome://extensions`. Instalação em um clique
só existiria publicando na Chrome Web Store. `teste-baixar-extensao.js` baixa,
descompacta e carrega o pacote num Chrome de verdade: zip que abre não prova nada.

## Idioma

Código, commits e UI em **português**. Mensagens de commit descrevem o efeito para
o usuário, não o arquivo mexido (ver `git log`).
