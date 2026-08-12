# Audi Print · Scanner de acessibilidade

Extensão de Chrome que roda **axe-core** na aba aberta e baixa o JSON no formato
que o Audi Print importa. Fecha os três primeiros passos do fluxo — os que o
Print não consegue fazer sozinho, porque grava por `getDisplayMedia` e recebe
imagem, não DOM.

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

1. Navegue até a página e **execute o fluxo** — faça login, abra o modal,
   preencha o formulário, chegue no estado que você quer avaliar
2. Clique no ícone da extensão → **Analisar esta página**
3. Salve o `.json`
4. No Audi Print: **Nova gravação → + Importar acessibilidade**

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
| `manifest.json` | Manifest V3, permissões `activeTab`, `scripting`, `downloads` |
| `popup.html` / `popup.js` | Botão, injeção do axe e download do resultado |
| `axe.min.js` | axe-core 4.13.0, da Deque (MPL-2.0), embutido |
