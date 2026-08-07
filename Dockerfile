# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build

ARG SSR_AUTH_ENABLED=false
ARG AUTH_PROVIDER=clerk
ARG OR3_GUEST_ACCESS_ENABLED=false
ARG OR3_SYNC_ENABLED=false
ARG OR3_SYNC_PROVIDER=convex
ARG OR3_STORAGE_ENABLED=false
ARG NUXT_PUBLIC_STORAGE_PROVIDER=convex

ENV SSR_AUTH_ENABLED=$SSR_AUTH_ENABLED \
    AUTH_PROVIDER=$AUTH_PROVIDER \
    OR3_GUEST_ACCESS_ENABLED=$OR3_GUEST_ACCESS_ENABLED \
    OR3_SYNC_ENABLED=$OR3_SYNC_ENABLED \
    OR3_SYNC_PROVIDER=$OR3_SYNC_PROVIDER \
    OR3_STORAGE_ENABLED=$OR3_STORAGE_ENABLED \
    NUXT_PUBLIC_STORAGE_PROVIDER=$NUXT_PUBLIC_STORAGE_PROVIDER

WORKDIR /app
ENV NODE_ENV=development \
    NODE_OPTIONS=--max-old-space-size=4096 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=600000

RUN npm install --global npm@11.6.2
COPY package*.json bun.lock* ./
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/create-or3-chat/first-party-versions.json ./packages/create-or3-chat/first-party-versions.json
COPY scripts/docker/prepare-manifest.mjs ./scripts/docker/prepare-manifest.mjs
COPY scripts/docker/preflight-registry.mjs ./scripts/docker/preflight-registry.mjs
RUN node scripts/docker/prepare-manifest.mjs package.json
# The source lock contains local provider links for contributor installs. The
# manifest preparation step replaces those links with the pinned registry
# versions, so refresh the lock in the image build and install from that exact
# lock with npm ci. The cache mount survives failed builds and retries.
RUN --mount=type=cache,target=/root/.npm \
    node scripts/docker/preflight-registry.mjs && \
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund && \
    npm ci --no-audit --no-fund && \
    cp package.json /tmp/or3-registry-package.json && \
    cp package-lock.json /tmp/or3-registry-package-lock.json

COPY . .
# COPY . . includes the contributor manifest with local provider links. Keep
# the registry-clean manifest/lock that was used to install node_modules.
RUN cp /tmp/or3-registry-package.json package.json && \
    cp /tmp/or3-registry-package-lock.json package-lock.json
# Cloud providers are initialized while Nitro prerenders routes. Supply only
# disposable build-time values here: real credentials and paths remain runtime
# environment values from Compose and are never copied into the image.
RUN mkdir -p /tmp/or3-build/storage && \
    OR3_BASIC_AUTH_DB_PATH=/tmp/or3-build/auth.sqlite \
    OR3_BASIC_AUTH_JWT_SECRET=or3-build-only-jwt-secret-not-for-runtime \
    OR3_BASIC_AUTH_REFRESH_SECRET=or3-build-only-refresh-secret-not-for-runtime \
    OR3_SQLITE_DB_PATH=/tmp/or3-build/sync.sqlite \
    OR3_STORAGE_FS_ROOT=/tmp/or3-build/storage \
    OR3_STORAGE_FS_TOKEN_SECRET=or3-build-only-storage-token-not-for-runtime \
    npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    OR3_EXTENSIONS_ROOT=/data/extensions \
    OR3_ADMIN_DATA_DIR=/data/admin
WORKDIR /app

RUN mkdir -p /data/admin /data/extensions && \
    chown -R node:node /data
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chmod=755 /app/scripts/docker/runtime-entrypoint.sh /usr/local/bin/or3-runtime-entrypoint

USER node
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/or3-runtime-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
