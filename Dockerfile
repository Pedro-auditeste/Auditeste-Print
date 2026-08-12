# Build na Railway: contexto é a raiz do repo; a ponte vive em auditeste-a11y/.
FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app

COPY auditeste-a11y/package.json auditeste-a11y/package-lock.json ./
RUN npm ci --omit=dev

RUN npx puppeteer browsers install chrome

COPY auditeste-a11y/a11y.js auditeste-a11y/cenarios.js auditeste-a11y/servidor.js ./
COPY auditeste-a11y/publico ./publico

ENV HOST=0.0.0.0
EXPOSE 8900

CMD ["node", "servidor.js"]
