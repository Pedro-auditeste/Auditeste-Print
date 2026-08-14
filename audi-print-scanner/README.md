# Audi Print · Scanner de acessibilidade

Extensão de Chrome que registra o clique manual com seletor HTML real e captura
o par **Antes/Depois**. Também roda **axe-core** na aba aberta. O Print não
consegue ler o elemento só pela gravação, porque `getDisplayMedia` entrega
pixels, não DOM.

```
Abrir página  ─┐
Executar fluxo ├─ extensão (aqui)
Executar axe  ─┘
      ↓  arquivo .json
Identificar violações ─┐
Classificar severidade ├─ Audi Print
Gerar evidência        │
Consolidar no relatório┘
```

## Instalar

1. Abra `chrome://extensions`
2. Ligue **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** e aponte para esta pasta
4. Fixe a extensão na barra, se quiser

## Usar

### Evidência manual com ID

1. Abra o site a testar e clique na extensão → **Iniciar**.
2. Mantenha a aba visível e execute o fluxo normalmente.
3. Clique na extensão → **Parar** → **Exportar JSON**.
4. No Audi Print: **Nova gravação → + Importar JSON da extensão**.
5. Os pares entram agrupados; as descrições são geradas pela ponte sem bloquear
   o salvamento.

### Acessibilidade

1. Chegue ao estado da tela que quer avaliar.
2. Clique na extensão → **Analisar esta página**.
3. No Audi Print, importe o JSON no mesmo botão.

Cada violação vira um passo de evidência com severidade, regra, descrição e o
seletor do elemento.

## O que ele analisa

O **estado atual da tela**, não o site inteiro. Isso é proposital: é o que
permite avaliar acessibilidade depois do login, com o modal aberto, com o
formulário em erro — os estados que um scan por URL não alcança.

Para cobrir várias telas, rode uma vez em cada estado e importe os arquivos no
mesmo registro.

## Limitações

- Não funciona em páginas internas do navegador (`chrome://`, Web Store)
- Em páginas `file://` só funciona se você marcar "Permitir acesso a URLs de
  arquivo" nos detalhes da extensão
- Enxerga apenas o que está renderizado: conteúdo ainda não carregado, ou
  escondido atrás de uma aba fechada, não é avaliado
- axe-core cobre cerca de um terço dos critérios da WCAG. O resto continua
  exigindo avaliação humana

## Conteúdo

| Arquivo | O quê |
|---|---|
| `manifest.json` | Manifest V3 e permissões da captura |
| `content.js` | Lê o elemento acionado e monta `#id`/atributo/xpath |
| `background.js` | Vincula e guarda os prints Antes/Depois |
| `popup.html` / `popup.js` | Inicia, encerra e exporta a sessão; também roda axe |
| `axe.min.js` | axe-core 4.13.0, da Deque (MPL-2.0), embutido |

## Teste manual roteirizado

1. Recarregue a extensão em `chrome://extensions`.
2. Abra um site com navegação por abas e inicie uma sessão.
3. Clique em uma aba ou botão com `id`, aguarde um segundo e encerre.
4. Exporte e importe o JSON em uma nova gravação do Audi Print.
5. Confirme: duas imagens no mesmo passo, seletor `#id`, timestamps, URLs e
   descrição em português. Desative a ponte para verificar que os prints ainda
   são salvos e o botão **Gerar descrição** aparece.
