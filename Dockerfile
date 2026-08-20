FROM node:20-alpine AS dependencies
WORKDIR /app
# better-sqlite3 在 Alpine 上需要本地编译；该依赖只停留在构建阶段，运行时继续以 node 用户执行。
# NAS 对 prebuild-install 的外部预编译包下载会发生长时间等待，因此明确跳过该路径并使用本地 node-gyp 编译。
RUN apk add --no-cache python3 make g++
COPY package*.json ./
ENV npm_config_build_from_source=true
ENV npm_config_fetch_retries=1
ENV npm_config_fetch_retry_mintimeout=3000
ENV npm_config_fetch_retry_maxtimeout=10000
RUN npm ci --omit=dev --no-audit --no-fund --foreground-scripts

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
