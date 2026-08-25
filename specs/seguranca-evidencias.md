# Print · Evidências dos controles

O documento da Epic diz que Segurança corporativa trabalha com um princípio: **afirmação sem evidência é apenas uma declaração**.

Este arquivo é a ponte. Para cada controle afirmado nos outros documentos, aqui está o que o demonstra: um teste que se roda na frente de quem perguntou, ou um comando que devolve o estado real.

Atualizado em 25/08/2026.

---

## Como executar

Testes que não precisam de navegador, os que cobrem quase todos os controles:

```bash
cd auditeste-a11y && node teste-cofre.js
```

Os quatro que valem numa auditoria, em sequência:

```bash
cd auditeste-a11y && node teste-cofre.js && node teste-cifra.js && node teste-injecao.js && node teste-backup.js
```

A varredura dinâmica, que sobe o próprio alvo e ataca:

```bash
cd auditeste-a11y && node dast.js
```

A mesma varredura contra o ambiente que está no ar, só com as sondas que não gravam nada:

```bash
cd auditeste-a11y && node dast.js https://audiprint.up.railway.app
```

Estado de produção, sem autenticação, em qualquer terminal:

```bash
curl -s https://audiprint.up.railway.app/ping
```

---

## Marco 1 · Proteção da evidência

| Controle | Evidência | Como demonstrar |
|---|---|---|
| Isolamento entre clientes | `teste-cofre.js` | Casos marcados CRITERIO: um cliente tenta ler, listar, escrever e apagar dado de outro sabendo o id. Todos respondem não encontrado |
| Consulta sem cliente falha | `teste-cofre.js` | Chamar a camada de dados sem informar a equipe lança erro, não devolve tudo |
| Autenticação | `teste-cofre.js` | Senha errada, conta sem vínculo, cookie com as marcas corretas, e o token no banco só como hash |
| Força bruta | `teste-cofre.js` | Trava na oitava tentativa, e a trava é por conta: as outras seguem entrando |
| Sessão revogada | `teste-cofre.js` | Sair invalida; perder o vínculo derruba na hora, sem esperar o próximo login |
| Autorização por papel | `teste-cofre.js` | Consultor cria evidência e não consegue excluir nem ler auditoria |
| Storage privado | `teste-cofre.js` | Objeto sem sessão responde 401. Link assinado funciona; adulterar cliente ou validade na URL invalida |
| **Criptografia em repouso** | `teste-cifra.js` | Grava conteúdo conhecido, força o checkpoint, varre os três arquivos do banco e confirma que o texto **não aparece**. E que volta byte a byte pela aplicação |
| Cifra detecta adulteração | `teste-cifra.js` | Vira um byte no conteúdo cifrado dentro do banco: a leitura recusa em vez de devolver lixo |
| Ciclo de vida | `teste-cofre.js` | Evidência nasce com prazo, calculado a partir da retenção do cliente |
| Retenção | `teste-cofre.js` | Evidência vencida some na varredura, com o arquivo junto |
| Exclusão completa | `teste-cofre.js` | Excluir apaga metadado e arquivo; o arquivo excluído não baixa mais |
| Exclusão de um cliente inteiro | `teste-cofre.js` | Apaga tudo de um e não toca no outro. Exige o nome exato para confirmar |
| Audit log | `teste-cofre.js` | Confere que criar, ver, baixar e excluir aparecem, com quem e quando |
| Auditoria não vaza | `teste-cofre.js` | Um cliente não vê evento de outro |
| Auditoria não guarda segredo | `teste-cofre.js` | Lê a tabela e falha se encontrar cookie ou conteúdo sensível |
| Segredos fora do git | CI, tarefa `segredos` | Busca padrões de chave em toda a história a cada envio |
| HTTPS | `curl -I http://audiprint.up.railway.app` | Responde 301 para HTTPS. Cabeçalho HSTS presente |

---

## Marco 2 · Ambiente corporativo

| Controle | Evidência | Como demonstrar |
|---|---|---|
| Papéis | `teste-cofre.js` | Quatro papéis, com limite verificado por rota |
| Auditoria de permissão | `teste-cofre.js` | Roda o comando que vincula alguém e confere que ficou registrado |
| Limite por conta | `teste-cofre.js` | Trava no login após oito tentativas |
| Limite por sessão | `teste-cofre.js` | Sessão que ultrapassa o teto no minuto recebe 429 |
| Validação de entrada | `teste-cofre.js` | Campo com tipo errado ou acima do limite é recusado na porta |
| Cabeçalhos | `teste-privacidade.js` | Confere os quatro na página servida **e** no desvio do portão |
| CORS | `curl -I -H "Origin: https://x.com" .../ping` | Origem estranha recebe `null` |
| Backup e restauração | `teste-backup.js` | Grava, faz backup, **destrói o banco**, restaura, e confere que o print voltou byte a byte e que a senha continua valendo |
| Backup recusa arquivo alheio | `teste-backup.js` | Banco de outro sistema é recusado antes de encostar no original |
| Varredura de dependências | `npm run seguranca` | Lista as vulnerabilidades conhecidas. Roda também no CI, semanalmente |
| Integração contínua | `.github/workflows/seguranca.yml` | Quatro tarefas: dependências, segredos, testes e varredura dinâmica |
| Endereço da origem não é forjável | `dast.js` | Prefixo escrito pelo cliente em `X-Forwarded-For` não troca a identidade da origem, nem zera o teto, nem escolhe o que vai para a auditoria |

---

## Marco 3 · Demonstração

| Controle | Evidência | Como demonstrar |
|---|---|---|
| **Fronteira de confiança com o modelo** | `teste-injecao.js` | Sete ataques reais de manipulação, todos detectados. E texto legítimo de tela que **não** vira falso positivo |
| Conteúdo não escapa da fronteira | `teste-injecao.js` | Tentativa de fechar o próprio bloco não funciona: o delimitador é sorteado a cada chamada |
| Instrução escondida é vista | `teste-injecao.js` | Caractere invisível entre as letras não engana a detecção, porque a normalização vem antes |
| Resposta manipulada é descartada | `teste-injecao.js` | Resposta que repete a fronteira ou muda de papel é recusada |
| Aviso chega a quem lê | `teste-injecao.js` | Confere que o alerta entra no campo que a tela destaca no passo |
| **Entrada pelo provedor da empresa (SSO)** | `teste-sso.js` | 22 casos contra um provedor OIDC de mentira que o teste sobe: assinatura de outra chave, `alg: none`, outro emissor, outra audiência, token vencido, nonce trocado, e-mail não confirmado, e-mail de outro domínio, estado reusado |
| **Análise estática (SAST)** | `.github/workflows/codeql.yml` | CodeQL com `security-extended`, a cada envio e semanalmente. Achou e derrubou um vazamento de erro interno |
| **Teste dinâmico (DAST)** | `dast.js` | 40 sondas contra o servidor em execução: rota sem sessão, id de outro cliente, link assinado remendado, campo a mais no corpo, injeção de SQL, travessia de caminho, CRLF, corpo gigante e freio de varredura |
| **Pentest interno** | `seguranca-pentest.md` | Ataque manual à fronteira inteira. Achou SSRF por rebind de DNS no scanner, corrigido |
| Fronteira de saída (SSRF) | `teste-ssrf.js` | Nome que resolve para público e privado ao mesmo tempo é recusado; o host validado é preso ao IP no navegador, tirando a brecha entre a checagem e a navegação |
| A varredura não envelhece calada | `dast.js` | Lê as rotas do próprio `api.js`: rota nova que ninguém classificou vira achado, e não silêncio |
| Arquitetura documentada | `seguranca-arquitetura.md` | Componentes, fronteiras de confiança e diagramas |
| Fluxo do dado | `seguranca-arquitetura.md` | Origem até descarte, com quem autoriza cada etapa |
| Perguntas frequentes | `seguranca-faq.md` | As dez que sempre vêm, com resposta oficial |
| Questionário de fornecedor | `seguranca-faq.md` | Formato de resposta direta, por categoria |

---

## Demonstração ao vivo, em dez minutos

Roteiro para quando alguém de Segurança pedir para ver, e não para ler.

**1. O isolamento, com dois clientes de verdade.**

```bash
cd auditeste-a11y && node teste-cofre.js
```

Aponte para os casos marcados CRITERIO. A tentativa de ler o dado de outro cliente sabendo o id está ali, executando.

**2. A cifra, abrindo o arquivo.**

```bash
node teste-cifra.js
```

O caso que importa grava um texto conhecido e prova que ele **não aparece** dentro do arquivo do banco.

**3. A recuperação, destruindo o banco.**

```bash
node teste-backup.js
```

O teste apaga o banco de propósito e prova que a evidência volta byte a byte.

**4. A manipulação da evidência.**

```bash
node teste-injecao.js
```

Sete tentativas reais de fazer a descrição mentir, todas marcadas.

**5. O estado real do serviço.**

```bash
curl -s https://audiprint.up.railway.app/ping
```

`cofre`, `cifra`, `portao`, `semVolume`, `exigeToken`: o sistema declarando a própria configuração.

**6. A porta fechada.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Origin: https://audiprint.up.railway.app" \
  "https://audiprint.up.railway.app/scan?tipo=axe&url=https://example.com"
```

Responde 401. Esta chamada já respondeu 200 e devolveu resultado: era o furo que originou todo este trabalho, e o comando existe aqui justamente para mostrar que fechou.

---

## O que não tem evidência, e por quê

Ser honesto sobre isso é parte do controle. Se alguém perguntar por um destes, a resposta é não:

| Item | Situação |
|---|---|
| Criptografia do volume pelo provedor | Não verificada. Depende de configuração de infraestrutura, não de código |
| 22 vulnerabilidades de dependência | Conhecidas e registradas. Correção exige mudança de versão maior nos motores de scan |
| Pentest independente | Não realizado. Houve pentest interno (`seguranca-pentest.md`), mas quem fez o código não substitui gente de fora atacando sem o mapa mental de quem construiu |
| Egress filtering na rede do contêiner | Não configurado. Fecha o residual da SSRF (redirect e sub-recurso para rede interna). É infraestrutura na Railway, não código |
| Múltiplos fatores próprios | Não existem. Quem entra por SSO usa o fator que a empresa dele exige, e quem entra por senha não tem segundo fator |
| Teste dinâmico contra falha de lógica nova | A varredura cobre o que ela conhece. Falha que ninguém previu não aparece nela, e é para isso que serve pentest |
| Plano de resposta a incidente | Não existe |
| Política de retenção contratual | O sistema aplica o que for configurado. O número que vale por contrato não está definido |
| Backup fora do provedor | O comando existe e é testado. O procedimento de guardar cópia externa não está estabelecido |
| Injeção escrita dentro da imagem | A detecção lê texto, não pixel. Coberta apenas pela fronteira declarada no prompt |

---

## Regra para manter isto verdadeiro

Controle que perde o teste perde a linha nesta tabela. Uma tabela que envelhece vira o oposto do que ela existe para ser: uma declaração sem evidência, com aparência de prova.
