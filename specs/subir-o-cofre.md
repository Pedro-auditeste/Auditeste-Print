# Subir o cofre · passo a passo

Ordem importa. O passo 1 fecha uma falha que está viva em produção agora, e não depende de nada. Os outros constroem o cofre.

Ao fim de cada passo há como conferir que deu certo. Se a conferência não bater, pare ali: seguir em frente só empilha problema.

---

## Passo 1 · Fechar a porta aberta da ponte

**Só isto já vale o dia.** Hoje qualquer pessoa na internet usa a chave da NVIDIA da Auditeste, porque o único portão confere o cabeçalho `Origin`, que um `curl` forja em um segundo.

No serviço da Railway, aba Variables:

```
PONTE_TOKEN=<cole um segredo longo e aleatório>
PONTE_ORIGENS=https://audiprint.up.railway.app
```

Para gerar o segredo:

```bash
openssl rand -hex 32
```

Depois do redeploy, confira que fechou:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://audiprint.up.railway.app" "https://audiprint.up.railway.app/scan?tipo=axe&url=https://example.com"
```

Antes respondia **200**. Agora tem que responder **401**.

### Não precisa colar o token em lugar nenhum

Isto mudou depois que o cofre entrou. Sua **sessão** autoriza os scans: o
cookie viaja sozinho e o campo de token saiu da tela.

O `PONTE_TOKEN` continua valendo para o que ele é bom de verdade: chamada de
fora do navegador, script, integração. E para quem abre o Print direto do
disco, onde o cookie não viaja.

---

## Passo 2 · Merge no `main`

A Railway implanta o `main`. Enquanto o merge não acontece, nada do cofre existe.

```bash
git checkout main && git merge seguranca-print && git push
```

Confira que subiu, olhando o `/ping`:

```bash
curl -s https://audiprint.up.railway.app/ping
```

Deve aparecer um campo `cofre`. Se ele disser `COFRE_BANCO não definido`, está certo: o cofre está desligado porque você ainda não fez o passo 3.

**Se o deploy falhar no build**, é o Node 24. O `Dockerfile` subiu de `node:20` para `node:24` porque o SQLite embutido só existe do 22 em diante. Troque de volta para `node:20`: o cofre se desliga sozinho e todo o resto continua funcionando.

---

## Passo 3 · Volume

**Este é o passo que causa perda silenciosa se for pulado.** O cofre guarda tudo num arquivo. O disco padrão do contêiner é apagado a cada deploy. Sem volume, o cofre aceita as evidências normalmente e some com todas na próxima subida, sem erro nenhum na tela.

Na Railway, no serviço: Settings, Volumes, criar volume com mount path `/dados`.

---

## Passo 4 · Ligar o cofre

Ainda em Variables:

```
COFRE_BANCO=/dados/cofre.db
COFRE_SEGREDO=<outro segredo longo, diferente do PONTE_TOKEN>
```

`COFRE_BANCO` é o que **liga** o cofre. `COFRE_SEGREDO` assina os links temporários de evidência; sem ele o servidor sorteia um a cada subida e os links de 5 minutos param de valer no deploy.

Confira:

```bash
curl -s https://audiprint.up.railway.app/ping
```

O campo `cofre` agora tem que ser `true`.

### Atenção: aqui o Print passa a exigir login

Ligar o cofre liga junto o portão. A partir deste momento, abrir
`https://audiprint.up.railway.app` sem sessão devolve um desvio para a tela de
entrada, e o HTML do Print nem chega em quem não entrou. Depois de entrar, a
pessoa volta sozinha para onde queria ir.

A regra é essa mesma, e é única de propósito: **cofre ligado, portão de pé**.
Não existe chave separada para esquecer ligada ou desligada.

O que **não** muda: os projetos que já estão gravados continuam no IndexedDB
do seu navegador, na mesma origem. Entrar não apaga nem esconde nada. E o
`/ping`, a tela de entrada e o pacote da extensão seguem abertos, senão a
Railway derrubaria o serviço e ninguém conseguiria nem instalar o complemento.

Se o login quebrar e você ficar trancado do lado de fora dos próprios
projetos, existe saída sem deploy:

```
COFRE_PRINT_ABERTO=1
```

Isso derruba o portão e mantém o cofre funcionando. Use como emergência, não
como configuração permanente.

Para conferir que o portão está de pé, o `/ping` também responde `portao`.

---

## Passo 4b · Cifra dos prints

```
COFRE_CHAVE=<segredo de 64 hex>
```

Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Com ela, o conteúdo dos prints deixa de ser legível dentro do arquivo do
banco. O `/ping` passa a responder `cifra: true`.

**Leia antes de definir:**

* **Perder a chave é perder os prints.** Não há recuperação, e é isso que faz
  cifra ser cifra. Guarde fora da Railway, e não no mesmo lugar do backup.
* **Variável nova só vale depois de reiniciar o serviço.** O processo que já
  está no ar continua com o ambiente antigo. Se o `/ping` insistir em
  `cifra: false`, é isso: Deployments, três pontos, Restart.
* **Trocar o valor depois torna ilegível tudo que foi gravado antes.** Girar
  a chave de verdade exige decifrar e recifrar, e esse comando não existe.

Detalhes em `specs/segredos-e-chaves.md`.

---

## Passo 5 · Primeira conta

Duas formas. A segunda é mais simples e provavelmente é a sua.

### Pela tela

Abra `https://audiprint.up.railway.app/cofre.html`, aba **Criar conta**, informe e-mail, senha e o nome da equipe. Você vira admin dela.

### Pela linha de comando

Use esta quando quiser definir a retenção do cliente na criação. No shell do serviço:

```bash
node cofre/admin.js criar-cliente "Ailos" 90
```

Ele devolve o id. Depois:

```bash
node cofre/admin.js criar-usuario voce@auditeste.com <id-que-apareceu> admin
```

A senha aparece **uma vez**. Anote. Ou defina `COFRE_SENHA` antes, com pelo menos 12 caracteres.

---

## Passo 6 · Recarregar a extensão

O complemento mudou: mascaramento de CPF e cartão, `file://` fechado, retenção de 7 dias, descarte ao excluir projeto. O manifest está em 2.2.0 para dar para conferir de olho.

Em `chrome://extensions`, botão de recarregar no cartão da extensão. Confirme que o número virou 2.2.0.

---

## Passo 7 · Backup

Com o cofre no ar, tire o primeiro backup e confira que ele presta:

```bash
node cofre/admin.js backup /dados/backups/cofre-inicial.db
```

Ele já confere o que escreveu e mostra a contagem por tabela. Backup que ninguém abriu é só um arquivo grande com nome tranquilizador.

Para levar para fora do servidor, que é o que realmente protege contra perder o volume:

```bash
railway ssh "cat /dados/backups/cofre-inicial.db" > cofre-inicial.db
```

### Restaurar

```bash
node cofre/admin.js conferir /dados/backups/cofre-inicial.db
node cofre/admin.js restaurar /dados/backups/cofre-inicial.db
```

O `conferir` roda sozinho e não encosta em nada. O `restaurar` confere antes, renomeia o banco atual em vez de apagar, e avisa para reiniciar o serviço: o servidor que já estava no ar continua lendo o arquivo antigo até reiniciar.

Se o banco estiver em uso, ele recusa e não mexe em nada.

---

## Passo 8 · Conferir na prática

Vale meia hora e responde a pergunta que a Ailos vai fazer.

1. Crie a equipe **Google** pela tela, e um projeto nela.
2. Numa janela anônima, crie a equipe **Amazon**.
3. Com a Amazon, tente abrir o projeto do Google pelo endereço direto. Tem que dar não encontrado.
4. Publique uma evidência do Print pelo botão **Enviar ao cofre**.
5. Copie o endereço da imagem e abra em janela anônima. Tem que dar 401.
6. Abra **Auditoria** e veja quem criou, viu e baixou.

---

## Depois

O que continua fora, e é honesto dizer:

* **Criptografia em repouso** depende de como a Railway cifra o volume. Nenhum código prova isso. Enquanto ninguém confirmar, esse item do Marco 1 fica em aberto.
* **Backup automático e fora do servidor.** O comando existe e é testado; agendar e guardar em outro lugar é decisão sua.
* **Prompt injection.** Tratado: o conteúdo do sistema testado vai dentro de
  uma fronteira declarada, tentativa de dar ordem é marcada na evidência, e a
  saída é conferida. O limite conhecido: texto escrito **dentro da imagem** não
  é lido pela detecção. Ver `auditeste-a11y/cofre/injecao.js`.
* **Vulnerabilidades de dependência.** 22, sendo 6 altas, todas na cadeia do
  navegador headless. Exigem mudança de versão maior e mexem nos motores de
  scan. `npm run seguranca` mostra a lista.

---

## Variáveis, todas

Obrigatórias para o cofre:

| Variável | Para quê |
|---|---|
| `COFRE_BANCO` | Caminho do arquivo. Liga o cofre. Tem que ser no volume |
| `COFRE_SEGREDO` | Assina os links temporários de evidência |

Obrigatórias para fechar a ponte:

| Variável | Para quê |
|---|---|
| `PONTE_TOKEN` | Exige segredo de verdade em vez de confiar num cabeçalho |
| `PONTE_ORIGENS` | Limita de quais endereços o navegador fala com a ponte |

Opcionais, com padrão razoável:

| Variável | Padrão | Para quê |
|---|---|---|
| `COFRE_CADASTRO` | `aberto` | `fechado` tira o cadastro livre e deixa só convite |
| `COFRE_MAX_EQUIPES_IP` | `5` | Quantas equipes novas por origem, por 15 minutos |
| `COFRE_TETO_MINUTO` | `240` | Chamadas por minuto por sessão |
| `COFRE_SESSAO_MS` | 12 h | Quanto dura o login |
| `COFRE_MAX_OBJETO_MB` | `20` | Teto por print ou vídeo |
| `COFRE_LINK_MS` | 5 min | Validade do link assinado |
| `COFRE_VARRER_MS` | 1 h | De quanto em quanto tempo a retenção roda |
| `COFRE_SENHA` | sorteada | Senha ao criar conta pela linha de comando |
| `COFRE_CHAVE` | vazio | Cifra o conteúdo dos prints. Perder é perder os prints |
| `COFRE_TETO_IP` | `600` | Chamadas por minuto por origem |
| `PONTE_HOST` | o domínio que a Railway informa | O endereço público desta instalação. Sem ele, e fora da Railway, quem decide o destino do redirecionamento para https é o cabeçalho do pedido |
| `PONTE_PROXIES` | `1` | Quantos proxies confiáveis existem na frente. É por ele que se descobre o endereço real de quem chamou dentro do `X-Forwarded-For`. Fora de proxy nenhum, use `0` |
| `COFRE_PRINT_ABERTO` | vazio | `1` derruba o portão do Print. Saída de emergência |
