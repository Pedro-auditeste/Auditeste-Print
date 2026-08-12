# Auditeste-Print

Pacote de acessibilidade da Auditeste: gravador de evidências, extensão de scan e ponte de ferramentas (axe-core, Pa11y, Lighthouse).

```
audi-print-scanner/   escaneia o que está na tela (extensão Chrome)
auditeste-a11y/       scans por linha de comando + ponte hospedável
audi-print/           grava evidências e importa JSON de acessibilidade
```

Documentação completa em [LEIA-ME.md](LEIA-ME.md).

## Deploy na Railway

1. Conecte este repositório na [Railway](https://railway.app).
2. O `railway.toml` já aponta o build para `auditeste-a11y/Dockerfile`.
3. Defina as variáveis de ambiente:
   - `PONTE_TOKEN` — **obrigatório** (string longa e aleatória)
   - `ANTHROPIC_API_KEY` — opcional (habilita cenários por IA)
   - `PONTE_DOMINIOS` — opcional (allowlist de domínios para scan)
4. A Railway injeta `PORT` automaticamente; o servidor já lê.

Depois do deploy, abra a URL gerada — o Print é servido em `/` pela própria ponte.

## Uso local (ponte)

```bash
cd auditeste-a11y
npm install
npx playwright install chromium
npx puppeteer browsers install chrome
npm run servidor
```

Ou dê duplo clique em `auditeste-a11y/ponte.cmd`.

## Audi Print (sem instalação)

Abra `audi-print/evidencias-auditeste.html` com duplo clique, ou sirva por localhost:

```bash
cd audi-print
python -m http.server 8080
```
