# Releasing OR3 Cloud

Normal OR3 Cloud releases publish a versioned application image, a separate
digest-pinned dashboard-operator image, and the operator package. The release
version must match in:

- `package.json` at the repository root;
- root version metadata in `package-lock.json`;
- `packages/or3-cloud/package.json`;
- `packages/or3-cloud/src/cli.ts` (`PACKAGE_VERSION`);
- `ghcr.io/saluana/or3-chat:<version>` and
  `ghcr.io/saluana/or3-chat:<version>-operator`; and
- the tag `v<version>`.

Published npm versions and image tags are immutable. Never force-move a tag or
republish a version with different contents.

## CI lanes

Normal pull requests run one fast **PR checks** workflow. It installs once,
runs the core/docs/release/skills checks, and adds Cloud, plugin-runtime, or
advisory performance checks only when those surfaces changed. Generic version
and lockfile edits do not launch unrelated performance or deployment suites.
Configure the `or3-cloud` branch protection rule to require **PR checks / Core
and affected contracts**; the workflow intentionally runs on every pull
request so that required status is never left pending by a path filter.

The **Extended validation** workflow runs on weekday schedules and on demand.
Its manual `suite` selector can run `tests`, `performance`, `plugin-runtime`,
or `deployment` independently; `all` runs every suite. Performance budgets are
strict here, and the deployment suite exercises the complete disposable Cloud
lifecycle. Package publication remains isolated in the candidate and tag
workflows below.

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

## Prepare and qualify before tagging

Use one command from a clean isolated worktree:

```bash
bun run release:prepare -- --version <version> --registry --full
```

This refuses dirty source, inconsistent versions (including lock metadata),
used Git/npm/GHCR versions, missing providers, package drift, failing tests,
browser harnesses, type errors, or documentation drift. It writes a small
machine-readable report to `output/release/preflight.json`.

Then use GitHub Actions to manually run **Qualify OR3 Cloud Candidate** on the
exact intended branch/commit and enter the same version. Do not create the tag
yet. The candidate workflow builds and verifies both multi-architecture images,
binds their immutable digests into the exact packed CLI, upgrades a deployment
from the current npm release, runs rollback and a second update, calls the
dashboard operator over its Unix socket, executes `or3 verify`, checks
persistence and the clean-browser journey, and records immutable
source/image/tarball identities in `candidate-receipt.json`. It publishes only
source-qualified candidate evidence; it cannot publish npm or the public
version images.

When the default profile changed, verify the exact build-time provider versions
in `packages/create-or3-chat/first-party-versions.json` are already available
on npm:

```bash
npm view or3-provider-basic-auth@0.0.9 version
npm view or3-provider-sqlite@0.0.9 version
npm view or3-provider-fs@0.0.7 version
```

Run the relevant provider qualification in its own repository before tagging.
The VPS operator never installs those packages; they are compiled into the
image during this release.

## Release

After the candidate workflow succeeds, push the matching tag at that exact
commit:

```bash
git tag v<version>
git push origin v<version>
```

The `Release OR3 Cloud` workflow then:

1. finds evidence whose version and source SHA exactly match the tag;
2. re-hashes the tarball, resolves the candidate digest, and verifies the image
   revision/version labels;
3. promotes the exact qualified application and dashboard-operator manifest
   digests to `ghcr.io/saluana/or3-chat:<version>` and
   `ghcr.io/saluana/or3-chat:<version>-operator` without rebuilding;
4. publishes the exact qualified tarball as `@or3/cloud@<version>` in an
   isolated trusted-publishing job; and
5. retries exact npm and `npx` verification until registry propagation ends.

The workflow's application and operator image digests are deployment identity
inputs. Copy both into the release notes with the supported profile and any
migration/rollback warnings.

## Failure handling

If candidate qualification fails, fix the source and bump the version before
qualifying again because candidate identities are single-use. Do not tag a
failed candidate. If promotion succeeds but npm has a transient failure, rerun
the tag workflow unchanged: it may continue only when both public image digests
and the npm tarball integrity exactly match the receipt. If npm accepted the
package but reads return 404/ETARGET, wait for propagation; do not republish,
change source, or reuse the version.

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

- `bun run release:prepare -- --version <version> --registry --full` passes in a clean worktree.
- The candidate workflow succeeds before the release tag exists.
- The tag and candidate receipt contain the same source SHA and version.
- `npm pack --dry-run` contains only the Cloud CLI and deployment assets.
- The exact default provider versions exist on npm.
- The `deployment` suite in **Extended validation** passes before the tag is
  created.
- Both public GHCR images pull from a clean machine.
- Basic Auth login, deep health, conversation persistence, and file persistence
  pass after container restart.
- Backup archive checksum/list validation passes.
- A deliberately failed image health check restores the previous version/data
  snapshot.
- The exact npm version and `npx @or3/cloud@<version> --help` resolve after
  propagation.
- Release notes include both image digests and the rollback warning.
