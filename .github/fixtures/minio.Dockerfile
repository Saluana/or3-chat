# Docker Official Go image, matching the toolchain of the pinned MinIO release.
FROM golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848

# Keep the compiler pinned; go install verifies module downloads via Go's checksum database.
ENV GOTOOLCHAIN=local
# Official MinIO RELEASE.2025-10-15T17-29-55Z (source-only distribution).
RUN go install -trimpath github.com/minio/minio@9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a

ENTRYPOINT ["/go/bin/minio"]
