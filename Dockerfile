# Use the official Playwright image — version must match the playwright npm package below.
FROM mcr.microsoft.com/playwright:v1.53.1-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

CMD ["node", "maze-api.js"]
