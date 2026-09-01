# Manager

Esqueleto do servico Manager da Auditeste, com o **nucleo de seguranca do Print
ja portado e testado**. O dominio do produto (o que o Manager gerencia) entra
depois, em cima desta base. Enquanto isso, existe um recurso de exemplo
(`/api/recursos`) so para o isolamento, a auditoria e a cifra terem algo real
para proteger.

## Rodar

```
node servidor.js        # sobe em http://127.0.0.1:4000 (ou PORT)
node teste-manager.js   # 14 testes de seguranca, atacando o servidor de verdade
```

Conta de producao NAO nasce pelo formulario, nasce pelo admin:

```
node admin.js criar-conta pessoa@empresa.com senhaforte Equipe admin
node admin.js listar
node admin.js backup
```

## Variaveis de ambiente

| Variavel | Para que |
|---|---|
| `MANAGER_BANCO` | caminho do arquivo do banco. Em producao, apontar para um volume. |
| `MANAGER_CHAVE` | hex de 64 para ligar a cifra em repouso. Ausente = grava em claro (o `/ping` avisa). |
| `MANAGER_SESSAO_MS` | duracao da sessao (padrao 12 h). |
| `PORT` | porta do servidor (padrao 4000). |

Gerar a chave: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
A chave nao pode morar no mesmo lugar do backup: perder a chave e perder o conteudo cifrado.

## Controles que ja saem do planejado (do checklist de seguranca)

Marco 1 e parte do Marco 2 do checklist, todos com teste que os trava:

- Tenant / Multitenancy: todo acesso filtra por cliente (`exigirTenant`).
- Autenticacao: senha scrypt, comparacao em tempo fixo.
- Autorizacao e RBAC: papel por vinculo; sessao cai quando o vinculo some.
- Criptografia em repouso: corpo do recurso em AES-256-GCM (marcador AUDIENC1).
- Storage privado: conteudo so pela aplicacao, id de outro cliente devolve 404.
- Audit log e Auditoria: acao registrada por cliente, isolada.
- Rate limiting: conta trava depois de 8 tentativas erradas (429).
- Validacao de payload e Limite de upload: json validado, corpo cortado em 1 MB.
- Security headers: nosniff, CSP, Referrer-Policy, HSTS quando https.
- Tratamento seguro de erros: 5xx nao devolve stack.
- Backup e Restore testado: `admin.js backup` confere na hora; o teste destroi e restaura.
- HTTPS/TLS: pela borda (Railway) + HSTS.

## O que falta para o produto

O que ainda depende de decisao de produto (ver o checklist):

- O dominio real do Manager, no lugar de `recursos`.
- SSO/OIDC (portar `sso.js` do Print quando um cliente exigir).
- DAST proprio (adaptar o `dast.js` do Print as rotas daqui).
- Os documentos de governanca, que ja valem para os tres servicos, estao em
  `../specs/governanca/`.

## Como estender com seguranca

1. Trocar a tabela `recursos` pelo dominio do Manager, mantendo `tenant_id` em
   toda tabela e todo SELECT/UPDATE passando por `exigirTenant`.
2. Toda rota nova entra depois do portao de sessao no `servidor.js`, e o tenant
   vem SEMPRE de `sessao.tenantId`, nunca do corpo do pedido.
3. Todo conteudo sensivel grava com `cifrar()` e volta com `decifrar()`.
4. Cada regra nova ganha um caso em `teste-manager.js` que falha se ela quebrar.
