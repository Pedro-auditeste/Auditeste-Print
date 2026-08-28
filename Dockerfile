# Railway: Node + Chrome do Puppeteer (sem Playwright - evita conflito de versao).
#
# Node 24 e nao 20 por causa do cofre: node:sqlite so existe do 22 em diante.
# Se este bump quebrar o build, voltar para node:20 e seguro: o cofre desliga
# sozinho (banco.js trata o require ausente) e o Print continua igual.
FROM node:24-bookworm-slim

WORKDIR /app

# Chrome e ffmpeg vem do apt (chromium), nao do download do puppeteer.
#
# O download do Chrome do puppeteer no build passou a travar o deploy na
# Railway depois do salto para o Chrome 152 (o binario baixado no build
# estourava o passo). O chromium do apt e confiavel, ja traz as libs que
# precisa, e nao depende de baixar nada no meio do build. a11y.js usa
# CHROME_PATH quando ele existe, entao o servidor aponta para este chromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation chromium ffmpeg wget xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--max-old-space-size=1536
ENV HOST=0.0.0.0
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY auditeste-a11y/package.json auditeste-a11y/package-lock.json ./
RUN npm ci --omit=dev

COPY auditeste-a11y/a11y.js auditeste-a11y/agente-cenarios.js auditeste-a11y/cenarios.js auditeste-a11y/servidor.js auditeste-a11y/rede-segura.js auditeste-a11y/traducoes-pa11y.js auditeste-a11y/carregar-env.js auditeste-a11y/extensao.js ./
COPY auditeste-a11y/cofre ./cofre
COPY audi-print-scanner ./audi-print-scanner
COPY auditeste-a11y/publico ./publico

EXPOSE 8900

CMD ["node", "servidor.js"]
