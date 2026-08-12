# Build na Railway: contexto é a raiz do repo; a ponte vive em auditeste-a11y/.
FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app

# Imagem oficial já traz Chromium em /ms-playwright — evita baixar Puppeteer Chrome.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_OPTIONS=--max-old-space-size=1024
ENV HOST=0.0.0.0

COPY auditeste-a11y/package.json auditeste-a11y/package-lock.json ./
RUN npm ci --omit=dev

COPY auditeste-a11y/a11y.js auditeste-a11y/cenarios.js auditeste-a11y/servidor.js ./
COPY auditeste-a11y/publico ./publico

EXPOSE 8900

CMD ["node", "servidor.js"]
