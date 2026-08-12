# Imagem oficial do Playwright: já traz Chromium e as bibliotecas de sistema,
# que é a parte chata de fazer navegador rodar em container.
FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Pa11y usa o Chrome do Puppeteer, que é outro binário
RUN npx puppeteer browsers install chrome

COPY a11y.js cenarios.js servidor.js ./
# o Print servido pela própria ponte: hospedado, isso vira uma URL só
COPY publico ./publico

ENV HOST=0.0.0.0
EXPOSE 8900

# Variáveis no provedor (Railway injeta PORT sozinho):
#   PONTE_TOKEN        obrigatório — o servidor se recusa a subir exposto sem ele
#   ANTHROPIC_API_KEY  habilita o botão "Gerar com IA"
#   PONTE_DOMINIOS     allowlist de domínios que podem ser escaneados
CMD ["node", "servidor.js"]
