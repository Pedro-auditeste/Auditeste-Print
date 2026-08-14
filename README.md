# Auditeste-Print

Pacote de acessibilidade da Auditeste: gravador de evidências, extensão de scan e ponte de ferramentas (axe-core, Pa11y, Lighthouse).

```
audi-print-scanner/   registra cliques + pares Antes/Depois e roda axe (extensão Chrome)
auditeste-a11y/       scans por linha de comando + ponte hospedável
audi-print/           grava evidências e importa JSON de acessibilidade
```

Documentação completa em [LEIA-ME.md](LEIA-ME.md).

## Deploy na Railway

1. Conecte este repositório na [Railway](https://railway.app).
2. O `railway.toml` usa o `Dockerfile` na raiz (Playwright + Node).
3. Variáveis no **card do serviço** (não só em Shared/projeto), com Runtime/Deploy ligado:
   - `NVIDIA_NIM_API_KEY` — **obrigatória para descrições e cenários** (NVIDIA `nvapi-...`; `AGENTE_API_KEY` continua aceito)
   - `AGENTE_BASE_URL` — opcional (`https://integrate.api.nvidia.com/v1`)
   - `AGENTE_MODELO` — opcional (`meta/llama-3.2-90b-vision-instruct`)
   - `PONTE_TOKEN` — para proteger scans
   - `PONTE_DOMINIOS` — opcional (allowlist)
4. Depois de salvar, faça **Redeploy**. Confira em `/ping`: `"cenarios": true`.
5. A Railway injeta `PORT` automaticamente. Healthcheck em `/ping`.

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
