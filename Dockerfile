FROM node:20-alpine AS dependencies
WORKDIR /app
# better-sqlite3 在 Alpine 上需要本地编译；该依赖只停留在构建阶段，运行时继续以 node 用户执行。
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js intelligence-core.js ARCHITECTURE.md AUTOMATION_DESIGN.md ./
COPY --chown=node:node public ./public
COPY --chown=node:node automation ./automation
COPY --chown=node:node intelligence ./intelligence
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
