# Build na Railway: contexto é a raiz do repo; a ponte vive em auditeste-a11y/.
# Versão do Playwright DEVE bater com o pacote npm (axe-core usa Playwright).
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV HOST=0.0.0.0
ENV PUPPETEER_SKIP_DOWNLOAD=false

COPY auditeste-a11y/package.json auditeste-a11y/package-lock.json ./
RUN npm ci --omit=dev

# Chrome do Puppeteer — Pa11y, Lighthouse e fallback do axe-core
RUN npx puppeteer browsers install chrome

COPY auditeste-a11y/a11y.js auditeste-a11y/cenarios.js auditeste-a11y/servidor.js ./
COPY auditeste-a11y/publico ./publico

EXPOSE 8900

CMD ["node", "servidor.js"]
