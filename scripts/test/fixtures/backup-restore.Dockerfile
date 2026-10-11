# Local-only image for run-backup-restore-drill.ts. Build the current SSR app
# first; this fixture copies its output rather than installing dependencies.
FROM busybox:1.37.0-uclibc@sha256:8d7b1636e974e0adfd8d945955fca609304f0a56c18799dfd032d6e661382d84 AS tools
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS distroless
ARG SOURCE_REVISION
ARG OR3_VERSION
LABEL org.opencontainers.image.source="https://github.com/Saluana/or3-chat"
LABEL org.opencontainers.image.version=$OR3_VERSION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
COPY --from=tools /bin/ /bin/
COPY --chown=65532:65532 .output .output
COPY --chown=65532:65532 scripts/docker/runtime-entrypoint.mjs scripts/docker/runtime-entrypoint.mjs
COPY --chown=65532:65532 scripts/docker/backup-inspect.mjs scripts/docker/backup-inspection-profile.json scripts/docker/
# distroless contains no mkdir/chown runtime utilities beyond our tools stage;
# create the empty root-owned image directories using that pinned shell.
USER 0:0
RUN ["/bin/sh", "-c", "mkdir -p /data/admin /data/extensions && chown -R 65532:65532 /data"]
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 OR3_EXTENSIONS_ROOT=/data/extensions OR3_ADMIN_DATA_DIR=/data/admin
USER 65532:65532
VOLUME /data
ENTRYPOINT ["/nodejs/bin/node", "/app/scripts/docker/runtime-entrypoint.mjs"]
CMD ["/nodejs/bin/node", ".output/server/index.mjs"]

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS bookworm
ARG SOURCE_REVISION
ARG OR3_VERSION
LABEL org.opencontainers.image.source="https://github.com/Saluana/or3-chat"
LABEL org.opencontainers.image.version=$OR3_VERSION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
COPY --from=tools /bin/ /bin/
COPY --chown=65532:65532 .output .output
COPY --chown=65532:65532 scripts/docker/runtime-entrypoint.mjs scripts/docker/runtime-entrypoint.mjs
COPY --chown=65532:65532 scripts/docker/backup-inspect.mjs scripts/docker/backup-inspection-profile.json scripts/docker/
RUN mkdir -p /data/admin /data/extensions && chown -R 65532:65532 /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 OR3_EXTENSIONS_ROOT=/data/extensions OR3_ADMIN_DATA_DIR=/data/admin
USER 65532:65532
VOLUME /data
ENTRYPOINT ["/usr/local/bin/node", "/app/scripts/docker/runtime-entrypoint.mjs"]
CMD ["/usr/local/bin/node", ".output/server/index.mjs"]
