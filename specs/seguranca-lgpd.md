# Print · LGPD operacional

Marco 2, item 12. O registro de como o Print trata dado pessoal: o que entra, para quê, por quanto tempo, quem responde e quem mais toca no dado.

Serve de base para o RoPA (Registro das Operações de Tratamento) que a LGPD espera do operador, e para responder à parte de privacidade dos questionários de cliente sem improvisar.

Escrito a partir do sistema real. Onde a decisão é do cliente ou ainda não foi tomada, o texto diz.

Atualizado em 25/08/2026.

---

## Papéis, e por que isto importa antes de tudo

Na LGPD, quem decide a finalidade é **controlador**; quem trata em nome dele é **operador**. A distinção define de quem é cada dever.

No Print, o dado tratado é evidência de teste do sistema **do cliente da Auditeste**. Quem decide o que testar, o que capturar e por que é o cliente. Então:

- **Controlador:** o cliente da Auditeste (a empresa cujo sistema é testado).
- **Operador:** a Auditeste, que trata a evidência para prestar o serviço de QA.
- **Suboperadores:** os terceiros que a Auditeste usa para operar (adiante).

Isto não é detalhe jurídico solto: é o que decide quem responde ao titular, quem comunica incidente e quem define retenção. A Auditeste, como operadora, segue a instrução do controlador e responde solidariamente pelo que trata.

---

## Quais dados são tratados

A evidência é técnica, não cadastral. O Print não pede nome, e-mail ou documento de ninguém para montar a prova. Mas a tela capturada pode conter dado pessoal de quem usa o sistema testado, sem que o Print o trate como campo.

| Categoria | Exemplo | Como entra |
|---|---|---|
| Imagem de tela | Print antes e depois de cada passo | Captura do consultor |
| Contexto do passo | Elemento acionado, seletor, trecho de HTML, URL, texto digitado | Captura do consultor |
| Dado pessoal incidental | Nome, e-mail ou outro que apareça **na tela testada** | Vem junto no print, não é campo |
| Identidade de acesso | E-mail e senha de quem usa o Print (o consultor), papel na equipe | Cadastro no cofre |

Duas salvaguardas de origem, com teste:

- Valores de **senha, CPF, CNPJ e cartão nunca são gravados como evidência** (`teste-privacidade.js`).
- A imagem da tela, onde mora o dado sensível de verdade, é **cifrada em repouso** com AES-256-GCM (`teste-cifra.js`). Metadados (nome de projeto, título de passo, URL) ficam em texto.

---

## Finalidade

Único fim: **comprovar a execução de um teste de acessibilidade e qualidade** no sistema do cliente. A evidência existe para mostrar, depois, o que foi testado e o que se viu.

Não há tratamento para perfil, publicidade, treino de modelo próprio ou revenda. O dado não é usado para nada além de ser a prova do teste que o gerou.

---

## Base legal

Como operadora, a Auditeste trata sob a base que o controlador (cliente) define para a operação dele. Para o serviço de QA contratado, a base típica é a **execução de contrato** entre a Auditeste e o cliente, e o **legítimo interesse** do cliente em comprovar a qualidade do próprio sistema. A definição final é do controlador e entra no contrato.

---

## Retenção

| Dado | Prazo | Onde se define |
|---|---|---|
| Evidência (print, contexto) | 90 dias por padrão, configurável por cliente | `retencao_dias` por cliente no banco |
| Registro de auditoria | Permanece após a exclusão da evidência | Para que a exclusão continue comprovável |
| Identidade de acesso (conta) | Enquanto a conta existir | Removida ao excluir o cliente |

A exclusão da evidência é **automatizada**: uma varredura roda de hora em hora e apaga o que venceu, o metadado e o arquivo juntos, sem deixar objeto órfão (`teste-cofre.js`, `teste-backup.js`). O prazo **contratual** por cliente, o número que vale juridicamente, ainda não está fechado (ver "Aberto").

---

## Descarte

- **Por vencimento:** a varredura de retenção apaga metadado e arquivo cifrado juntos.
- **A pedido:** a exclusão total de um cliente (`/api/tenant/excluir-tudo`, só admin) remove dado e objeto de uma vez, irreversível.
- **O registro de auditoria permanece** de propósito, para que "foi excluído" continue sendo algo que se prova. Ele não guarda conteúdo de print, só o fato do evento.

---

## Onde o dado fica, e quem mais toca nele

Enquanto está no navegador do consultor, a evidência não saiu da máquina. Ao enviar ao cofre, ela passa a residir num banco em volume gerenciado na Railway, **Estados Unidos, região US West**. Transferência internacional, então, e o contrato com o controlador precisa cobrir isso.

Suboperadores (subprocessadores):

| Terceiro | Para quê | Trata dado pessoal? |
|---|---|---|
| Railway | Hospedagem e armazenamento do cofre | Sim, o dado em repouso |
| NVIDIA | Descrição automática das telas | Sim, quando a descrição está ligada: o print, o trecho de HTML e a URL vão para lá |

A descrição automática é **opt-in**: só envia à NVIDIA quando ligada. Desligada, nenhum dado sai para descrição.

---

## Direitos do titular

O titular (a pessoa cujo dado aparece na tela) exerce direitos junto ao **controlador**, o cliente da Auditeste. Como operadora, a Auditeste dá o suporte técnico para atender:

- **Confirmação e acesso:** a auditoria mostra o que foi tratado e quando; a evidência em si é recuperável enquanto não venceu.
- **Exclusão:** por vencimento automático, ou a pedido pela exclusão total do cliente.
- **Correção e portabilidade:** a evidência é um registro histórico de um teste, não um cadastro editável; correção que altere a prova descaracteriza a evidência. Pedidos assim passam pelo controlador.

---

## Segurança do tratamento

Resumo do que protege o dado, cada item com prova no `seguranca-evidencias.md`:

- isolamento entre clientes com o identificador da equipe obrigatório em toda consulta;
- cifra em repouso da imagem, HTTPS obrigatório em trânsito;
- acesso por conta, com papéis e limite por papel;
- auditoria por cliente;
- retenção e descarte automatizados;
- análise estática, teste dinâmico e pentest interno.

---

## Aberto, e é honesto dizer

| Item | Situação |
|---|---|
| Encarregado de dados (DPO) | Não designado formalmente |
| Prazo de retenção contratual por cliente | O sistema aplica o que for configurado; o número que vale por contrato não está fechado |
| Contrato de operador (DPA) com cada cliente | Modelo não anexado a este documento; a definição de base legal e retenção mora nele |
| Cláusula de transferência internacional | Necessária porque o dado fica nos EUA; depende do contrato |
| Dados fora do Brasil | Railway US West. Mudar de região é decisão de infraestrutura e custo |

Nenhum tratamento de dado real de cliente até hoje. Este registro é preventivo, para existir antes do primeiro, que é quando ele passa a valer.
