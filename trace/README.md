# Trace

Servico Trace da Auditeste com o **nucleo de seguranca do Print portado,
completo e testado**. O dominio do produto (o que o Trace gerencia) entra no
lugar do recurso de exemplo (`/api/recursos`), que existe para o isolamento, a
cifra, o link assinado, a retencao e a exclusao terem algo real para proteger.

## Rodar

```
node servidor.js        # sobe em http://127.0.0.1:4000 (ou PORT)
node teste-trace.js   # 26 testes de seguranca, atacando o servidor de verdade
node dast.js            # 14 sondas dinamicas (o caminho errado e recusado?)
```

Conta de producao NAO nasce pelo formulario, nasce pelo admin:

```
node admin.js criar-conta pessoa@empresa.com senhaforte Equipe admin
node admin.js sso Equipe https://login.empresa.com cliente-id segredo empresa.com
node admin.js poda        # remove recurso vencido
node admin.js backup
node admin.js listar
```

## Variaveis de ambiente

| Variavel | Para que |
|---|---|
| `TRACE_BANCO` | caminho do banco. Em producao, apontar para um volume. |
| `TRACE_CHAVE` | hex de 64 para a cifra em repouso. Ausente = grava em claro (o `/ping` avisa). |
| `TRACE_SEGREDO` | hex para assinar link temporario. Ausente = link desligado. |
| `TRACE_ORIGINS` | origens liberadas no CORS, separadas por virgula. Vazio = nenhuma. |
| `TRACE_SESSAO_MS` | duracao da sessao (padrao 12 h). |
| `PORT` | porta do servidor (padrao 4000). |

Gerar chave/segredo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
A chave nao pode morar no mesmo lugar do backup: perder a chave e perder o conteudo cifrado.

## Controles de seguranca ja reais (com teste)

- Tenant / Multitenancy, Autenticacao (scrypt), Autorizacao e RBAC (papel por vinculo, acao barrada por papel)
- Criptografia em repouso (AES-256-GCM), Storage privado (link assinado HMAC que expira; id alheio devolve 404)
- Ciclo de vida, Retencao (prazo por equipe) e Exclusao segura (metadado + corpo juntos; poda do vencido)
- Audit log e Auditoria por cliente, Rate limiting (429), Validacao de payload, Limite e tipo de arquivo
- Security headers, CORS restritivo por allowlist, Tratamento de erros sem stack
- SSO / OIDC (assinatura, iss, aud, exp, nonce e state de uso unico, dominio conferido)
- Backup por VACUUM INTO conferido, com restauracao testada
- DAST proprio (`dast.js`); evidencia dos controles = a saida dos testes

## O que ainda depende de decisao

- O dominio real do Trace, no lugar de `recursos`.
- Pentest externo: contratacao de gente de fora. O equivalente interno (DAST + bateria) ja roda.
- Documentos de governanca da empresa: em `../specs/` (valem para os tres servicos).

## Como estender com seguranca

1. Trocar a tabela `recursos` pelo dominio do Trace, com `tenant_id` em toda tabela e `exigirTenant` em toda consulta.
2. Rota nova entra depois do portao de sessao no `servidor.js`; o tenant vem SEMPRE de `sessao.tenantId`.
3. Conteudo sensivel grava com `cifrar()` e volta com `decifrar()`; acao destrutiva checa `podeExcluir`/`podeAdministrar`.
4. Cada regra nova ganha um caso em `teste-trace.js` que falha se ela quebrar.

## Fluxo de dados e fronteiras de confianca

```
[navegador do usuario]
   |  HTTPS (borda), cookie de sessao HttpOnly
   v
=== FRONTEIRA: portao de sessao (servidor.js) ===
   |  tenant vem SEMPRE da sessao, nunca do corpo
   v
[Trace: rotas /api]  --RBAC por papel-->  [banco.js: exigirTenant em toda consulta]
   |                                        |
   |  corpo cifrado (AES-256-GCM)           v
   +------------------------------->  [SQLite: recursos.corpo cifrado, auditoria]
   ^
   |  link assinado (HMAC, expira em minutos)
[acesso ao objeto sem sessao] === FRONTEIRA: assinatura valida ou 403 ===
```

**O que atravessa cada fronteira e o que e conferido:**

- Navegador para servico: so com cookie de sessao valido (senao 401). Cross-origin so para origem na allowlist (CORS).
- Servico para banco: toda consulta carrega o tenant da sessao; `exigirTenant` recusa consulta sem ele.
- Acesso por link: so com assinatura HMAC valida e dentro do prazo; remendar qualquer campo derruba (403).
- Conteudo sensivel nunca toca o disco em claro: entra por `cifrar()`, sai por `decifrar()`.

**Dado tratado (inventario):** usuario (e-mail e hash scrypt da senha), recurso do
dominio (nome, tipo, corpo cifrado, prazo), e auditoria (acao, recurso, quando, ip).
Nenhum dado sai para modelo de linguagem: o Trace nao usa modelo, entao nao ha
superficie de injecao de prompt a proteger.
