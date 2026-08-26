# Print · Registro de subprocessadores

Marco 2, item subprocessadores. A lista dos terceiros que recebem ou processam dado tratado pelo Print, para quê, e com que salvaguarda. Cliente corporativo pede isto de cara num assessment, e a resposta precisa ser uma só, versionada, não improvisada por oportunidade.

Este é o recorte de quem toca o dado. O tratamento inteiro (papéis, finalidade, retenção) está em `seguranca-lgpd.md`.

Atualizado em 26/08/2026.

---

## O que conta como subprocessador

Terceiro que **recebe ou processa dado de cliente** em nome da Auditeste para o Print funcionar. Fornecedor que a Auditeste usa mas que **não toca o dado** não entra nesta lista, e a seção seguinte diz quais são e por que ficam de fora, porque essa distinção também é perguntada.

---

## Subprocessadores (recebem dado)

| Subprocessador | Para quê | Dado que recebe | Localização | Quando | Salvaguarda |
|---|---|---|---|---|---|
| **Railway** | Hospedagem e armazenamento do cofre | Tudo que é guardado: prints, contexto do passo, metadados | Estados Unidos, região US West | Ao enviar a evidência ao cofre | Conteúdo dos prints cifrado em repouso (AES-256-GCM) pela aplicação; acesso por conta e por equipe |
| **NVIDIA** | Descrição automática das telas | O print, o trecho de HTML e a URL da tela | Estados Unidos (nuvem NVIDIA) | **Só quando a descrição automática está ligada** (opt-in) | Enviado apenas sob consentimento explícito; desligado por padrão, nenhum dado sai para descrição |

Dois deles, e nada além. A descrição pela NVIDIA é o único envio que depende de o usuário ligar; desligada, o dado não sai da Railway.

---

## Não são subprocessadores (não recebem dado de cliente)

| Terceiro | Papel | Por que não entra |
|---|---|---|
| Provedor de identidade do cliente (Entra ID, Google, Okta) | Autenticar quem entra por SSO | É o provedor **do próprio cliente**, e ele confirma a identidade de quem entra; não recebe evidência nenhuma |
| GitHub | Hospedar o código e rodar o CI | Nenhum dado de cliente passa por lá; é código-fonte e automação de segurança |

Incluir isto de propósito: "vocês usam GitHub, então ele tem nossos dados?" é uma pergunta comum, e a resposta honesta é que ele tem o código, não a evidência.

---

## Transferência internacional

Os dois subprocessadores que recebem dado ficam nos **Estados Unidos**. É transferência internacional, e o contrato com o cliente (controlador) precisa cobrir isso. Mudar de região é decisão de infraestrutura e custo, registrada como item em aberto no `seguranca-lgpd.md`.

---

## Governança

- **Um subprocessador novo** que passe a receber dado entra nesta lista antes de ir para produção, e é avaliado na revisão de segurança (`seguranca-revisoes.md`).
- **Mudança no que um existente recebe** (por exemplo, um modelo novo da NVIDIA que peça dado adicional) atualiza a linha aqui.
- Cliente que exigir aviso prévio de mudança de subprocessador tem isso combinado em contrato; o mecanismo de aviso ainda não é formal, e é a lacuna conhecida deste registro.

---

## Evidência

| Afirmação | Onde se vê |
|---|---|
| A descrição pela NVIDIA é opt-in | `seguranca-arquitetura.md`, `seguranca-faq.md` |
| O conteúdo do print vai cifrado para a Railway | `teste-cifra.js` |
| Só estes dois recebem dado | Único host externo no código é `integrate.api.nvidia.com`; o resto do dado fica no volume da Railway |
