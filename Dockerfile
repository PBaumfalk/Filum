# Filum – Link-Management-Studio. Mehrstufiger Build für linux/amd64 und linux/arm64.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Werkzeuge, falls für die Zielplattform kein vorgebautes SQLite-Modul existiert
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --foreground-scripts \
  && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"
COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
  && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
  && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"

FROM node:24-bookworm-slim
ARG FILUM_VERSION=1.1.0
ARG FILUM_SOURCE=""
LABEL org.opencontainers.image.title="Filum" \
      org.opencontainers.image.description="Selbst gehostetes Link-Management-Studio: Kurzlinks, eigene Domains, datensparsame Statistik" \
      org.opencontainers.image.version="${FILUM_VERSION}" \
      org.opencontainers.image.source="${FILUM_SOURCE}" \
      org.opencontainers.image.licenses="MIT"
# npm, npx und corepack werden zur Laufzeit nicht gebraucht: weniger Angriffsfläche und Scanner-Treffer
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PUBLIC_PORT=8080 \
    ADMIN_PORT=8081 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/filum /usr/local/bin/filum
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080 8081
# Prüft beide Dienste (öffentlich und intern); Port 8081 prüft zusätzlich die Datenbank
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["filum", "health"]
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/server/main.js"]
