# Print · Segurança, o pacote

Este é o índice. Segurança, TI, Jurídico ou Compras de um cliente chega aqui e sabe qual documento abrir sem ler o repositório inteiro.

Escrito a partir do código, não da intenção. Cada afirmação nos documentos tem um teste ou um comando que a demonstra.

Atualizado em 25/08/2026.

---

## Por onde começar, pelo que você faz

| Se você é | Comece por |
|---|---|
| Segurança da Informação | [Arquitetura](seguranca-arquitetura.md), depois [Evidências](seguranca-evidencias.md) e [Pentest](seguranca-pentest.md) |
| TI / Infra | [Arquitetura](seguranca-arquitetura.md) e [Subir o cofre](subir-o-cofre.md) |
| Jurídico / Privacidade | [LGPD](seguranca-lgpd.md) e a parte de dados do [FAQ](seguranca-faq.md) |
| Compras / Fornecedores | [FAQ](seguranca-faq.md), que traz o questionário padrão respondido |
| Quem só quer uma resposta rápida | [FAQ](seguranca-faq.md) |

---

## Os documentos

### O que respondem os questionários

- **[FAQ e questionário de fornecedor](seguranca-faq.md)**: as perguntas que sempre voltam (onde ficam os dados, são cifrados, quem acessa, tem SSO, como se exclui) com resposta oficial, mais um questionário de assessment já preenchido. Existe para que cada oportunidade não gere uma resposta diferente.

### Como o produto é por dentro

- **[Arquitetura de segurança e fluxo do dado](seguranca-arquitetura.md)**: os componentes, as fronteiras de confiança e o caminho do dado, da captura até a exclusão. O "entenda o produto sem ler o código".
- **[Segredos e chaves](segredos-e-chaves.md)**: cada segredo do sistema, para que serve e o que acontece se perder.
- **[Subir o cofre](subir-o-cofre.md)**: o runbook: variáveis de ambiente, volume, como colocar no ar.

### A prova

- **[Evidências dos controles](seguranca-evidencias.md)**: para cada controle afirmado, o teste ou comando que o demonstra. O princípio é "afirmação sem evidência é só declaração", então esta tabela é a diferença entre dizer e mostrar.
- **[Pentest interno](seguranca-pentest.md)**: o ataque manual ao sistema em execução: os achados, as correções, e o que resistiu. Diz também o que só um pentest independente encontraria.
- **[Escopo para pentest independente](seguranca-pentest-escopo.md)**: o que pedir a uma firma de fora, com que regras e quais entregáveis, para contratar o teste que fecha o item.

### Processo e conformidade

- **[Ciclo de desenvolvimento seguro](seguranca-sdlc.md)**: como uma mudança chega à produção sem furar um controle: o que roda no CI e o que falta impor.
- **[Resposta a incidentes](seguranca-incidentes.md)**: o que a equipe faz quando algo dá errado com dado de cliente, em sete etapas, cada uma com a ação que a ferramenta já permite.
- **[LGPD operacional](seguranca-lgpd.md)**: o registro do tratamento de dado pessoal (RoPA): papéis, dados, finalidade, retenção, descarte e subprocessadores.
- **[Política de vulnerabilidades](seguranca-vulnerabilidades.md)**: como uma falha é tratada da descoberta ao fechamento, com prazo por gravidade e a prova de que fechou.
- **[Revisões periódicas](seguranca-revisoes.md)**: de quanto em quanto tempo a postura é reavaliada, o que se olha em cada volta, e o comando que roda a parte técnica.

### Histórico

- **[Diagnóstico do Marco 1](seguranca-marco-1-diagnostico.md)**: onde o Print estava antes deste trabalho, e o que faltava. Contexto, não estado atual.

---

## Como conferir por conta própria

Nada aqui pede confiança cega. Da raiz do projeto:

```bash
cd auditeste-a11y && node teste-cofre.js && node teste-cifra.js && node teste-injecao.js && node teste-ssrf.js && node teste-backup.js
```

O estado de produção, sem autenticação, em qualquer terminal:

```bash
curl -s https://audiprint.up.railway.app/ping
```

A varredura dinâmica contra o ambiente no ar, só com o que não grava nada:

```bash
cd auditeste-a11y && node dast.js https://audiprint.up.railway.app
```

---

## O que está em aberto, reunido num lugar

Ser honesto sobre isto é parte do controle. Detalhe em cada documento; aqui, o resumo.

| Item | Onde é tratado | De quem depende |
|---|---|---|
| Pentest independente | [pentest](seguranca-pentest.md) | Contratar terceiro |
| Segundo revisor (para a aprovação valer também ao admin) | [SDLC](seguranca-sdlc.md) | Entrar mais gente na equipe |
| Egress filtering (fecha o residual da SSRF) | [pentest](seguranca-pentest.md) | Infra na Railway |
| DPO, DPA por cliente, prazo de retenção contratual | [LGPD](seguranca-lgpd.md) | Negócio e Jurídico |
| Ensaio do plano de incidentes | [incidentes](seguranca-incidentes.md) | Exercício da equipe |
| Dados fora do Brasil (Railway US West) | [LGPD](seguranca-lgpd.md) | Decisão de infraestrutura |
