FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN addgroup -S nvci && adduser -S nvci -G nvci
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=nvci:nvci package.json server.js ARCHITECTURE.md ./
COPY --chown=nvci:nvci public ./public
RUN mkdir -p /data && chown -R nvci:nvci /data /app
USER nvci
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
