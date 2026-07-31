# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

COPY package*.json bun.lock* ./
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY scripts/docker/prepare-manifest.mjs ./scripts/docker/prepare-manifest.mjs
RUN node scripts/docker/prepare-manifest.mjs package.json
# `npm install` intentionally reconciles package.json with the npm lock when a
# Bun-driven custom wizard added providers after the embedded locks were made.
RUN npm install

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", ".output/server/index.mjs"]
