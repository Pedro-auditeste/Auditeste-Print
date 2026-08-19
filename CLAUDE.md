# Auditeste-Print

Pacote de acessibilidade: grava evidências de clique (Antes/Depois), roda scans
(axe-core, Pa11y, Lighthouse) e monta cenários Gherkin.

Repo: https://github.com/Pedro-auditeste/Auditeste-Print (público, branch `main`)
Deploy: Railway (projeto `ae29ff46-5fc0-4d82-9a18-c1a5f1d4fb8e`), build pelo `Dockerfile` da raiz.

## Onde fica o quê

```
auditeste-a11y/     ponte Node (servidor.js) + scripts de scan e testes
audi-print/         Audi Print standalone, abre por file:// com duplo clique
audi-print-scanner/ extensão Chrome (grava cliques + roda axe)
specs/              notas de design
```

## Armadilha principal: o HTML é duplicado

`audi-print/evidencias-auditeste.html` e `auditeste-a11y/publico/index.html` são
**byte a byte idênticos** (4126 linhas). O Dockerfile só copia `publico/`.
Ao editar um, copie para o outro — senão o Print aberto por `file://` e o
servido pela Railway divergem.

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

Medições reais (14/08/2026): `llama-3.2-11b-vision` responde em ~17 s;
`llama-3.2-90b-vision` **não respondeu nem em 120 s** — evite o 90B em `AGENTE_MODELO`.
Da Railway a NVIDIA é mais lenta que da máquina local (`/descrever` levou 102 s).

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
