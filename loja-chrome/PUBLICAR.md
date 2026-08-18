# Publicar na Chrome Web Store

Tudo o que a ficha pede está aqui, pronto para copiar e colar. **A publicação em
si é você quem faz**: exige conta Google de desenvolvedor, pagamento da taxa e
aceite dos termos, e nada disso pode ser feito no seu lugar.

## Antes de começar

1. Acesse https://chrome.google.com/webstore/devconsole
2. Entre com a conta Google que será a dona da extensão (use uma conta da
   empresa, não pessoal: trocar de dono depois dá trabalho)
3. Pague a taxa única de **US$ 5**, cobrada uma vez por conta, para sempre
4. Aceite o contrato de desenvolvedor

## O pacote

Baixe o .zip pronto em https://audiprint.up.railway.app/extensao.zip
Ele já tem o `manifest.json` na raiz, os ícones e a versão 2.1.0. É o arquivo que
você envia em **Novo item → Escolher arquivo**.

## Ficha da loja

**Nome**
```
Audi Print · Captura de evidências de teste
```

**Descrição curta** (132 caracteres no máximo)
```
Registra cada interação do teste com o xpath do elemento e o print antes/depois. Evidência pronta, sem montar nada à mão.
```

**Descrição completa**
```
O Audi Print resolve um problema chato de quem testa software: a evidência.

Você inicia a sessão e testa a aplicação normalmente. Cada interação vira um
passo registrado, com a captura da tela antes e depois e, principalmente, com o
xpath do elemento em que você mexeu. Nada é digitado à mão e nada é adivinhado:
o xpath é lido do próprio HTML da página.

O que é registrado:

• Clique em botões, links e abas
• Preenchimento de campos, com o valor digitado
• Limpeza de campos
• Marcação e desmarcação de caixas e opções
• Leitura de texto, quando você seleciona um trecho com o mouse

Cada passo traz o xpath, o HTML do elemento, o rótulo visível, o endereço da
página antes e depois, e o par de imagens com o elemento destacado em vermelho.

Além disso, um clique roda o axe-core na página aberta e exporta as violações de
acessibilidade em JSON.

Depois de testar, abra o Audi Print e traga a captura com um clique. A evidência
sai montada, pronta para o relatório, e o xpath vai direto para o script de
automação em Selenium, Playwright ou Cypress.

Campos de senha nunca têm o valor registrado. Tudo fica no seu computador: a
extensão não tem servidor e não envia nada por conta própria.
```

**Categoria**: Ferramentas do desenvolvedor
**Idioma**: Português (Brasil)

**URL da política de privacidade**
```
https://audiprint.up.railway.app/privacidade.html
```

**Site oficial**
```
https://audiprint.up.railway.app
```

**URL de suporte** (não use o mesmo da página inicial, e não cole duas vezes)
```
https://audiprint.up.railway.app/inicio.html
```

## Imagens

| Arquivo | Onde entra |
|---|---|
| `../audi-print-scanner/icones/icone-128.png` | ícone da loja |
| `print-1-realce.png` | captura 1280x800 |
| `print-2-painel.png` | captura 1280x800 |
| `print-3-evidencia.png` | captura 1280x800 |

## Justificativa das permissões

A revisão pergunta o porquê de cada uma. Respostas prontas:

**Finalidade única**
```
Registrar evidências de teste de software: a interação do testador com a página,
o xpath do elemento correspondente e a captura da tela antes e depois.
```

**host_permissions `<all_urls>`**
```
O testador escolhe qual sistema vai testar, e esse endereço muda a cada projeto
e a cada cliente. Não há como declarar a lista de sites de antemão. O acesso é
usado apenas para ler o elemento com que o usuário interage e capturar a aba, e
somente depois que ele inicia a sessão naquela aba.
```

**tabs**
```
Capturar a imagem da aba em teste (captureVisibleTab) e registrar o endereço da
página antes e depois da interação, que é parte da evidência.
```

**scripting**
```
Injetar o axe-core na página aberta, sob comando do usuário, para o scan de
acessibilidade.
```

**downloads**
```
Salvar no computador do usuário o JSON com a evidência e o resultado do scan.
```

**storage**
```
Guardar a sessão de teste em andamento entre recarregamentos de página.
```

**unlimitedStorage**
```
Uma sessão guarda duas capturas de tela por passo, e o limite padrão estoura em
poucos passos. Sem isso a evidência é perdida no meio do teste.
```

**Uso remoto de código**: NÃO. Todo o código está no pacote.

## Declaração de uso de dados

Marque **apenas**: "Conteúdo do site" e "Atividade do usuário".
Depois marque as três caixas de confirmação:

- Não vendo nem transfiro dados a terceiros fora dos casos aprovados
- Não uso nem transfiro dados para fins não relacionados à finalidade única
- Não uso nem transfiro dados para avaliar crédito ou conceder empréstimos

Isso é verdade para esta extensão. Confira a política em `/privacidade.html`.

## Depois de enviar

A revisão costuma levar de um a alguns dias, e extensão com `<all_urls>` quase
sempre cai em análise manual, que demora mais. Quando sair, troque o botão do
Print de "Instalar complemento" para um link direto da loja.
