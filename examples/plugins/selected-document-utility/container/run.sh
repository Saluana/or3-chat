#!/usr/bin/env sh
# Build and run the pinned test container for the Selected Document Utility.
#
# Usage:
#   SDK_TARBALL=/path/to/or3-plugin-sdk-2.0.0.tgz sh container/run.sh
#
# SDK_TARBALL must point to a tarball produced by `npm pack @or3/plugin-sdk`
# (or `npm pack <path-to-sdk>` while developing). This keeps the container
# command independent of any OR3 checkout layout: the package directory is
# discovered relative to this script.
set -eu

PACKAGE_DIR=${PACKAGE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
SDK_TARBALL=${SDK_TARBALL:?set SDK_TARBALL to a packed @or3/plugin-sdk .tgz}
IMAGE_TAG=${IMAGE_TAG:-or3-selected-document-utility-test:local}

if [ ! -f "$SDK_TARBALL" ]; then
    echo "SDK_TARBALL is not a file: $SDK_TARBALL" >&2
    exit 1
fi

CONTEXT=$(mktemp -d)
cleanup() { rm -rf "$CONTEXT"; }
trap cleanup EXIT INT TERM

mkdir -p "$CONTEXT/package" "$CONTEXT/sdk"
tar -C "$PACKAGE_DIR" \
    --exclude node_modules \
    --exclude dist \
    --exclude .or3-pack \
    --exclude .git \
    -cf - . | tar -C "$CONTEXT/package" -xf -
cp "$SDK_TARBALL" "$CONTEXT/sdk/or3-plugin-sdk.tgz"
cp "$PACKAGE_DIR/container/Dockerfile" "$CONTEXT/Dockerfile"

docker build --tag "$IMAGE_TAG" "$CONTEXT"
docker run --rm "$IMAGE_TAG"
