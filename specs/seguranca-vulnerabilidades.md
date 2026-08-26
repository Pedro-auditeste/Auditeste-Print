# Print · Política de vulnerabilidades

Marco 3, item política de vulnerabilidades. Como uma falha de segurança é tratada da descoberta ao fechamento: quem tria, em quanto tempo se corrige por gravidade, como se prova a correção, e como uma falha vinda de fora é recebida.

Escrita a partir do que o sistema já faz. Onde o processo depende de algo que ainda não existe, o texto diz.

Atualizado em 26/08/2026.

---

## Vulnerabilidade não é incidente

A distinção decide qual documento vale.

- **Vulnerabilidade** é uma falha encontrada **antes** de causar dano: um `npm audit` que acende, um achado do CodeQL, uma sonda do DAST que passa, um aviso de fora. Este documento cobre isso.
- **Incidente** é quando dado de cliente **pode ter sido** acessado, alterado ou exposto. Aí vale o `seguranca-incidentes.md`.

Uma vulnerabilidade explorada vira incidente. Enquanto não foi, ela é tratada aqui, com prazo e prova, para não chegar a ser.

---

## De onde uma vulnerabilidade aparece

Nenhuma dessas fontes depende de alguém lembrar de olhar; todas rodam sozinhas ou chegam.

| Fonte | O que acha | Cadência |
|---|---|---|
| `npm audit` no CI | Dependência com aviso publicado | A cada envio e semanal |
| Secret scanning no CI | Credencial na história do git | A cada envio e semanal |
| CodeQL (SAST) | Caminho de dado perigoso no código | A cada envio e semanal |
| `dast.js` (DAST) | Falha na aplicação em execução | A cada envio; contra produção, semanal |
| Pentest interno | Falha de lógica que a ferramenta não vê | Pontual (`seguranca-pentest.md`) |
| Aviso de fora | O que ninguém aqui viu | A qualquer hora |

---

## Triagem e prazo de correção

A gravidade decide o prazo, não o contrário. Mesma escala do pentest, agora com prazo.

| Gravidade | O que é | Prazo para corrigir |
|---|---|---|
| Crítica | Dá para chegar a dado de cliente, ou executar ação, sem credencial | Imediato, no mesmo dia. O build já falha sozinho nela |
| Alta | Precisa de uma conta qualquer, mas daí alcança o que não é dela, ou a infraestrutura | Até 7 dias |
| Média | Enfraquece uma defesa, ou entrega informação que ajuda o próximo passo | Até 30 dias |
| Baixa | Higiene. Sozinha não leva a lugar nenhum | No ciclo normal de trabalho |

Na dúvida entre dois níveis, vale o mais grave. Quando a correção de uma alta ou crítica não couber no prazo (por exemplo, depender de uma versão maior de terceiro que ainda não saiu), o motivo e a data prevista ficam registrados, e uma mitigação temporária entra no lugar. Prazo estourado sem registro é o começo do controle virar teatro.

---

## Correção, e a prova de que fechou

Toda correção de vulnerabilidade **deixa um teste que falha se ela voltar**. É a mesma regra que sustenta o resto do sistema: enquanto o teste não existe, a vulnerabilidade não está corrigida, está pausada. Foi assim com a SSRF (`teste-ssrf.js`), com o vazamento de erro que o CodeQL achou, e com cada sonda do `dast.js`.

Sem esse teste, o fechamento não é auditável e a regressão é questão de tempo.

---

## Dependências

O caminho mais comum de vulnerabilidade aqui é uma biblioteca de terceiro. A política:

- O build **falha em vulnerabilidade crítica** de dependência, automaticamente.
- O alvo é **manter o `npm audit` em zero**. Hoje está em zero.
- Vulnerabilidade conhecida sem correção pronta (versão maior ainda não lançada) fica **registrada, não escondida**, com a razão. Falhar o build todo dia por algo que não dá para consertar ensina o time a ignorar o alarme.
- **Recomendado, ainda não ligado:** Dependabot, para abrir PR automático quando surgir aviso novo, com o CI validando antes de fundir. Mantém o zero sem depender de memória.

---

## Falha vinda de fora

Quem encontrar uma falha no Print precisa de um jeito de avisar sem virar inimigo.

- **Compromisso:** relato de boa-fé não gera retaliação. Quem avisa está ajudando.
- **Resposta:** o recebimento é confirmado em até 3 dias úteis, e a pessoa é informada do desfecho.
- **Divulgação coordenada:** a falha é corrigida antes de ser tornada pública, num prazo combinado com quem reportou.
- **Canal:** o `SECURITY.md` na raiz do repositório traz o contato e estas regras, e o GitHub o mostra como "Security policy". Falta ainda um `security.txt` servido pela aplicação, que é o próximo passo menor.

---

## Quando a vulnerabilidade já foi explorada

Se a triagem indicar que a falha pode ter sido usada contra dado de cliente, ela deixa de ser só vulnerabilidade e o `seguranca-incidentes.md` assume: contenção, investigação e comunicação ao cliente entram com os prazos de lá.

---

## Registro e revisão

Cada vulnerabilidade de gravidade alta ou crítica fica registrada: o que era, como foi achada, o que a corrigiu, e o teste que a tranca. Esta política é revista quando algo nela falha na prática, e no mínimo junto com a revisão periódica de segurança.

---

## Evidência

| Afirmação | Onde se vê |
|---|---|
| O build falha em crítica de dependência | `.github/workflows/seguranca.yml` |
| SAST, secret scan e DAST rodam sozinhos | `seguranca-evidencias.md` |
| Correção deixa teste que trava | `teste-ssrf.js`, `dast.js`, `seguranca-pentest.md` |
| `npm audit` em zero | `cd auditeste-a11y && npm audit` |
