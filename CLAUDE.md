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

A gravação do Print usa `getDisplayMedia` — **pixels, sem DOM**. Seletor e HTML do
elemento só existem pela **extensão Chrome**. Não tente tirar seletor da gravação
de tela.

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

3. **Pelo link** (botão "Buscar seletores pelo link"): `POST /elementos {url}` abre
   a página na ponte e cataloga os interativos; o Print casa pelo **rótulo** que a
   descrição já extraiu e preenche o seletor. Só serve para **página pública** —
   atrás de login não alcança.

`elementos.js` **precisa** do user-agent de Chrome real: sem ele, loja grande
serve a página de "navegador não suportado" e o catálogo volta com 5 links
inúteis (medido no Pontofrio: 5 elementos sem UA, 261 com). Ajustável por `PONTE_UA`.

A lista `CLICAVEIS` em `elementos.js` espelha `clicavel()` do `content.js` da
extensão. Mudou uma, mude a outra: o casamento por rótulo depende de as duas
verem os mesmos elementos.

## Idioma

Código, commits e UI em **português**. Mensagens de commit descrevem o efeito para
o usuário, não o arquivo mexido (ver `git log`).
