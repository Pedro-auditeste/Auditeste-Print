# Print · Revisões periódicas de segurança

Marco 3, item revisões periódicas. Segurança não é um estado que se atinge e guarda: um teste que passa hoje não prova nada em seis meses, uma dependência limpa hoje ganha um aviso amanhã, e uma conta que fazia sentido no ano passado vira porta esquecida. Este documento define de quanto em quanto tempo a postura é reavaliada, o que se olha em cada volta, e onde fica registrado.

Escrito a partir do que já roda. Onde a revisão depende de alguém sentar e olhar, o texto diz de quem é e com que frequência.

Atualizado em 26/08/2026.

---

## O que já é contínuo, sem depender de memória

Metade da revisão é automática e não espera ninguém lembrar. O CI roda a cada envio e também de forma agendada:

| Verificação | Cadência automática |
|---|---|
| `npm audit` (dependência) | A cada envio e semanal |
| Secret scanning (história do git) | A cada envio e semanal |
| CodeQL (SAST) | A cada envio e semanal |
| `dast.js` contra alvo local | A cada envio |
| `dast.js` contra produção | Semanal |
| Testes de segurança | A cada envio |

Isso é a revisão da parte automatizável, e ela já acontece toda segunda de manhã. O que segue é a parte que máquina não faz.

---

## As voltas humanas

### A cada mudança (no PR)

Já imposto pelo branch protection: o PR só funde com os cinco checks verdes e revisão. É a menor volta, e a mais frequente.

### Trimestral (a revisão de rotina)

Uma vez por trimestre, alguém senta e passa por esta lista. É o coração deste documento.

- Rodar a suíte de segurança inteira e o DAST contra produção (comando abaixo).
- Reler a tabela de `seguranca-evidencias.md` e confirmar que **todo controle afirmado ainda tem o teste que o prova**. Controle que perdeu o teste perde a linha.
- Revisar os **itens em aberto** de cada documento: algum saiu do aberto? Algum novo entrou?
- Revisar **contas e acessos**: quem ainda deve ter conta no cofre, e no papel certo. Tirar quem saiu.
- Conferir a **rotação de segredos**: `COFRE_SEGREDO`, `PONTE_TOKEN` e a chave de cifra foram girados dentro do prazo combinado?
- Conferir os **subprocessadores** do `seguranca-lgpd.md`: mudou algum terceiro que recebe dado?
- Olhar as **advisories novas** que o CI acendeu no trimestre e não foram fechadas.

### Anual (ou quando muda algo grande)

- Reler por inteiro `seguranca-arquitetura.md`, `seguranca-lgpd.md` e `seguranca-incidentes.md`: ainda descrevem o sistema de verdade?
- Reavaliar a **matriz de controles** inteira, marco a marco.
- Reconsiderar o que estava adiado por custo ou por falta de cliente: **pentest independente**, SAML, egress filtering.

### Por gatilho (fora do calendário)

Certas mudanças pedem revisão na hora, sem esperar o trimestre:

- uma funcionalidade nova que toca autenticação, autorização ou dado de cliente;
- um subprocessador novo, ou mudança no que um existente recebe;
- um cliente grande entrando, com o dado real dele;
- depois de qualquer incidente, como parte do "aprender" do `seguranca-incidentes.md`.

---

## Como rodar a revisão

A parte técnica da revisão trimestral é um comando. Da raiz do projeto:

```bash
cd auditeste-a11y && npm audit \
  && node teste-cofre.js && node teste-cifra.js && node teste-injecao.js \
  && node teste-ssrf.js && node teste-sso.js && node teste-convite.js && node teste-backup.js \
  && node teste-privacidade.js && node teste-seguranca.js && node teste-docker.js \
  && node dast.js
```

E a varredura contra o que está no ar:

```bash
cd auditeste-a11y && node dast.js https://audiprint.up.railway.app
```

Tudo verde e sem achado é o piso da revisão, não o teto: o resto é reler e conferir o que máquina não vê.

---

## Registro

Cada revisão trimestral e anual deixa uma nota curta: a data, quem fez, o que rodou, o que estava diferente do documento, e o que mudou por causa dela. Sem a nota, "revisamos" vira uma afirmação sem evidência, que é justo o que este pacote existe para não ser.

---

## Aberto, e é honesto dizer

| Item | Situação |
|---|---|
| Primeira revisão trimestral | Ainda não realizada. Esta política existe antes da primeira, que é a hora certa de tê-la |
| Calendário formal | A cadência está definida aqui; a data no calendário de quem opera ainda não foi marcada |
| Responsável nomeado | Enquanto não há equipe, a Auditeste responde. Ligado à mesma lacuna de DPO do `seguranca-lgpd.md` |

A parte automática desta revisão já roda toda semana. O que falta é a primeira volta humana entrar no calendário.
