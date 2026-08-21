Epic — Segurança e Maturidade B2B do Print
Epic — Segurança e Maturidade B2B do Print
Contexto
O Print será utilizado por consultores da Auditeste para captura, armazenamento e consulta de evidências geradas em ambientes de clientes.


Essas evidências podem conter informações corporativas sensíveis. Por isso, antes de ampliar seu uso, precisamos garantir que o produto tenha controles suficientes para responder de forma objetiva a perguntas como:


* O que é coletado?
* Onde a informação fica armazenada?
* Quem pode acessar?
* Como garantimos isolamento entre clientes?
* Por quanto tempo os dados permanecem?
* Como são excluídos?
* Quem acessou ou alterou uma evidência? (Logs)
* Como protegemos dados em trânsito e em repouso?
* Como reagimos a incidentes?
* Como demonstramos tudo isso para Segurança, TI e decisores dos clientes?


A evolução será dividida em três marcos, evitando adicionar complexidade corporativa antes de resolver os riscos fundamentais.


________________


Marco 1 — Proteção da Evidência
Objetivo
Garantir que possamos armazenar evidências reais de clientes sem risco estrutural evidente de exposição, mistura entre empresas ou perda de controle sobre os dados.
Pergunta que este marco responde
Podemos colocar uma evidência de cliente no Print com segurança?
Controles principais
1. Tenant (cliente) e isolamento lógico
Estruturar o produto desde já considerando múltiplos clientes.


Modelo esperado:


Tenant (cliente) → Projeto → Execução → Evidência


Usuários devem possuir vínculo explícito com um tenant e permissões dentro dele.


Por quê


O maior risco de um SaaS B2B é permitir que um cliente acesse informações de outro.


Adicionar tenant_id posteriormente costuma exigir mudanças profundas no banco, APIs e regras de autorização. Por isso, o isolamento precisa nascer na fundação do domínio.


Neste estágio, não precisamos de banco ou infraestrutura dedicada por cliente.


Escolha: monólito multitenant com banco compartilhado e isolamento lógico forte.


Isso mantém simplicidade operacional sem abrir mão da segregação.


________________


2. Autenticação
Garantir que toda interação relevante tenha uma identidade conhecida.


Inclui:


* login;
* sessões ou tokens;
* expiração;
* logout;
* revogação;
* hashing adequado de senhas;
* proteção básica contra brute force.


Por quê


Sem identidade confiável não existe autorização nem auditoria confiável.


________________


3. Autorização
Toda operação deve validar:


Usuário → Tenant → Permissão → Recurso


Não basta saber que o usuário está autenticado.


Por quê


Um dos riscos mais comuns em APIs acontece quando alguém conhece ou descobre o ID de outro registro e a aplicação devolve o recurso sem validar ownership.


Exemplo:


GET /evidences/458


A aplicação não pode responder apenas porque o ID existe.


Precisa validar se aquela evidência pertence ao tenant e ao contexto autorizado daquele usuário.


________________


4. Storage privado
Screenshots e evidências não devem possuir URLs públicas permanentes.


Utilizar:


* bucket/storage privado;
* URLs temporárias e assinadas quando necessário;
* autorização da aplicação antes da obtenção do arquivo.


Por quê


Uma evidência segura no banco deixa de ser segura se seu arquivo puder ser acessado diretamente por uma URL.


________________


5. HTTPS / TLS
Toda comunicação deve acontecer por HTTPS.


Por quê


Evita exposição da evidência, credenciais e tokens durante o transporte entre navegador, aplicação, APIs e serviços externos.


HTTPS protege dados em trânsito.


________________


6. Criptografia em repouso
Banco, storage e backups devem utilizar os mecanismos de criptografia oferecidos pela infraestrutura utilizada.


Por quê


HTTPS protege somente a comunicação.


Criptografia em repouso protege os dados armazenados em caso de comprometimento de disco, storage ou infraestrutura.


A preferência é utilizar mecanismos do provedor, e não criar criptografia própria.


________________


7. Ciclo de vida da evidência
Precisamos formalizar:


captura → armazenamento → utilização → retenção → exclusão


Por quê


Segurança não significa apenas impedir acesso indevido.


Também significa não manter informação indefinidamente sem necessidade.


O sistema deve conhecer o estado e a propriedade de cada evidência.


________________


8. Retenção e exclusão
Precisamos permitir:


* política de retenção;
* exclusão automatizada quando aplicável;
* remoção do metadata;
* remoção do arquivo correspondente;
* controle de arquivos órfãos.


Por quê


A evidência não deve permanecer indefinidamente apenas porque foi armazenada alguma vez.


Também é fundamental para futuras políticas LGPD e contratuais.


________________


9. Secrets management
Credenciais, tokens e chaves não devem permanecer no código.


Utilizar:


* variáveis de ambiente;
* secret management da infraestrutura;
* separação entre ambientes;
* rotação quando necessária.


Por quê


Um repositório comprometido não deve significar automaticamente comprometimento da infraestrutura.


________________


10. Audit log mínimo
Registrar inicialmente eventos relevantes como:


* criação;
* exclusão;
* alteração;
* acesso administrativo;
* mudança de permissões.


Sempre relacionando:


quem → quando → tenant → ação → recurso


Por quê


Quando Segurança perguntar:


“Quem acessou essa evidência?”


precisamos conseguir responder.


________________


Critério de conclusão do Marco 1
O Marco 1 termina quando conseguimos demonstrar tecnicamente que:


Uma evidência pertence inequivocamente a um cliente, somente pessoas autorizadas conseguem acessá-la, sua transmissão e armazenamento são protegidos, seu ciclo de vida é controlado e ações relevantes podem ser rastreadas.


________________


Marco 2 — Pronto para Ambiente Corporativo
Objetivo
Transformar os controles fundamentais em uma postura de segurança adequada para utilização recorrente dentro de clientes corporativos.
Pergunta que este marco responde
O Print consegue operar de maneira sustentável dentro de uma empresa com processo formal de Segurança?


________________


1. RBAC estruturado
Criar papéis e permissões explícitos.


Exemplos:


* usuário;
* consultor;
* gestor;
* administrador.


Por quê


Em ambientes corporativos, acesso não deve depender apenas de alguém possuir uma conta.


Precisamos aplicar o princípio de menor privilégio.


Cada perfil recebe apenas o acesso necessário para sua função.


________________


2. Auditoria completa
Expandir logs para registrar:


* login;
* consulta;
* download;
* criação;
* exclusão;
* alteração de permissões;
* operações administrativas.


Por quê


Auditoria deixa de ser apenas investigação de problema e passa a ser evidência de controle.


________________


3. Rate limiting
Limitar quantidade de chamadas permitidas por usuário, token, IP ou endpoint.


Por quê


Reduz:


* abuso;
* brute force;
* scraping;
* automações descontroladas;
* consumo acidental excessivo;
* ataques de negação de serviço simples.


________________


4. Hardening de APIs
Adicionar controles como:


* validação de payload;
* limites de tamanho;
* MIME/type validation;
* headers seguros;
* tratamento padronizado de erros;
* CORS restritivo.


Por quê


A aplicação deixa de assumir que toda requisição recebida é legítima.


Entradas devem ser tratadas como não confiáveis.


________________


5. CORS restritivo
Permitir chamadas apenas das origens efetivamente necessárias.


Por quê


Evita que páginas externas interajam indevidamente com a aplicação através do navegador do usuário.


CORS não substitui autenticação ou autorização.


É uma camada adicional de proteção do navegador.


________________


6. Backup e restore
Ter backup é insuficiente.


Precisamos também testar restauração.


Por quê


O controle que importa não é:


“Temos backup.”


É:


“Conseguimos recuperar os dados quando necessário.”


________________


7. Secure SDLC
Adicionar segurança ao fluxo de desenvolvimento.


Inclui:


* revisão de pull request;
* dependency scanning;
* secret scanning;
* SAST;
* atualização de bibliotecas;
* checklist de segurança.


Por quê


Segurança não deve depender de uma auditoria eventual.


Ela precisa fazer parte da rotina de desenvolvimento.


________________


8. SAST
Análise estática do código em busca de vulnerabilidades e padrões inseguros.


Por quê


Ajuda a identificar problemas antes de chegarem ao ambiente produtivo.


Não substitui revisão humana nem testes dinâmicos.


________________


9. Dependency scanning
Analisar vulnerabilidades conhecidas nas bibliotecas utilizadas.


Por quê


Grande parte de uma aplicação moderna é composta por dependências externas.


Código próprio seguro pode continuar vulnerável por utilizar uma biblioteca comprometida ou desatualizada.


________________


10. SSO-ready
Preparar a arquitetura de identidade para posteriormente suportar OIDC/SAML.


Não necessariamente implementar todas as integrações imediatamente.


Por quê


Clientes corporativos frequentemente querem controlar identidade através do próprio provedor.


Exemplos:


* Microsoft Entra ID;
* Okta;
* Google Workspace.


Evitar agora decisões que tornem essa integração difícil posteriormente.


________________


11. Gestão de incidentes
Definir:


* identificação;
* classificação;
* contenção;
* investigação;
* comunicação;
* resolução;
* aprendizado posterior.


Por quê


Nenhum sistema pode prometer risco zero.


Maturidade de segurança inclui saber reagir quando algo acontece.


________________


12. LGPD operacional
Definir claramente:


* quais dados são tratados;
* finalidade;
* retenção;
* descarte;
* controlador;
* operador;
* subprocessadores;
* responsabilidades.


Por quê


LGPD não deve ser tratada apenas como documento jurídico.


As políticas precisam corresponder ao comportamento real do sistema.


________________


Critério de conclusão do Marco 2
O Print possui controles consistentes de identidade, acesso, auditoria, desenvolvimento seguro, recuperação e governança suficientes para operar continuamente em ambientes corporativos.


________________


Marco 3 — Segurança Demonstrável e Vendável
Objetivo
Não apenas possuir segurança, mas conseguir demonstrá-la de forma convincente para clientes, Segurança da Informação, Tecnologia, Jurídico e Compras.
Pergunta que este marco responde
Conseguimos passar por uma avaliação de Segurança de um cliente sem improvisar respostas?


________________


1. SSO
Implementar integrações corporativas de identidade quando houver demanda.


Preferencialmente:


* OIDC;
* SAML quando necessário.


Por quê


Permite que o cliente controle autenticação, desligamento de usuários e políticas de identidade através de sua própria infraestrutura.


________________


2. DAST
Testes dinâmicos contra a aplicação em execução.


Por quê


SAST analisa o código.


DAST analisa o comportamento da aplicação funcionando.


As abordagens são complementares.


________________


3. Pentest
Executar teste de invasão independente ou especializado.


Por quê


Ferramentas automáticas encontram padrões.


Pentest procura combinações de falhas, comportamentos inesperados e formas reais de exploração.


Também fornece evidência externa de que o produto foi submetido a avaliação.


________________


4. Segurança de IA
Caso funcionalidades de IA processem evidências, aplicar controles específicos.


Inclui:


* isolamento de contexto;
* tratamento de conteúdo externo como não confiável;
* proteção contra prompt injection;
* allowlist de ferramentas;
* limitação de privilégios;
* validação de saída.


Por quê


Uma evidência pode conter texto controlado pelo sistema ou usuário do cliente.


Esse conteúdo não pode ser interpretado como instrução confiável pela IA.


Prompt injection precisa ser tratado como problema de trust boundary, não apenas como problema de prompt.


________________


5. Security Architecture
Produzir documentação da arquitetura de segurança.


Incluir:


* componentes;
* fluxo de dados;
* trust boundaries;
* armazenamento;
* autenticação;
* autorização;
* integrações;
* controles.


Por quê


Segurança corporativa precisa conseguir entender o produto sem ler seu código-fonte.


________________


6. Data Flow
Representar claramente:


origem → captura → transporte → processamento → armazenamento → acesso → exclusão


Por quê


Grande parte das perguntas de Segurança e LGPD é respondida entendendo onde a informação passa.


________________


7. Security FAQ
Criar respostas oficiais para perguntas recorrentes.


Exemplos:


* onde os dados ficam?
* são criptografados?
* quem possui acesso?
* existe segregação entre clientes?
* vocês utilizam IA?
* dados são enviados para terceiros?
* qual a retenção?
* existem logs?
* existe SSO?
* como funciona exclusão?


Por quê


Evita que cada oportunidade comercial produza uma resposta diferente.


________________


8. Questionário padrão de Segurança
Manter uma base com respostas para assessments comuns de fornecedores.


Por quê


Clientes corporativos frequentemente enviam questionários extensos e semelhantes.


Responder de maneira centralizada reduz esforço e principalmente evita inconsistências.


________________


9. Evidências dos controles
Não basta escrever:


“Temos controle de acesso.”


Precisamos conseguir mostrar:


* configuração;
* processo;
* log;
* teste;
* relatório;
* arquitetura.


Por quê


Segurança corporativa trabalha com o princípio:


afirmação sem evidência é apenas uma declaração.


________________


Critério de conclusão do Marco 3
O Print consegue explicar, demonstrar e comprovar sua postura de segurança para áreas técnicas e executivas sem depender de conhecimento informal da equipe.


________________


Visão resumida
Marco 1 — Proteja
Pergunta: podemos armazenar a evidência?


Foco:


* tenancy;
* autenticação;
* autorização;
* storage privado;
* criptografia;
* HTTPS;
* ciclo de vida;
* exclusão;
* secrets;
* auditabilidade mínima.


________________


Marco 2 — Controle
Pergunta: podemos operar continuamente dentro de uma organização corporativa?


Foco:


* RBAC;
* auditoria;
* rate limit;
* API hardening;
* CORS;
* backup/restore;
* Secure SDLC;
* SAST;
* dependency scanning;
* gestão de incidentes;
* LGPD;
* SSO-ready.


________________


Marco 3 — Demonstre
Pergunta: conseguimos provar para o cliente que fazemos tudo isso?


Foco:


* SSO;
* DAST;
* pentest;
* segurança de IA;
* arquitetura documentada;
* data flow;
* Security FAQ;
* questionários;
* evidências dos controles.


________________


Princípio da Epic
A sequência foi construída deliberadamente desta forma:


Proteger → Controlar → Demonstrar


Não faz sentido realizar pentest em uma aplicação que ainda não possui isolamento consistente entre tenants.


Não faz sentido discutir certificação quando ainda não sabemos exatamente como uma evidência é excluída.


Não faz sentido vender segurança antes de possuir controles demonstráveis.


Da mesma forma, não precisamos transformar um monólito simples em uma arquitetura complexa para atingir segurança adequada.


O objetivo é:


manter o Print simples na arquitetura, rigoroso nos limites de confiança e progressivamente demonstrável para clientes corporativos.


A complexidade deve surgir somente quando um requisito real justificar sua existência.


Prompt para investigação técnica — Print / Marco …
Prompt para investigação técnica — Print / Marco 1 de Segurança
Você está analisando o projeto Print, um SaaS B2B interno da Auditeste que será utilizado por consultores alocados em clientes para coleta e gestão de evidências, incluindo screenshots de sistemas de terceiros.


O produto ainda não foi apresentado formalmente a clientes, mas uma preocupação já surgiu em conversa com a Ailos: como evidências são coletadas de sistemas corporativos, precisamos demonstrar com clareza o que é coletado, onde fica armazenado, quem pode acessar, por quanto tempo permanece e como é eliminado.


O projeto atualmente é descrito como um monólito simples. Não há ainda uma definição consolidada de tenant/multitenancy.


Seu trabalho neste momento não é implementar nada.


Quero que você faça uma investigação técnica profunda da arquitetura atual e produza um diagnóstico objetivo sobre o que já existe, o que está parcialmente implementado, o que está ausente e quais mudanças são necessárias para atingir o Marco 1 de Segurança descrito abaixo.
Objetivo do Marco 1
Responder tecnicamente, com segurança, à pergunta:


“Podemos colocar uma evidência de um cliente aqui sem medo de exposição indevida, perda de controle ou mistura com dados de outro cliente?”


O Marco 1 deve garantir, no mínimo:


1. definição de tenant e isolamento entre clientes;
2. autorização adequada sobre recursos;
3. armazenamento privado das evidências;
4. HTTPS/TLS em trânsito;
5. criptografia adequada em repouso;
6. ciclo de vida de evidências;
7. retenção e exclusão;
8. logs mínimos de auditoria;
9. proteção de segredos e credenciais;
10. uma arquitetura capaz de evoluir posteriormente para requisitos corporativos mais avançados.


________________


1. Primeiro, compreenda a arquitetura existente
Inspecione todo o repositório necessário para compreender:


* frontend;
* backend;
* banco de dados;
* ORM/query layer;
* modelo de dados;
* autenticação;
* autorização;
* storage de arquivos;
* upload/download de evidências;
* APIs;
* middlewares;
* variáveis de ambiente;
* infraestrutura/deploy;
* containers;
* integrações externas;
* processamento de screenshots;
* logging;
* tratamento de erros;
* jobs/background processing, caso exista;
* mecanismos de exclusão;
* mecanismos de backup, caso existam;
* bibliotecas de segurança já utilizadas.


Não presuma que algo existe porque uma biblioteca está instalada. Verifique se e onde ela realmente é utilizada.


Também não considere um controle implementado apenas porque existe no frontend.


Sempre procure a garantia correspondente no backend.


________________


2. Reconstrua o fluxo real de uma evidência
Localize no código o fluxo completo de uma evidência, desde sua origem até sua eventual exclusão.


Quero algo semelhante a:


Captura → cliente/browser/extensão → API → autenticação → autorização → processamento → storage → metadata → banco → consulta → download/renderização → exclusão


Para cada etapa, identifique:


* componente responsável;
* arquivo/classe/função principal;
* dados transmitidos;
* dados persistidos;
* identificação do usuário;
* identificação do cliente/tenant;
* validações aplicadas;
* permissões verificadas;
* forma de armazenamento;
* exposição pública ou privada;
* possíveis pontos de vazamento.


Não se limite ao caminho feliz.


Procure também:


* endpoints alternativos;
* URLs diretas;
* IDs previsíveis;
* handlers antigos;
* rotas administrativas;
* arquivos temporários;
* caches;
* logs;
* tratamento de exceções.


________________


3. Investigue especificamente tenancy
Hoje não existe uma decisão consolidada sobre tenant/multitenancy.


Quero que você descubra como o sistema se comporta atualmente.


Responda:


* Existe hoje conceito explícito de tenant, organization, company, workspace, account ou equivalente?
* Como usuários são associados a clientes?
* Um usuário pode pertencer a mais de um cliente?
* Projetos pertencem a quem?
* Evidências pertencem diretamente a usuário, projeto ou empresa?
* Existe algum identificador de cliente em todas as entidades relevantes?
* Queries filtram dados por usuário, projeto ou organização?
* É possível, alterando um ID em uma requisição, acessar registro pertencente a outro contexto?
* Há risco de IDOR/BOLA?
* O storage possui separação por cliente?
* O caminho ou key dos arquivos carrega algum contexto de tenant?
* Existem URLs que permitam acesso independentemente da autorização da aplicação?


Depois da investigação, recomende explicitamente se a arquitetura deve adotar:


monólito multitenant, banco compartilhado e isolamento lógico por tenant_id, com storage segregado por tenant


ou se existe algum impedimento arquitetural concreto para isso.


Não recomende microserviços ou infraestrutura dedicada por cliente sem uma justificativa técnica muito forte.


A preferência para esta fase é simplicidade com isolamento forte.


________________


4. Investigue autenticação e autorização separadamente
Não trate autenticação e autorização como a mesma coisa.
Autenticação
Mapeie:


* como login funciona;
* sessões/tokens utilizados;
* expiração;
* refresh;
* logout;
* revogação;
* hashing de senha;
* proteção contra brute force;
* recuperação de senha;
* armazenamento do token no frontend;
* cookies;
* flags HttpOnly, Secure, SameSite, quando aplicável;
* possibilidade de impersonation;
* contas administrativas.
Autorização
Mapeie:


* onde permissões são verificadas;
* existência de roles;
* escopo de cada role;
* autorização por recurso;
* autorização por tenant;
* validação de ownership;
* endpoints que consultam registros diretamente pelo ID;
* ações administrativas.


Procure especialmente por situações semelhantes a:


GET /evidences/:id
DELETE /evidences/:id
GET /projects/:id

em que a aplicação busca o registro pelo ID, mas não verifica explicitamente se aquele recurso pertence ao tenant/contexto autorizado do usuário.


________________


5. Investigue o armazenamento das evidências
Determine exatamente:


* onde screenshots são armazenados;
* qual serviço/storage é usado;
* bucket/container;
* configuração pública ou privada;
* URLs persistidas;
* signed URLs;
* tempo de expiração;
* permissões do bucket;
* credenciais utilizadas;
* caminhos dos objetos;
* existência de segregação por cliente;
* metadata armazenada;
* arquivos temporários;
* cache;
* thumbnails ou derivados.


Verifique se alguém que obtenha uma URL consegue acessar a evidência sem estar autenticado no Print.


Esse é um ponto crítico.


________________


6. Investigue ciclo de vida e exclusão
Descubra se hoje existe um ciclo de vida formal ou implícito.


Mapeie:


criação → armazenamento → utilização → retenção → exclusão


Responda:


* Existe data de criação?
* Existe data de expiração?
* Existe política de retenção?
* Existe soft delete?
* Existe hard delete?
* Excluir um registro no banco também remove o arquivo físico?
* Existem arquivos órfãos?
* Existem backups que preservam arquivos eliminados?
* Existe alguma rotina automática de limpeza?
* Existe forma de excluir todas as informações relacionadas a determinado cliente/projeto?
* Existe forma de demonstrar que uma evidência foi efetivamente excluída?


Caso não exista política atual, proponha a estrutura técnica necessária, sem inventar ainda os prazos comerciais/legais definitivos.


________________


7. Investigue criptografia e transporte
Valide:
Em trânsito
* HTTPS é obrigatório?
* Existe algum endpoint acessível por HTTP?
* TLS é terminado onde?
* Existe proxy/CDN/load balancer?
* Há redirects apropriados?
* Cookies possuem Secure, quando aplicável?
Em repouso
Investigue:


* criptografia do banco;
* criptografia do storage;
* criptografia de backups;
* provider utilizado;
* configurações existentes.


Diferencie claramente:


* criptografia nativa do provedor;
* criptografia implementada pela aplicação;
* ausência de criptografia.


Não proponha criptografia customizada sem necessidade.


________________


8. Investigue secrets
Procure por:


* secrets hardcoded;
* tokens;
* API keys;
* passwords;
* connection strings;
* arquivos .env;
* .env versionado;
* credenciais em testes;
* exemplos reais em documentação;
* chaves de storage;
* credenciais administrativas.


Use busca no repositório.


Avalie também se o ambiente de deploy fornece mecanismo adequado para armazenamento dos segredos.


Não exponha nenhum segredo real no relatório.


Caso encontre, indique apenas:


“Foi identificada credencial sensível no arquivo X, linha/região Y.”


Mascare qualquer valor.


________________


9. Investigue logs e auditoria
Primeiro diferencie:
Log operacional
Erros, requests, performance etc.
Audit log
Registro de ações relevantes realizadas por usuários.


Verifique se atualmente conseguimos responder:


* quem criou uma evidência?
* quem visualizou?
* quem baixou?
* quem excluiu?
* quem alterou permissões?
* quando isso ocorreu?
* em qual tenant/projeto?


Verifique também se os logs atuais podem estar armazenando:


* screenshots;
* conteúdo sensível;
* tokens;
* cookies;
* Authorization header;
* passwords;
* payloads completos.


Isso deve ser tratado como risco.


________________


10. Não priorize ainda controles do Marco 2
Você pode apontar riscos futuros, mas não quero que esta análise vire uma lista infinita de segurança corporativa.


Neste momento, não trate como bloqueadores do Marco 1:


* SSO/SAML;
* SOC 2;
* ISO 27001;
* pentest periódico;
* SIEM;
* DLP;
* WAF avançado;
* disaster recovery sofisticado;
* infraestrutura dedicada por cliente;
* microserviços;
* arquitetura zero trust completa;
* certificações.


Registre-os, quando relevante, como:


“Evolução posterior / Marco 2”


O foco é tornar o monólito atual seguro o suficiente para armazenar evidências de clientes com isolamento e controle demonstráveis.


________________


11. Classifique cada achado
Para cada item analisado, utilize uma destas classificações:
✅ IMPLEMENTADO
Existe, está efetivamente aplicado e foi localizado no código/configuração.
🟡 PARCIAL
Existe alguma implementação, mas possui lacunas relevantes.
🔴 AUSENTE
Não foi encontrado ou o comportamento atual não oferece o controle necessário.
⚪ NÃO FOI POSSÍVEL VERIFICAR
Depende de infraestrutura, configuração externa ou informação ausente no repositório.


Nunca classifique algo como implementado apenas por inferência.


________________


12. Priorize os problemas
Para cada gap, classifique:
P0 — Bloqueador
Não deveríamos armazenar evidências reais de clientes enquanto isso não estiver resolvido.


Exemplos esperados:


* evidências publicamente acessíveis;
* ausência de isolamento entre clientes;
* autorização quebrada;
* secrets expostos;
* possibilidade de usuário acessar evidência de outro cliente.
P1 — Necessário para Marco 1
Deve ser implementado antes de considerarmos o Marco 1 concluído, mas não representa necessariamente vulnerabilidade explorável imediata.
P2 — Melhoria
Importante, mas pode ser tratada posteriormente.


________________


13. Gere um plano técnico de implementação
Após entender o código, proponha uma sequência concreta.


Quero algo como:
Fase 1 — Fundação de tenancy
* criar tabela tenants;
* criar tenant_memberships;
* associar projetos ao tenant;
* associar evidências ao tenant;
* migration;
* backfill;
* middleware de tenant;
* atualização das queries.
Fase 2 — Autorização
...


Mas os passos devem refletir a arquitetura real encontrada no projeto.


Não invente nomes de arquivos, frameworks ou estruturas que não existam.


Para cada mudança indique:


* objetivo;
* componentes afetados;
* dependências;
* risco de regressão;
* testes necessários.


________________


14. Sugira o modelo mínimo de domínio
Avalie se algo semelhante a este modelo faz sentido:


Tenant
 ├── Membership
 │    └── User
 │
 └── Project
      ├── Execution
      │    └── Evidence
      └── Members

Não adote cegamente.


Compare com o modelo atual e proponha a menor mudança estrutural que garanta isolamento consistente.


Uma regra importante:


Entidades pertencentes a clientes não devem depender apenas de user_id para isolamento.


________________


15. Defina critérios objetivos de aceite do Marco 1
Ao final, produza uma checklist técnica que possa ser transformada posteriormente em testes.


Exemplos:


* Um usuário do Tenant A não consegue consultar Evidence do Tenant B mesmo conhecendo seu ID.
* Uma URL de evidência expirada não permite acesso ao arquivo.
* Evidências não possuem acesso público anônimo.
* Exclusão definitiva remove metadata e objeto correspondente do storage.
* Toda Evidence possui tenant identificável.
* Toda consulta de Evidence é contextualizada por tenant.
* Secrets não estão versionados.
* Toda comunicação externa ocorre via HTTPS.
* É possível identificar autor e data da criação/exclusão de uma evidência.


Expanda essa lista com base no projeto real.


________________


Formato do relatório
Entregue exatamente nesta estrutura:
1. Resumo executivo
Máximo de 15 linhas.


Explique:


* estado atual;
* maior risco encontrado;
* distância aproximada do Marco 1;
* principal mudança arquitetural recomendada.


________________


2. Arquitetura atual
Descreva objetivamente a arquitetura encontrada.


Inclua um diagrama Mermaid simples.


________________


3. Fluxo atual da evidência
Mostre o caminho completo do screenshot/evidência.


Inclua arquivos, endpoints e componentes relevantes.


________________


4. Matriz do Marco 1
Controle
	Estado
	Evidência encontrada
	Gap
	Prioridade
	Tenancy
	

	

	

	

	Autorização
	

	

	

	

	Storage privado
	

	

	

	

	Ciclo de vida
	

	

	

	

	Retenção/exclusão
	

	

	

	

	HTTPS
	

	

	

	

	Criptografia em repouso
	

	

	

	

	Secrets
	

	

	

	

	Audit logs
	

	

	

	

	

Adicione linhas quando necessário.


________________


5. Achados P0
Detalhe somente os bloqueadores.


Para cada um:


Problema Onde foi encontrado Cenário de risco Correção recomendada


________________


6. Achados P1
Mesmo formato.


________________


7. Proposta de tenancy
Explique:


* situação atual;
* modelo recomendado;
* alteração no modelo de dados;
* impacto nas APIs;
* impacto no storage;
* estratégia de migration/backfill.


Inclua um diagrama Mermaid do modelo proposto.


________________


8. Plano de implementação
Ordene tecnicamente as mudanças.


Use:


Etapa → alteração → dependência → critério de conclusão


Evite estimativa de horas neste momento.


________________


9. Critérios de aceite do Marco 1
Checklist testável.


________________


10. Marco 2 / backlog futuro
Liste separadamente os assuntos encontrados que são relevantes, mas não necessários para este marco.


________________


Regras importantes
1. Não implemente código ainda.
2. Não faça refatorações.
3. Não altere banco.
4. Não instale dependências.
5. Não conclua algo sem evidência no código/configuração.
6. Cite caminhos de arquivos e funções sempre que possível.
7. Diferencie vulnerabilidade real de melhoria arquitetural.
8. Não proponha complexidade desnecessária.
9. Não proponha microserviços apenas por segurança.
10. Considere que o objetivo é manter um monólito simples, porém seguro e preparado para B2B.
11. Se alguma conclusão depender da infraestrutura externa e você não tiver acesso a ela, marque como NÃO FOI POSSÍVEL VERIFICAR e informe exatamente o que Pedro precisa conferir.
12. Não exponha secrets encontrados.
13. Questione pressupostos da arquitetura quando necessário.
14. O resultado deve ser utilizável posteriormente como backlog técnico de segurança, não apenas como parecer genérico.


Ao terminar a investigação, faça também uma conclusão final respondendo objetivamente:


“Se amanhã colocássemos uma evidência real de um cliente neste sistema, quais são os três maiores riscos que assumiríamos?”


E:


“Qual é a menor sequência de mudanças capaz de eliminar esses riscos sem descaracterizar o monólito atual?”