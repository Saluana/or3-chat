# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development \
    NODE_OPTIONS=--max-old-space-size=4096

RUN npm install --global npm@11.6.2
COPY package*.json bun.lock* ./
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY scripts/docker/prepare-manifest.mjs ./scripts/docker/prepare-manifest.mjs
RUN node scripts/docker/prepare-manifest.mjs package.json
# `npm install` intentionally reconciles package.json with the npm lock when a
# Bun-driven custom wizard added providers after the embedded locks were made.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chmod=755 /app/scripts/docker/runtime-entrypoint.sh /usr/local/bin/or3-runtime-entrypoint

USER node
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/or3-runtime-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
