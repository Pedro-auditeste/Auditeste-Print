# Railway: Node + Chrome do Puppeteer (sem Playwright — evita conflito de versao).
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
    libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 wget xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--max-old-space-size=1536
ENV HOST=0.0.0.0

COPY auditeste-a11y/package.json auditeste-a11y/package-lock.json ./
RUN npm ci --omit=dev && npx puppeteer browsers install chrome && npx playwright install ffmpeg

COPY auditeste-a11y/a11y.js auditeste-a11y/agente-cenarios.js auditeste-a11y/cenarios.js auditeste-a11y/servidor.js auditeste-a11y/traducoes-pa11y.js auditeste-a11y/carregar-env.js auditeste-a11y/teste-ia.js ./
COPY auditeste-a11y/publico ./publico

EXPOSE 8900

CMD ["node", "servidor.js"]
