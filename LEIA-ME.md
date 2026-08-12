# Acessibilidade · Auditeste

Três peças que se encaixam. O scan acontece fora, a evidência se consolida no
Print.

```
audi-print-scanner/   escaneia o que está na tela (extensão de Chrome)
auditeste-a11y/       escaneia por linha de comando e em fluxo autenticado
audi-print/           recebe o JSON e vira relatório de evidência
```

---

## 1. audi-print/ — o gravador de evidências

`evidencias-auditeste.html`. Arquivo único, sem instalação: **duplo clique e
abre**. Guarda tudo no navegador (IndexedDB) da própria máquina.

**Novidades desta entrega**

- **Gerar cenários de teste** no registro arquivado — monta o Gherkin a partir da
  ficha, dos passos anotados e das violações importadas. **Sem chave, sem rede,
  sem IA**: roda dentro do arquivo. Fica salvo no registro e vai no HTML exportado.
  Ele estrutura o que você anotou — não olha a captura para inferir comportamento,
  e o que faltar vira uma seção `# A confirmar` em vez de afirmação inventada
- **Escanear acessibilidade** no gravador — campo de URL e um botão por
  ferramenta. Escaneia e importa sem sair do Print (precisa de `npm run servidor`
  na pasta `auditeste-a11y`)
- **+ Importar acessibilidade** no gravador — lê JSON de axe-core, Pa11y ou
  Lighthouse e transforma cada violação num passo de evidência, com gravidade,
  regra e o seletor do elemento
- **Salvar em PDF** no registro arquivado — texto vetorial, nome do arquivo já
  vem como `EVD-0100 - Cliente`
- Tipos de teste **Acessibilidade** e **Usabilidade** na ficha
- O próprio Print foi corrigido: campos e selects sem nome acessível, avisos que
  mudavam em silêncio, conteúdo fora de landmark

**Se a gravação de tela falhar** abrindo por `file://`, sirva por localhost:

```bash
cd audi-print && python -m http.server 8080
```

E abra `http://localhost:8080/evidencias-auditeste.html`.

---

## 2. audi-print-scanner/ — a extensão

Escaneia **o estado que está na tela**: depois do login, com o modal aberto, com
o formulário em erro. É o que scan por URL não alcança.

**Instalar:** `chrome://extensions` → ligar **Modo do desenvolvedor** →
**Carregar sem compactação** → apontar para esta pasta.

**Usar:** navegue, execute o fluxo, clique no ícone → *Analisar esta página* →
salve o JSON → importe no Print.

Não precisa de `npm install`: o axe-core já vem embutido.

---

## 3. auditeste-a11y/ — o toolkit e a ponte

Precisa instalar uma vez:

```bash
cd auditeste-a11y
npm install
npx playwright install chromium
npx puppeteer browsers install chrome
```

Baixa mais de 400 MB de navegadores. Depois:

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
| `fluxo` | Playwright + axe | percurso autenticado, escaneia em cada parada |
| `servidor` | ponte local | liga os botões de scan dentro do Print |

### Escanear sem sair do Print

```bash
npm run servidor
```

Ou dê **duplo clique em `ponte.cmd`**, que sobe a ponte numa janela própria.

A ponte serve **só aos três botões de scan por URL**. Todo o resto do Print —
gravação, importação de JSON, geração de cenários, PDF, export — funciona com o
arquivo sozinho.

### Por que os scans precisam de ponte e o resto não

Uma página não consegue ler o DOM de outro site: é a política de mesma origem do
navegador. Para escanear `sistema.cliente.com`, alguém precisa abrir aquela
página com acesso ao DOM dela — a extensão ou um processo Node.

Sem ponte, o caminho é: **extensão escaneia → baixa o JSON → importa no Print**.

Deixe a janela aberta. No gravador do Print abra **Escanear acessibilidade**,
informe a URL e clique em `axe-core`, `Pa11y` ou `Lighthouse`. O resultado entra
direto como passo de evidência — sem baixar nem importar arquivo.

Página em navegador não executa Node; a ponte existe só para vencer isso. Ela
escuta apenas em `127.0.0.1`, mas navega para qualquer URL que pedirem: deixe
ligada só enquanto usa.

Com a ponte desligada o Print avisa e continua funcionando normalmente.

**fluxo.js** é o que a extensão não faz: você escreve o percurso uma vez e ele
roda sozinho a cada release. Edite `entrar()` com os seletores do login e
`PARADAS` com os estados a avaliar.

```bash
BASE=https://sistema.cliente.com A11Y_USUARIO=qa@cliente.com A11Y_SENHA=xxx npm run fluxo
```

Senha por variável de ambiente. Não escreva credencial no arquivo.

---

## Qual usar quando

| Situação | Ferramenta |
|---|---|
| Escanear uma URL sem sair do Print | botões + `npm run servidor` |
| Auditoria pontual, qualquer estado, sem setup | extensão |
| Nota para colocar no relatório | `npm run nota` |
| Site público com muitas páginas | `npm run pa11y` |
| Cliente recorrente, regressão a cada release | `npm run fluxo` |
| Fluxo crítico (checkout, cadastro) | NVDA, na mão |

---

## O teste

`relatorio-teste.html` — as quatro ferramentas executadas de ponta a ponta, com
a saída real de cada comando, as violações encontradas e um print do Audi Print
com tudo importado. Última execução: **4/4, 29 passos importados, zero falha**.

Para repetir: `cd auditeste-a11y && node teste.js`

---

## Limites, ditos na cara

- axe-core pega o que é verificável por máquina: rótulo, contraste, ARIA,
  estrutura. **Ordem lógica de foco, clareza da mensagem de erro e compreensão
  do fluxo continuam exigindo pessoa.**
- Nada disso alcança **tela nativa Android**. Para Appium em `View` nativa o
  caminho é outro.
- Usabilidade não está automatizada, e é de propósito. O que existe é coleta de
  evidência; o julgamento continua sendo de quem entende.
