# Print · Perguntas de segurança e questionário de fornecedor

Respostas oficiais, para não haver uma versão por oportunidade comercial.

Se a resposta que você precisa não está aqui, **não invente**: peça para a engenharia acrescentar. Resposta improvisada num questionário vira compromisso contratual.

Atualizado em 24/08/2026. Cada resposta tem a prova correspondente em `seguranca-evidencias.md`.

---

# Parte 1 · As dez perguntas que sempre vêm

### O que exatamente é coletado?

Prints da tela durante a execução do teste, o elemento acionado em cada passo (seletor, rótulo, trecho de HTML), a URL da tela antes e depois, e o texto digitado.

**Não é coletado:** senha, CPF, CNPJ e cartão de crédito. Esses campos são reconhecidos pelo tipo, pelo nome, pelo `autocomplete` e pelo formato do valor, e o conteúdo é substituído **antes de a evidência existir**, não antes de ser exibida.

O vídeo da gravação nunca sai da máquina do consultor.

### Onde a informação fica armazenada?

Depende de uma decisão explícita do consultor.

Por padrão, **na máquina dele**, no armazenamento local do navegador. Gravar não envia nada.

Quando ele clica em enviar ao cofre, a evidência passa a residir num banco em volume gerenciado na Railway, **região US West, Estados Unidos**.

### Os dados são criptografados?

**Em trânsito:** sim. HTTPS obrigatório, com redirecionamento e HSTS de um ano.

**Em repouso:** o conteúdo dos prints é cifrado pela aplicação com AES-256-GCM antes de tocar o disco. O modo GCM autentica, então conteúdo adulterado no arquivo é recusado na leitura, e não devolvido corrompido.

Os metadados (nome de projeto, título do passo, URL) ficam em texto. A cifra foi aplicada onde está a informação sensível de verdade: a imagem da tela.

### Quem pode acessar?

Só contas com vínculo explícito à equipe dona do dado. Cada operação valida usuário, equipe, permissão e recurso.

A Auditeste, como consultoria, pode alcançar a equipe de cada cliente que atende, e **cada entrada fica registrada na auditoria daquele cliente**, identificando quem entrou.

### Existe segregação entre clientes?

Sim, e é estrutural, não uma checagem que o programador possa esquecer.

Toda tabela de dado de cliente carrega o identificador da equipe, e toda função de acesso ao banco exige esse identificador como argumento obrigatório, falhando se ele não vier. O identificador vem sempre da sessão, nunca do pedido.

Consequência: pedir um registro de outro cliente informando o id dele responde **não encontrado**. Há teste automatizado que executa exatamente essa tentativa.

### Vocês usam inteligência artificial?

Sim, para uma função: descrever em texto o que mudou entre duas telas.

* É **opcional por projeto**. Desligada, nada sai da máquina e a captura continua funcionando.
* Cada envio fica **registrado localmente**, com data, tamanho e destino.
* O modelo **não executa ações**: não acessa o banco, não chama serviços, não tem ferramentas. Recebe texto e imagem e devolve texto.
* Conteúdo do sistema testado entra sob **fronteira de confiança declarada**, e tentativa de manipular a descrição marca a evidência com aviso visível.

### Dados são enviados a terceiros?

Sim, quando a descrição automática está ligada: o print, o trecho de HTML e a URL da tela vão para a NVIDIA.

Subprocessadores:

| Quem | Para quê | Recebe evidência? |
|---|---|---|
| Railway | Hospedagem e armazenamento | Sim |
| NVIDIA | Descrição das telas | Sim, quando autorizado |
| GitHub | Código e integração contínua | Não |

### Qual é a retenção?

Padrão de **90 dias por cliente**, configurável. Toda evidência nasce com data de expiração.

Uma varredura roda dentro do próprio processo, de hora em hora, e apaga o que venceu, sem depender de agendador externo.

No complemento do navegador, sessões guardadas são descartadas após 7 dias.

**O prazo contratual ainda não está definido.** O sistema aplica o que for configurado; o número que vale para cada contrato é decisão da Auditeste com o cliente.

### Existem logs?

Sim. Dezenove eventos, sempre com quem, quando, qual cliente, qual ação e qual recurso: entrada e saída, tentativa falha, criação de conta, mudança de permissão, troca de senha, criação e exclusão de projeto, criação, consulta, visualização e exclusão de evidência, download de arquivo, e exclusão total de cliente.

O registro **não guarda** corpo de requisição, cabeçalho de autorização, cookie nem conteúdo de print, e há teste que falha se isso mudar.

Cada cliente vê apenas a própria auditoria, pela interface.

### Como funciona a exclusão?

Excluir apaga **o metadado e o arquivo na mesma transação**. Apagar só o registro deixaria o arquivo órfão no banco.

Há três caminhos: excluir uma evidência, excluir um projeto inteiro com tudo dentro, e excluir todos os dados de um cliente com confirmação pelo nome.

Os registros de auditoria permanecem, para que a exclusão continue comprovável.

Existe teste que destrói o banco, restaura de um backup e confere que o print voltou byte a byte.

### Existe SSO?

**Sim, por OIDC.** Funciona com Entra ID, Google Workspace e Okta. A ligação é por domínio de e-mail: quem digita um endereço do domínio configurado vai para o provedor da própria empresa e não digita senha aqui. A conta é criada no primeiro acesso, e quando a empresa desliga a pessoa, o acesso ao Print cai no mesmo ato.

O token de identidade é verificado por assinatura, algoritmo, emissor, audiência, validade, uso único do estado e confirmação do e-mail pelo provedor. **SAML não existe**, e se for requisito precisa entrar em planejamento.

---

# Parte 2 · Questionário de fornecedor

Formato de resposta direta, para os assessments que costumam chegar.

## Governança

| Pergunta | Resposta |
|---|---|
| Existe política de segurança formal? | Não formalizada. Os controles técnicos estão documentados e testados |
| Existe responsável designado? | A Auditeste responde pelo produto. Encarregado de dados não designado formalmente |
| Certificação (ISO 27001, SOC 2)? | Não |
| Pentest interno? | Sim, revisão adversária manual, documentada em `seguranca-pentest.md`. Achou e corrigiu uma SSRF por rebind de DNS no scanner |
| Pentest independente? | Não realizado. É a camada que a revisão interna, por ser de quem fez o código, não substitui |

## Controle de acesso

| Pergunta | Resposta |
|---|---|
| Autenticação própria? | Sim, e-mail e senha |
| Armazenamento de senha | scrypt com sal por usuário, N=16384, r=8, p=1 |
| Tamanho mínimo de senha | 10 caracteres |
| Múltiplos fatores | Não |
| SSO | Sim, OIDC por domínio de e-mail, com criação de conta no primeiro acesso |
| Perfis de acesso | Sim: leitor, consultor, gestor, admin |
| Expiração de sessão | 12 horas |
| Revogação | Ao sair, ao trocar senha, e ao perder o vínculo (imediata) |
| Proteção contra força bruta | Sim, 8 tentativas por conta em 15 minutos |
| Cadastro aberto | Sim por padrão, e cria equipe nova isolada. Pode ser restrito a convite |

## Dados

| Pergunta | Resposta |
|---|---|
| Criptografia em trânsito | TLS, HTTPS obrigatório, HSTS de um ano |
| Criptografia em repouso | AES-256-GCM sobre o conteúdo dos prints, pela aplicação |
| Localização | Estados Unidos, região US West |
| Transferência internacional | Sim. Precisa estar prevista em contrato |
| Segregação entre clientes | Lógica, obrigatória em toda consulta |
| Retenção | 90 dias padrão, configurável por cliente |
| Exclusão a pedido | Sim, inclusive exclusão total de um cliente |
| Backup | Sim, com restauração testada automaticamente |
| Backup fora do provedor | Procedimento não estabelecido |

## Aplicação

| Pergunta | Resposta |
|---|---|
| Validação de entrada | Sim, tipo e limite por campo |
| Consultas parametrizadas | Sim, sem exceção |
| Proteção contra atribuição em massa | Sim, campo a campo, nunca o corpo inteiro |
| Escape de conteúdo do usuário | Sim |
| Cabeçalhos de segurança | `X-Content-Type-Options`, `Referrer-Policy`, CSP, HSTS |
| CORS | Restrito à origem da aplicação |
| Limite de requisições | Por conta, por sessão e por origem |
| Proteção contra bot | Parcial. Sem CAPTCHA ou serviço externo |
| Gestão de segredos | Variáveis de ambiente. Nenhum segredo no repositório, verificado em toda a história |

## Desenvolvimento

| Pergunta | Resposta |
|---|---|
| Integração contínua | Sim |
| Varredura de dependências | Sim, semanal e a cada envio |
| Vulnerabilidades conhecidas | 22, sendo 6 altas, todas na cadeia do navegador headless usado nos scans. Registradas, correção exige mudança de versão maior |
| Busca de segredos no repositório | Sim, automatizada, sobre toda a história |
| Análise estática | Sim, CodeQL com o conjunto `security-extended`, a cada envio e semanalmente |
| Teste dinâmico | Sim, varredura própria de 40 sondas contra a aplicação em execução, a cada envio. Contra o ambiente de produção, semanalmente |
| Revisão de código obrigatória | Não formalizada |
| Testes automatizados | Sim, cerca de 30 arquivos de teste, incluindo os que verificam controles de segurança |

## Incidentes

| Pergunta | Resposta |
|---|---|
| Plano formal de resposta | Não |
| Prazo de comunicação | Não definido |
| Registro para investigação | Sim, auditoria por cliente |
| Histórico de incidente | Nenhum incidente com dado de cliente. O produto ainda não operou com evidência real de cliente |

---

# Parte 3 · Como responder ao que não está aqui

**Não preencha por analogia.** Se a pergunta é sobre algo que não existe, a resposta é "não", e não "parcialmente" ou "em desenvolvimento".

**Não prometa prazo sem a engenharia.** Vários itens em aberto dependem de decisão de negócio, não de esforço técnico.

**Quando a resposta for desfavorável, ela ainda é a resposta.** Um "não" documentado é auditável. Um "sim" que não se sustenta vira problema contratual no primeiro incidente.

Os itens em aberto, reunidos:

* Sem múltiplos fatores próprios. Quem entra por SSO usa o fator que a empresa dele exige
* Sem certificação e sem pentest independente
* Sem plano formal de incidente e sem prazo de comunicação
* Sem política de retenção contratual definida
* Dados fora do Brasil
* 22 vulnerabilidades conhecidas em dependências, 6 altas
* Criptografia do volume pelo provedor não verificada
* Backup fora do provedor não estabelecido
