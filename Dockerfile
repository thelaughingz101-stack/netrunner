# NetRunner — self-hosted news digest. Multi-arch (amd64 / arm64 for Raspberry Pi).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 ships prebuilt binaries; build tools are only a fallback for unusual platforms.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/vendor.mjs scripts/vendor.mjs
RUN mkdir -p public && npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/public/vendor ./public/vendor
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY public/netrunner-config.html ./public/
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]
