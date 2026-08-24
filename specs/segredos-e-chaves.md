# Inventário de segredos e chaves

Onde cada segredo vive, o que ele protege, e o que acontece se for perdido ou vazar. Existe porque "afirmação sem evidência é apenas uma declaração", e a pergunta que a Segurança do cliente faz não é "vocês protegem os segredos?", é "quais são, onde estão, e quem alcança?".

Nenhum valor real aparece aqui. Este documento diz **onde procurar**, nunca **o quê**.

---

## Os segredos

| Nome | Onde vive | Protege | Se vazar | Se perder |
|---|---|---|---|---|
| `AGENTE_API_KEY` | Variável do serviço na Railway | A conta de IA da Auditeste | Terceiro gasta a cota e usa o serviço por nossa conta | Descrição de print para de funcionar. Print continua |
| `PONTE_TOKEN` | Variável na Railway, e no campo Token dentro do Print, por navegador | `/scan`, `/descrever`, `/cenarios` | A ponte volta a ser aberta para a internet | Gerar outro e colar dos dois lados |
| `COFRE_SEGREDO` | Variável na Railway | Assina os links temporários de evidência | Links forjáveis para qualquer objeto | Links de 5 min param de valer. Nada se perde |
| `COFRE_CHAVE` | Variável na Railway | Cifra o conteúdo dos prints no banco | Quem tiver o arquivo do banco lê os prints | **Os prints ficam ilegíveis para sempre** |
| Senha de conta | Só o hash scrypt, na tabela `usuarios` | Acesso de uma pessoa | Nada direto: é hash com sal | `admin.js senha <email>` |
| Token de sessão | Só o hash sha256, na tabela `sessoes` | Sessão aberta | Nada: o valor está no cookie do navegador, não no banco | A pessoa entra de novo |
| Código de convite | Só o hash sha256, na tabela `convites` | Entrada numa equipe | Nada: o hash não serve para entrar | Gerar outro |

A linha que mais importa é a do `COFRE_CHAVE`. **Ela não pode morar no mesmo lugar do backup.** Se a chave e o backup se perderem juntos, os prints somem; se vazarem juntos, a cifra não serviu para nada.

---

## O que nunca esteve no git

Verificado na história inteira, não só no estado atual:

```bash
git log --all -p | grep -oE "nvapi-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9]{20,}"
```

O único resultado é `nvapi-sua-chave-aqui`, o texto de exemplo do `.env.example`. Nenhuma chave real jamais entrou.

O `.gitignore` cobre `.env`, `.env.*`, `chave.txt` e a pasta local do banco. O CI roda essa mesma busca a cada push e falha se algo aparecer.

---

## Como girar cada um

**`PONTE_TOKEN`**: gere um novo, troque na Railway, e cole no campo Token do Print em cada navegador. Enquanto não colar, os scans respondem 401.

**`COFRE_SEGREDO`**: troque quando quiser. Só invalida links que ainda não expiraram.

**`AGENTE_API_KEY`**: gere outra em build.nvidia.com e substitua.

**`COFRE_CHAVE`**: **não gire sem plano.** O que foi gravado com a chave antiga só abre com ela. Girar exige decifrar e recifrar todo o conteúdo, e hoje não existe comando para isso. Se precisar, é trabalho a fazer antes, não durante.

Para gerar qualquer um deles:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## O que fica em claro, e por quê

O banco guarda em texto: nome de equipe, nome de projeto, título e observação da evidência, seletor do elemento, HTML capturado, e as URLs das telas.

Cifrei o conteúdo dos prints e não o resto porque o print **é** a evidência: é nele que aparece a tela do cliente. Cifrar o metadado e deixar a imagem em claro seria teatro. Se um dia o metadado também precisar de cifra, o lugar é o mesmo `banco.js`, e o custo é que consultar por nome deixa de funcionar.

O `valor` digitado e o `html` já passam pelo mascaramento do complemento antes de chegar aqui: senha, CPF, CNPJ e cartão saem antes de virar evidência.
