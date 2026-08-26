# Política de segurança

Obrigado por ajudar a manter o Audi Print seguro. Se você encontrou uma falha de segurança, este é o caminho para nos avisar.

> Contato: **pedro.rodrigues@auditeste.com.br**
> (Troque por um alias como `security@auditeste.com.br` se preferir um canal dedicado.)

## Como reportar

Mande um e-mail para o contato acima com o que puder:

- o que a falha permite fazer;
- o passo a passo para reproduzir;
- a URL ou a rota afetada;
- se possível, uma prova (print, requisição, trecho de log sem dado sensível).

Não abra uma *issue* pública para falha de segurança. O repositório é público, e uma issue exporia a falha antes de ela ser corrigida.

## Nosso compromisso

- **Confirmamos o recebimento em até 3 dias úteis** e informamos o desfecho.
- **Divulgação coordenada:** corrigimos antes de tornar a falha pública, num prazo combinado com você.
- **Sem retaliação:** relato de boa-fé é ajuda, não ataque. Não perseguimos quem reporta com responsabilidade.

Prazo de correção depende da gravidade: crítica no mesmo dia, alta em até 7 dias, média em até 30. O detalhe está em [`specs/seguranca-vulnerabilidades.md`](specs/seguranca-vulnerabilidades.md).

## Escopo

Vale a aplicação em produção (`https://audiprint.up.railway.app`) e o código deste repositório: autenticação, isolamento entre clientes, o cofre de evidências, o scanner de acessibilidade, o SSO e a extensão do Chrome.

Fora do escopo: a infraestrutura de terceiros (Railway, provedor de identidade, NVIDIA), negação de serviço, e engenharia social. Para um teste de segurança contratado, o escopo completo está em [`specs/seguranca-pentest-escopo.md`](specs/seguranca-pentest-escopo.md).

## Versões

O Print roda uma versão só, a que está no ar a partir da branch `main`. Correções vão para produção; não há versões antigas suportadas em paralelo.

## Como já trabalhamos a segurança

Este não é um produto sem controle esperando um aviso. Análise estática (CodeQL) e teste dinâmico (`dast.js`) rodam a cada envio e semanalmente, houve pentest interno, e cada controle tem um teste que o prova. O pacote inteiro está em [`specs/seguranca-README.md`](specs/seguranca-README.md).
