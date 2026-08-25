# Print · Plano de resposta a incidentes

Marco 2, item 11. O que a equipe faz quando algo dá errado com dado de cliente, escrito antes de precisar, porque no meio de um incidente ninguém inventa processo bom.

Escrito a partir do sistema real: as ações abaixo usam o que existe hoje (auditoria por cliente, exclusão total, troca de senha pelo admin.js). Onde depende de decisão que ainda não foi tomada, o texto diz.

Atualizado em 25/08/2026.

---

## Para que serve

Segurança de cliente corporativo quase sempre pergunta: "e se vazar?". A resposta honesta não é "não vaza". É "isto é o que fazemos, nesta ordem, com estes prazos, e conseguimos provar depois". Este documento é essa resposta.

Um incidente é qualquer suspeita de acesso, alteração, perda ou exposição de dado de cliente que não deveria ter acontecido. Suspeita basta para abrir. Confirmar é etapa, não pré-requisito.

---

## Quem responde

Enquanto não houver time de segurança dedicado, a Auditeste responde pelo produto. Um nome precisa ser o ponto de decisão em cada incidente, o **responsável do incidente**, e é quem:

- decide conter, mesmo que conter derrube o serviço;
- decide quando e como comunicar;
- guarda o registro do que foi feito.

Encarregado de dados (DPO) ainda não designado formalmente. Até designar, o responsável do incidente acumula o contato com o titular e com a ANPD quando for o caso. Isto é uma lacuna conhecida, não um desenho.

---

## As sete etapas

O Epic pede: identificar, classificar, conter, investigar, comunicar, resolver, aprender. Cada uma abaixo, com o que a ferramenta já permite fazer.

### 1. Identificar

De onde um incidente aparece:

- um alerta do CI (varredura de dependência crítica, segredo encontrado na história);
- um achado da varredura dinâmica contra produção (roda semanal);
- a auditoria de um cliente mostrando ação que ninguém reconhece;
- alguém de fora avisando (cliente, pesquisador, provedor).

Registrar na abertura: quando foi notado, quem notou, o que se viu, qual cliente parece envolvido.

### 2. Classificar

A gravidade decide o prazo, não o contrário.

| Nível | O que é | Prazo para conter |
|---|---|---|
| Crítico | Dado de cliente exposto ou acessível a quem não é dele | Imediato, na mesma hora |
| Alto | Falha que permitiria o acima, ainda sem prova de exploração | No mesmo dia |
| Médio | Enfraquece um controle, sem alcance a dado | Na semana |
| Baixo | Higiene, sem alcance a dado | No ciclo normal |

Na dúvida entre dois níveis, assume o mais grave. Reclassificar para baixo depois é barato; para cima, tarde.

### 3. Conter

Parar o sangramento antes de entender tudo. O que existe hoje para conter:

- **Revogar as sessões de uma conta comprometida:** trocar a senha pelo `admin.js` revoga todas as sessões daquela pessoa na hora (`revogarSessoesDoUsuario`). Perder o vínculo com o cliente também derruba a sessão no próximo pedido.
- **Tirar um segredo do ar:** girar `COFRE_SEGREDO`, `PONTE_TOKEN` ou a chave de cifra na Railway invalida o que dependia deles. Girar a chave de cifra sem a antiga torna os prints ilegíveis, então isso é contenção de último caso.
- **Derrubar o serviço:** se conter exige tirar tudo do ar, tira. Indisponibilidade é recuperável; vazamento não.
- **Isolar um cliente:** a exclusão total de um cliente (`/api/tenant/excluir-tudo`, só admin) apaga dado e objeto juntos, e é irreversível. Contenção, não investigação: só depois de preservar o que for prova.

### 4. Investigar

A auditoria por cliente é a base. Ela registra, com quem, quando e de qual origem: login e login que falhou, criação, consulta, download de objeto, exclusão, troca de senha, mudança de permissão, operação administrativa e configuração de provedor. O registro **não guarda** corpo de requisição, cookie nem conteúdo de print, de propósito, e há teste que falha se isso mudar.

Perguntas que a auditoria responde: qual conta agiu, de qual IP, sobre qual recurso, em que instante. O que ela não responde sozinha (correlação entre clientes, sequência exata de uma sessão) sai do log do processo na Railway.

Preservar antes de limpar. Um backup (`VACUUM INTO`, testado) tira uma cópia consistente do banco para análise sem mexer no que está em uso.

### 5. Comunicar

Quem, quando e o quê.

- **Interno:** o responsável do incidente avisa a liderança da Auditeste assim que classifica como Alto ou Crítico.
- **Cliente afetado:** para incidente que atinja dado de um cliente, o cliente é avisado. O prazo contratual ainda **não está definido** (ver "Aberto", abaixo), então até definir vale a regra da LGPD: em prazo razoável, com o que se sabe, sem esperar ter tudo.
- **ANPD:** quando o incidente puder acarretar risco relevante aos titulares, a comunicação à autoridade segue a LGPD. Como não há DPO designado, o responsável do incidente conduz.

O que a comunicação diz: o que aconteceu, que dado, desde quando, o que já foi feito, o que o cliente deve fazer. O que ela não faz: prometer o que ainda não se sabe.

### 6. Resolver

Fechar a causa, não o sintoma. A correção vira código com teste que falha se a falha voltar, no mesmo padrão dos achados do pentest e do DAST. Enquanto o teste não existe, o incidente não está resolvido, está pausado.

### 7. Aprender

Depois de todo incidente Alto ou Crítico, um registro curto: o que aconteceu, por que foi possível, o que mudou para não repetir, o que faltou no próprio processo. Sem busca de culpado; a pergunta é sempre "que defesa não existia", não "quem errou".

---

## O que já sustenta este plano

| Capacidade | Onde | Evidência |
|---|---|---|
| Auditoria por cliente | `banco.js`, tabela `auditoria` | `teste-cofre.js` |
| Revogar sessão na troca de senha | `admin.js`, `revogarSessoesDoUsuario` | `teste-cofre.js` |
| Exclusão total de um cliente | `/api/tenant/excluir-tudo` | `teste-cofre.js` |
| Backup consistente para análise | `snapshot` (`VACUUM INTO`) | `teste-backup.js` |
| Alerta de dependência crítica e segredo | `.github/workflows/seguranca.yml` | CI |
| Varredura de produção | `dast.js` no CI, semanal | `dast.js` |

---

## Aberto, e é honesto dizer

| Item | Situação |
|---|---|
| Encarregado de dados (DPO) | Não designado formalmente |
| Prazo contratual de comunicação ao cliente | Não definido. Vale o prazo razoável da LGPD até definir |
| Canal público para receber aviso de fora | Não formalizado (sem endereço de segurança divulgado) |
| Ensaio do plano | Nunca exercitado. Um plano que nunca rodou é uma hipótese |

Nenhum incidente com dado de cliente até hoje. O produto ainda não operou com evidência real de cliente, então este plano é preventivo, e é a hora certa de tê-lo: antes do primeiro.
