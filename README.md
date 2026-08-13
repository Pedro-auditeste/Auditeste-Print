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
2. O `railway.toml` usa o `Dockerfile` na raiz (Playwright + Node).
3. Defina as variáveis de ambiente:
   - `PONTE_TOKEN` — **obrigatório para scans** (string longa e aleatória)
   - `AGENTE_API_KEY` — **obrigatória para a IA** (NVIDIA `nvapi-...`; descreve prints e gera cenários)
   - `PONTE_DOMINIOS` — opcional (allowlist de domínios para scan)
4. A Railway injeta `PORT` automaticamente; o servidor já lê.
5. Healthcheck em `/ping` — o serviço sobe mesmo sem token, mas scans ficam bloqueados até configurar `PONTE_TOKEN`.

Depois do deploy, abra a URL gerada — o Audi Print fica em `/`. A landing page fica em `/inicio.html`.

### API da ponte (scans)

| Endpoint | Uso |
|---|---|
| `GET /ping` | Healthcheck + status dos motores |
| `GET /scan?tipo=axe&url=...` | axe-core (Playwright) |
| `GET /scan?tipo=pa11y&url=...` | Pa11y (Chrome/Puppeteer) |
| `GET /scan?tipo=nota&url=...` | Lighthouse (alias: `lighthouse`) |

Header: `Authorization: Bearer <PONTE_TOKEN>`

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
