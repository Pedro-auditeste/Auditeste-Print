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

**Situação:** ligado. O *branch protection* do GitHub em `main` exige pull request com 1 aprovação, com aprovação velha descartada a cada novo push, e exige os cinco checks verdes (`dependencias`, `segredos`, `dast`, `testes` e o CodeQL) com o ramo atualizado. Force push e exclusão do ramo estão bloqueados, e conversas de revisão precisam ser resolvidas antes de fundir.

Uma ressalva honesta: `enforce_admins` está desligado de propósito, porque hoje há um único mantenedor e no GitHub ninguém aprova o próprio PR. Isso permite ao administrador fundir por bypass, do contrário o mantenedor solo se trancaria fora. A regra vale plena para qualquer pessoa que entrar sem ser admin, e passa a valer para todos quando houver um segundo revisor. Até lá, a revisão de outra pessoa é a lacuna que resta, não a imposição do fluxo.

### Dependency scanning

Feito. `npm audit` no CI, a cada push e semanal, com resumo por severidade. Ver `seguranca-evidencias.md`.

### Secret scanning

Feito. Varredura sobre toda a história do git, com os padrões que já apareceram no projeto mais os genéricos. Nenhum segredo no repositório, verificado.

### SAST

Feito. CodeQL `security-extended`. Já encontrou e derrubou um vazamento de erro interno em produção. Ver `seguranca-pentest.md`.

### Atualização de bibliotecas

**Feito.** As 22 vulnerabilidades conhecidas (6 altas), **todas na cadeia do navegador headless** usado nos scans de acessibilidade, foram corrigidas. Eram duas advisories só, infladas pela árvore: o `extract-zip` (symlink traversal) vindo do puppeteer, e o OpenTelemetry (memória em W3C Baggage) vindo do lighthouse. A correção subiu puppeteer 24 para 25 e lighthouse 12 para 13, e como o pa11y ainda fixa puppeteer 24, um `override` no `package.json` força o pa11y a usar o mesmo puppeteer 25, tirando o `extract-zip` de vez.

Mudança de versão maior muda o comportamento do scan, então não foi um `npm update` cego: depois do bump, os três motores (axe, pa11y, lighthouse) foram exercitados com scan real e o fluxo de navegador voltou verde. O puppeteer 25 tornou a descoberta do Chrome assíncrona, o que exigiu ajuste no código que resolve o caminho do Chrome, coberto pelo teste de navegador.

O build ainda falha só em vulnerabilidade crítica, de propósito: falhar todo dia por algo conhecido e sem correção pronta ensina o time a ignorar o alarme, que é o pior resultado.

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
| Revisão por outra pessoa | Fluxo imposto (PR + CI + 1 aprovação); admin pode bypass enquanto for mantenedor solo | Entrar um segundo revisor para a regra valer para todos |
| Rotação automática de segredos | Manual | Decisão de operação |

Os controles automatizados do ciclo (scan de dependência, de segredo, SAST, DAST, testes) rodam, o fluxo de PR agora é imposto pela ferramenta, e a dívida de dependência está zerada. O que falta é um segundo revisor, para a aprovação valer também para o administrador, e isso não se resolve escrevendo código.
