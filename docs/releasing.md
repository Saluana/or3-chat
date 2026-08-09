# Releasing OR3 Cloud

Normal OR3 Cloud releases publish one versioned application image and one
operator package. The release version must match in:

- `package.json` at the repository root;
- `packages/or3-cloud/package.json`;
- `packages/or3-cloud/src/cli.ts` (`PACKAGE_VERSION`);
- `ghcr.io/saluana/or3-chat:<version>`; and
- the tag `v<version>`.

Published npm versions and image tags are immutable. Never force-move a tag or
republish a version with different contents.

## Registry setup

Before the first release, create or verify the public `@or3` npm scope and
configure npm trusted publishing for `.github/workflows/release-cloud.yml`.
The workflow needs the repository's `id-token: write` permission and the npm
package must already be allowed to publish under the scope. Configure GHCR
write access for the repository and set the resulting
`ghcr.io/saluana/or3-chat` package visibility to **public** so a clean VPS can
pull it anonymously. These registry/account settings are external to this
repository and cannot be validated by local tests.

If trusted publishing is not configured yet, do not guess at credentials or
commit a token. Complete the npm/GHCR account setup first, then run the release
workflow. A one-time manual publication is only an operator decision; if used,
publish the exact `npm pack` artifact with `--access public` and never reuse the
version.

## Before tagging

Run the focused package checks:

```bash
bun run release:cloud:check
bun run scripts/release/check-cloud-package.mjs --registry
bun run cloud:package:check
bun run --cwd packages/or3-cloud pack:check
bun run check:docs
```

When the default profile changed, verify the exact build-time provider versions
in `packages/create-or3-chat/first-party-versions.json` are already available
on npm:

```bash
npm view or3-provider-basic-auth@0.0.8 version
npm view or3-provider-sqlite@0.0.6 version
npm view or3-provider-fs@0.0.4 version
```

Run the relevant provider qualification in its own repository before tagging.
The VPS operator never installs those packages; they are compiled into the
image during this release.

## Release

Commit the version and source changes, then push the matching tag:

```bash
git tag v<version>
git push origin v<version>
```

The `Release OR3 Cloud` workflow then:

1. checks the version contract and provider registry entries;
2. rejects a version that already exists in npm or GHCR;
3. builds the Nuxt output once on the native runner, then packages amd64 and
   arm64 runtime images with Basic Auth + SQLite + filesystem build flags;
4. scans both runtime architectures and verifies their manifest entries;
5. runs the full login, persistence, restart, and clean-browser journey on
   amd64 plus a focused native SQLite query on arm64;
6. publishes `ghcr.io/saluana/or3-chat:<version>`;
7. packs and publishes `@or3/cloud@<version>`; and
8. retries exact npm and `npx` verification until registry propagation ends.

The workflow's image digest is the deployment identity. Copy it into the
release notes with the supported profile and any migration/rollback warnings.

## Failure handling

If image qualification fails, do not publish the npm package. Fix the source
and use a new version if the image was already pushed. If npm publication is
accepted but registry reads return 404/ETARGET, wait and rerun exact-version
verification; do not change source or reuse the version.

If a release needs a correction after publication, bump the version. The old
image and package remain available for rollback and support.

## Deprecating the old creator

After the first Cloud release passes a clean local smoke and a controlled VPS
adoption, mark `create-or3-chat` deprecated on npm with a message directing
users to `npx @or3/cloud init`. Do not publish another normal creator release
or describe adoption as an in-place source upgrade. The one-time registry
operation is:

```bash
npm deprecate 'create-or3-chat@<0.1.12' 'Use npx @or3/cloud init; the creator is retained only for source-development history.'
```

## Release checklist

- `bun run release:cloud:check` passes.
- `bun run cloud:package:check` passes.
- `bun run check:docs` passes (and, on qualification, executes the exact packed Cloud CLI).
- `npm pack --dry-run` contains only the Cloud CLI and deployment assets.
- The exact default provider versions exist on npm.
- The public GHCR image pulls from a clean machine.
- Basic Auth login, deep health, conversation persistence, and file persistence
  pass after container restart.
- Backup archive checksum/list validation passes.
- A deliberately failed image health check restores the previous version/data
  snapshot.
- The exact npm version and `npx @or3/cloud@<version> --help` resolve after
  propagation.
- Release notes include the image digest and rollback warning.
