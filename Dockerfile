# SPDX-License-Identifier: AGPL-3.0-or-later
# ---- build stage ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WHISPER_API_HOME=/data \
    WHISPER_API_HOST=0.0.0.0 \
    WHISPER_API_PORT=8080
# git/cmake/compiler enable the optional native whisper.cpp engine.
# Without them, the `auto` engine transparently falls back to ONNX.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY bin ./bin
COPY web ./web
COPY deploy ./deploy
COPY LICENSE NOTICE README.md ./
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WHISPER_API_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/whisper-api.js"]
CMD ["start"]
