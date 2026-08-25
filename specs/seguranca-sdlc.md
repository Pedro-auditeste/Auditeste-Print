# Print · Ciclo de desenvolvimento seguro

Marco 2, item 7. Como uma mudança de código chega à produção sem furar a segurança do que já existe. O objetivo não é burocracia: é que nenhuma alteração desfaça, por descuido, um controle que custou a existir.

Escrito a partir do que roda hoje. Onde o controle depende de um ajuste que ainda não foi ligado, o texto diz, e diz de quem é.

Atualizado em 25/08/2026.

---

## O princípio

Todo controle de segurança deste sistema tem um teste que falha se o controle sumir. Essa é a regra que sustenta todas as outras: a correção de um achado não está pronta sem o teste que a tranca. Um controle sem teste é uma intenção, e intenção não sobrevive à próxima refatoração.

São 32 arquivos de teste, dos quais os de segurança (`teste-cofre`, `teste-cifra`, `teste-injecao`, `teste-sso`, `teste-ssrf`, `teste-backup`, `teste-privacidade`, `teste-seguranca`) trancam isolamento, cifra, prompt injection, SSO, fronteira de saída, backup e privacidade.

---

## O que roda a cada mudança

Dois fluxos de CI, em `.github/workflows/`.

### `seguranca.yml`

| Tarefa | O que faz | Quando |
|---|---|---|
| dependencias | `npm audit`; falha o build só em vulnerabilidade **crítica** | push, PR, semanal |
| segredos | Procura chave e segredo em **toda a história** do git | push, PR, semanal |
| dast | Varredura dinâmica contra alvo local; contra produção no agendado | push, PR, semanal |
| testes | Os testes de segurança que não precisam de navegador | push, PR |

### `codeql.yml`

Análise estática (SAST) com CodeQL, conjunto `security-extended`, em push, PR e semanalmente. O conjunto estendido de propósito: o padrão é conservador demais para um sistema que guarda evidência de cliente.

Por que semanal, além de a cada mudança: dependência vulnerável e a maioria dos achados de varredura aparecem quando alguém publica o aviso, não quando a gente mexe no código. Rodar só no push deixaria escapar o que surge sozinho.

---

## As etapas que o Epic pede

### Revisão de pull request

**Regra:** mudança vai para `main` por pull request, e o PR só funde depois de revisão de outra pessoa e do CI verde.

**Situação:** a prática existe, mas a **obrigatoriedade não está imposta pela ferramenta**. Ligar o *branch protection* do GitHub em `main` (exigir PR, exigir revisão aprovada, exigir os checks de `seguranca.yml` e `codeql.yml` passando) é um ajuste de configuração do repositório, não de código, e é ação do dono do repositório. Enquanto não estiver ligado, a revisão depende de disciplina, e disciplina não é controle.

### Dependency scanning

Feito. `npm audit` no CI, a cada push e semanal, com resumo por severidade. Ver `seguranca-evidencias.md`.

### Secret scanning

Feito. Varredura sobre toda a história do git, com os padrões que já apareceram no projeto mais os genéricos. Nenhum segredo no repositório, verificado.

### SAST

Feito. CodeQL `security-extended`. Já encontrou e derrubou um vazamento de erro interno em produção. Ver `seguranca-pentest.md`.

### Atualização de bibliotecas

**Parcial.** O scanning aponta 22 vulnerabilidades conhecidas, 6 altas, **todas na cadeia do navegador headless** usado nos scans de acessibilidade (puppeteer, lighthouse, pa11y). A correção exige mudança de versão maior, que muda o comportamento do scan e precisa de teste próprio. Registradas e não escondidas; a correção é trabalho planejado, não pendência esquecida. O build falha só em vulnerabilidade crítica, de propósito: falhar todo dia por algo conhecido e sem correção pronta ensina o time a ignorar o alarme, que é o pior resultado.

### Checklist de segurança

Feito, e é o `seguranca-evidencias.md`: cada controle afirmado nos outros documentos com o teste ou o comando que o demonstra. A regra que o mantém honesto: controle que perde o teste perde a linha na tabela.

---

## Separação entre ambientes e segredos

Segredo nunca no código, sempre em variável de ambiente, verificado pela varredura de história. Ambiente local (loopback) e produção se comportam diferente de propósito: o portão de login, o token da ponte e o freio por origem existem só no servidor exposto, porque em `127.0.0.1` quem alcança a página já está na máquina. Ver `segredos-e-chaves.md` e `subir-o-cofre.md`.

Rotação de segredo é manual hoje: girar `COFRE_SEGREDO`, `PONTE_TOKEN` ou a chave de cifra é uma troca de variável na Railway. Rotação automatizada não existe.

---

## O que fica aberto, e de quem é

| Item | Situação | De quem |
|---|---|---|
| Revisão de PR obrigatória | Praticada, não imposta | Ligar branch protection no GitHub: dono do repositório |
| 22 dependências vulneráveis | Conhecidas, registradas | Subir versão maior dos motores de scan, com teste: trabalho de engenharia planejado |
| Rotação automática de segredos | Manual | Decisão de operação |

Os controles automatizados do ciclo (scan de dependência, de segredo, SAST, DAST, testes) rodam. O que falta é imposição de processo (branch protection) e remediação de dívida conhecida (as dependências), e nenhum dos dois se resolve escrevendo mais código de aplicação.
