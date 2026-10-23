# syntax=docker/dockerfile:1.7
# Node 22 / Alpine, shared by build and runtime for native-module ABI compatibility.
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
FROM ${NODE_IMAGE} AS source
WORKDIR /source
# v0.5.104: immutable commit plus archive integrity check.
ADD --checksum=sha256:19ef5a68603672c8efe9b140e917fcd71a0b28be930600e2bbfa914819f1ea27 https://codeload.github.com/decolua/9router/tar.gz/87a74e1bda3677193c6f71a7e2100c90311f0689 /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /source \
    && rm /tmp/source.tar.gz
COPY patches/ /patches/
RUN node /patches/apply-tunnel-dashboard-access.mjs /source

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
RUN apk add --no-cache python3 make g++ linux-headers
COPY --from=source /source/package.json /tmp/upstream-package.json
COPY package.json package-lock.json ./
# Only the reviewed dependency override may differ from the pinned source.
RUN node -e "const assert = require('node:assert/strict'); const local = require('./package.json'); delete local.overrides; assert.deepEqual(local, require('/tmp/upstream-package.json'))"
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=optional --no-audit --no-fund \
    && node -e "const db = require('better-sqlite3')(':memory:'); db.prepare('SELECT 1').get(); db.close()"

FROM dependencies AS build
COPY --from=source /source/ ./
COPY --from=dependencies /app/package.json ./package.json
ARG PUBLIC_BASE_URL=http://9router.localnetwork
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BASE_URL=${PUBLIC_BASE_URL} \
    DATA_DIR=/tmp/9router-build-data
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="9router" \
      org.opencontainers.image.version="0.5.104" \
      org.opencontainers.image.source="https://github.com/decolua/9router" \
      org.opencontainers.image.revision="87a74e1bda3677193c6f71a7e2100c90311f0689"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=20128 \
    DATA_DIR=/app/data \
    HOME=/home/node \
    XDG_CACHE_HOME=/tmp/.cache

# Keep the shell; remove package managers and development files from runtime.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/include/node \
           /usr/local/share/doc /usr/local/share/man \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
             /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /app/data \
    && chown node:node /app/data \
    && chmod 0700 /app/data \
    && ln -s /app/data /home/node/.9router

# Application code remains root-owned, with only data/cache paths writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/open-sse ./open-sse
COPY --from=build /app/src/mitm ./src/mitm
COPY --from=build /app/node_modules/node-forge ./node_modules/node-forge
# Runtime-loaded files can be missed by Next tracing.
COPY --from=build /app/node_modules/sql.js ./node_modules/sql.js
COPY --from=build /app/node_modules/node-machine-id ./node_modules/node-machine-id
COPY --from=source /source/LICENSE ./LICENSE

USER node:node
EXPOSE 20128
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:20128/api/health', {signal: AbortSignal.timeout(4000)}).then(async r => {if (!r.ok || (await r.json()).ok !== true) process.exit(1)}).catch(() => process.exit(1))"]
ENTRYPOINT ["node"]
CMD ["custom-server.js"]
