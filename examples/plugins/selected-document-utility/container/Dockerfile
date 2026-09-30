# Pinned test container for the Selected Document Utility.
#
# Base image: oven/bun 1.3.6, pinned by index digest so amd64 and arm64 runners
# get the same toolchain. Digest resolved from the Docker Hub OCI index.
#
#   oven/bun:1.3.6
#   sha256:f20d9cf365ab35529384f1717687c739c92e6f39157a35a95ef06f4049a10e4a
#     linux/amd64 -> sha256:766690ef3be36b73288435428c638e47b8500d01f8fa1c298c4b09dc29841197
#     linux/arm64 -> sha256:d70b0bfcd9c2a976f79b6bedefc744446e8a3f99f871098156531bda3c05c343
#
# Build context layout (assembled by container/run.sh):
#   Dockerfile
#   package/**                 this utility package
#   sdk/or3-plugin-sdk.tgz     a packed @or3/plugin-sdk tarball
#
# The SDK is installed from the local tarball so the tests run against the exact
# package under development with no registry access.

FROM oven/bun:1.3.6@sha256:f20d9cf365ab35529384f1717687c739c92e6f39157a35a95ef06f4049a10e4a

WORKDIR /utility

# Install the SDK straight from the tarball. Extracting it avoids any package
# manager resolution against the registry, which the pre-release SDK is not
# published to.
COPY sdk/or3-plugin-sdk.tgz /tmp/or3-plugin-sdk.tgz
RUN mkdir -p node_modules/@or3 \
    && tar -xzf /tmp/or3-plugin-sdk.tgz -C /tmp \
    && mv /tmp/package node_modules/@or3/plugin-sdk

COPY package/ ./

CMD ["bun", "test"]
