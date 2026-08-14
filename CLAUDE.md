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

Quem tem DOM é o `gravador.js` e a extensão.

**`gravador.js` — o caminho do cliente.** Rotas `/gravar/abrir|tela|clicar|rolar|digitar|fechar`.
A ponte abre a página num Chrome **headless** e manda a imagem; o Print mostra e o
analista clica nela. A coordenada volta, `elementFromPoint` acha o elemento, e saem
seletor, rótulo, HTML e URL com print antes/depois. Roda no container, então
**funciona pelo Print hospedado sem instalar nada** — é assim que o cliente usa.

Não tente fazer isso com uma ponte local: página HTTPS não alcança `http://127.0.0.1`
(conteúdo misto), e container não tem janela para Chrome visível.

Três armadilhas já pagas ali, todas confirmadas por teste:

- Leia o `outerHTML` **antes** de pintar a marca vermelha, senão o `style` entra na
  evidência técnica.
- Tire a marca por chamada explícita, nunca por timer: um timer a remove no meio do
  passo seguinte e a tela parece ter mudado sozinha.
- Não use "a tela mudou" para decidir se o clique vira passo — anel de foco sumindo
  já basta para falsear. O critério é `cursor:pointer` ou casar a lista de tags
  interativas, que ainda pega card em div com listener delegado.

A extensão entrega de dois jeitos, ambos caindo em `aplicarEvidenciaImportada`:

1. **Direto** (botão "Trazer gravação da extensão"): o content script da extensão
   roda na própria página do Print e faz ponte por `window.postMessage` —
   por isso não é preciso saber o id da extensão nem declarar
   `externally_connectable`. Mensagens: `AUDI_EVIDENCIAS` (resumo) e
   `AUDI_EVIDENCIA` (payload inteiro).
2. **Arquivo**: exportar JSON no popup e importar aqui.

A ponte só responde nas origens do Print (`audiprint.up.railway.app`, qualquer
localhost, `file:`) — as sessões contêm prints de outras abas, então liberar
geral seria vazamento. Hospedou em outro endereço? Acrescente em `ORIGENS_PRINT`
no `content.js`.

Fechar a aba testada **não** apaga mais a gravação: as 5 mais recentes ficam
guardadas, senão gravar-fechar-abrir-o-Print perdia tudo.

## Idioma

Código, commits e UI em **português**. Mensagens de commit descrevem o efeito para
o usuário, não o arquivo mexido (ver `git log`).
