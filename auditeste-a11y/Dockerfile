# Imagem oficial do Playwright + Chrome do Puppeteer (Pa11y/Lighthouse).
FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx puppeteer browsers install chrome

COPY a11y.js cenarios.js servidor.js ./
COPY publico ./publico

EXPOSE 8900

CMD ["node", "servidor.js"]
