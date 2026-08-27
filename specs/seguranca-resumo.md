# Print · Resumo de segurança

Visão geral do que o Audi Print faz para proteger a evidência de teste, e como cada parte funciona. É o mapa de uma página; o detalhe e a prova de cada item estão nos outros documentos de `specs/`, reunidos em [`seguranca-README.md`](seguranca-README.md).

Atualizado em 26/08/2026.

---

## Onde a evidência mora

| Caminho | Como funciona | Fica online? |
|---|---|---|
| Local (padrão) | "Salvar no projeto" grava no navegador (IndexedDB); "Backup" exporta um arquivo `.json` com tudo, que você guarda | Não |
| Cofre (opcional) | "Enviar ao cofre" manda o print para o servidor, sob a sua conta e cliente | Sim, cifrado |

## Proteção do dado

| Controle | Como funciona |
|---|---|
| Cifra em repouso | A imagem do print é cifrada com AES-256-GCM antes de gravar no banco; sem a `COFRE_CHAVE` só se vê bytes embaralhados. Nome de projeto e URL ficam em texto |
| Storage privado | O arquivo nunca é URL pública; sai por link assinado (HMAC) que amarra objeto + cliente + validade de 5 min, ou por sessão |
| Retenção | Cada cliente tem um prazo (90 dias padrão); uma varredura roda de hora em hora e apaga o que venceu |
| Exclusão segura | Apaga metadado e arquivo juntos, sem deixar órfão; a linha da auditoria fica, pra exclusão continuar comprovável |

## Quem entra e o que pode

| Controle | Como funciona |
|---|---|
| Login antes de entrar | O portão do servidor barra o acesso sem sessão válida (fora do loopback) |
| Senha | Guardada com scrypt (sal por usuário); nunca em texto |
| Força bruta | Trava a conta após 8 tentativas em 15 min |
| Sessão | Cookie HttpOnly + SameSite + Secure, guardado só como hash; revogado ao sair e ao perder o vínculo |
| Papéis | leitor (vê), consultor (cria), gestor (convida/audita/exclui), admin (exclui a equipe); limite conferido por rota |
| SSO (OIDC) | Entra pelo provedor da empresa (Entra ID/Google/Okta); token verificado por assinatura, emissor, audiência, validade, nonce e domínio; conta criada no 1º acesso |

## Isolamento entre clientes

| Controle | Como funciona |
|---|---|
| Tenant obrigatório | Toda consulta ao banco exige o id da equipe, que vem da sessão, nunca do pedido; id de outro cliente volta como "não existe" |
| Uso único do convite | Consumo atômico no banco (`WHERE usado_em IS NULL`); dois cadastros com o mesmo convite, o segundo é recusado e desfeito |

## Defesa da aplicação

| Controle | Como funciona |
|---|---|
| Rate limit | Teto por sessão (240/min) e por origem (600/min); o IP é lido na posição confiável, não do que o cliente manda |
| Validação de entrada | Cada campo é checado por tipo e tamanho; corpo torto responde 400, não 500 |
| Upload / MIME | Tipo por allowlist e teto de tamanho; arquivo fora da lista é recusado |
| Cabeçalhos e CORS | nosniff, frame-ancestors none, HSTS em https; origem estranha recebe `null` |
| HTTPS forçado | http é redirecionado para https pela própria aplicação, não só pela borda |
| SSRF no scanner | O destino é validado e o IP validado é "preso" no navegador, fechando rebind de DNS |
| Prompt injection (IA) | O conteúdo do cliente vai dentro de uma fronteira com delimitador sorteado; tentativa de dar ordem é marcada e a saída é conferida |

## Verificação contínua

| Controle | Como funciona |
|---|---|
| SAST | CodeQL (`security-extended`) lê o código a cada envio e semanalmente |
| DAST | `dast.js`, 40 sondas atacando o servidor em execução, a cada envio e contra produção semanal |
| Pentest interno | Três voltas manuais (servidor, extensão, lógica de conta), 8 achados, os reais corrigidos com teste |
| Dependências | `npm audit` = 0; as 22 vulnerabilidades foram zeradas (puppeteer 25, lighthouse 13) |
| Branch protection | `main` exige PR + 1 aprovação + os 5 checks verdes; sem force push |
| Canal de report | `SECURITY.md` no repo, com prazo de resposta e divulgação coordenada |

## Backup e recuperação

| Controle | Como funciona |
|---|---|
| Backup do cofre | `VACUUM INTO` tira uma cópia consistente; teste destrói o banco, restaura e confere byte a byte |
| Backup local do Print | Exporta o projeto inteiro (fichas, prints, vídeo) num arquivo que você guarda fora da nuvem, e restaura depois |

## Documentos (no repo, em `specs/`)

| Documento | Para quê |
|---|---|
| `seguranca-README.md` | Índice do pacote, aponta cada doc e para quem serve |
| `seguranca-arquitetura.md` | Como o produto é por dentro e o caminho do dado |
| `seguranca-evidencias.md` | Cada controle com o teste/comando que o prova |
| `seguranca-faq.md` | Perguntas de assessment respondidas |
| `seguranca-pentest.md` + `-escopo.md` | Pentest interno e o escopo para contratar o independente |
| `seguranca-incidentes.md` | Plano de resposta a incidentes |
| `seguranca-lgpd.md` + `-subprocessadores.md` | RoPA e a lista de quem recebe dado (Railway, NVIDIA) |
| `seguranca-vulnerabilidades.md` + `-revisoes.md` | Como uma falha é tratada e a cadência de revisão |
| `seguranca-sdlc.md` | Como uma mudança chega à produção sem furar um controle |

---

## O que ainda depende de decisão, não de código

Ser honesto sobre isto faz parte do controle.

| Item | O que é necessário |
|---|---|
| Plano pago da Railway | Sem ele, o trial expira e o serviço sai do ar |
| Guardar a `COFRE_CHAVE` fora da Railway | Sem a chave, o que está no cofre fica ilegível |
| Egress filtering | Config de infra que fecha o resíduo da SSRF |
| Pentest independente | Contratar uma firma; o escopo já está pronto |
| DPO e contratos (DPA, retenção) | Decisão de negócio e jurídico |

A parte de **código e documento** da postura de segurança está completa e testada. O que falta são decisões de operação, infraestrutura e negócio.
