# Prova de segurança: teste você mesmo

Este guia é para você, cliente, **não precisar confiar na nossa palavra**. Em
vez de ler um relatório dizendo "é seguro", você mesmo executa os ataques e vê o
sistema barrar na hora. Leva uns 5 minutos e não exige conhecimento técnico.

Nada aqui depende de nós: cada passo é você quem faz, e boa parte usa
ferramentas de empresas de fora, que você pode rodar sozinho quando quiser.

---

## Parte 1: ataque o sistema você mesmo

O Audi Print tem uma página que executa os ataques de verdade contra ele próprio
e mostra o resultado na hora.

1. Entre no sistema com a sua conta.
2. Clique em **Segurança**.
3. Desça até **Prova ao vivo**.
4. Clique em **Testar todas**.

Cada linha fica **verde** quando a defesa recusou o ataque. Se qualquer uma
ficar vermelha, a defesa falhou e você viu na hora. O ponto é esse: é **você**
quem aperta o botão.

| O que você testa | O ataque que o botão executa | O que tem que aparecer |
|---|---|---|
| Isolamento entre clientes | Tentar ver um projeto de outro cliente | Vem vazio: não existe para você |
| Senha fraca | Cadastrar com a senha "12345" | Recusado antes de criar a conta |
| Nome de equipe repetido | Criar uma equipe com nome que já existe | Recusado |
| Convite inválido ou usado | Entrar com um convite forjado | Não encontrado |
| Força bruta | Errar a senha 8 vezes seguidas | A próxima tentativa é bloqueada |
| Segredo em repouso | Cifrar um dado agora e olhar | Sai ilegível |
| Link adulterado | Trocar um caractere na assinatura do link | O link é negado |
| Print exposto | Procurar um endereço público dos prints | Não existe |

Cada teste mostra também a data, a hora e o endereço do ambiente, então você pode
tirar um print da tela e guardar como comprovante.

---

## Parte 2: confirme com empresas de fora (neutras)

Aqui a nota não vem de nós: vem de serviços independentes que qualquer pessoa
usa. Você digita o endereço do sistema e vê a avaliação. Isso vale quando o
sistema está publicado (no ar).

| Serviço | O que ele avalia | Onde |
|---|---|---|
| SSL Labs | A qualidade da conexão cifrada (HTTPS) | ssllabs.com/ssltest |
| Mozilla Observatory | As proteções de resposta do servidor | observatory.mozilla.org |
| Security Headers | Os cabeçalhos de segurança | securityheaders.com |

Basta colar o endereço do sistema no campo de cada um e pedir a análise. A nota
que aparecer é de uma empresa que não é a Auditeste.

---

## Parte 3: o que cada defesa significa

- **Isolamento entre clientes**: mesmo sabendo o código de um projeto de outro
  cliente, você não alcança nada dele. Cada cliente só enxerga o próprio
  trabalho.
- **Segredo em repouso**: os prints são gravados embaralhados. Quem abrir o
  arquivo do banco não lê nada.
- **Link de curta duração**: um print só sai por um link assinado que vale
  poucos minutos e não pode ser adulterado.
- **Força bruta**: ninguém fica tentando senha até acertar; a conta trava.
- **Retenção**: as evidências somem sozinhas depois do prazo combinado.
- **Registro**: cada ação fica registrada, com quem fez e quando.

---

## Quer a prova mais forte?

Além de tudo acima, existe o padrão de mercado: um **teste de invasão
independente**, feito por uma empresa de fora, que entrega um laudo assinado.
Podemos combinar isso quando você quiser: o escopo já está preparado.
