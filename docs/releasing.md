# Releasing OR3 Cloud

This document covers the **stable release** ceremony only. Ordinary development
updates do not need a version bump, an npm publication, or this workflow; use
the development image path in [Updating OR3](cloud-updates.md).

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

The **Checks** workflow (`.github/workflows/tests.yml`) separates a fast source
gate from compatibility checks and from image publication:

- **Core checks** is the blocking gate: type-check, core tests, changed-file
  lint, documentation, and banned-import checks.
- **Contracts and compatibility** runs in parallel: script and release-policy
  tests, Cloud package contracts, and plugin compatibility checks. It does not
  gate development images.
- **Development image** runs after **Core checks** on trusted `or3-cloud`
  pushes and manual dispatches. It builds one image, smoke-tests the exact
  digest, and only then advances `ghcr.io/saluana/or3-chat:dev-<arch>`. It
  never publishes npm packages or stable tags. See [Updating OR3](cloud-updates.md).

If `or3-cloud` branch protection is enabled, require **Checks / Core checks**.
Pull requests deliberately run the workflow even when a path filter would skip
the deeper suites, so a required status is never left pending.

Full-project lint, strict performance budgets, full tests, browser suites,
plugin-runtime matrices, static generation, and the disposable deployment
lifecycle live in **Extended validation**, which runs on weekday schedules and
on demand (`tests`, `lint`, `performance`, `plugin-runtime`, `deployment`, or
`all`). Package publication remains isolated in the candidate and tag
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

Use this focused source gate from a clean isolated worktree:

```bash
bun run release:prepare -- --version <version> --registry
```

This refuses dirty source, inconsistent versions (including lock metadata),
used Git/npm/GHCR versions, missing providers, package drift, failing Cloud and
release contract tests, type errors, or documentation drift. It writes a small
machine-readable report with per-check timings to
`output/release/preflight.json`. The candidate Docker build is the
authoritative production build; this gate does not build a second host copy.

Use `--full` only for a local deep-validation run. The scheduled **Extended
validation** workflow owns full tests, browser suites, production asset
budgets, compatibility checks, and performance baselines outside the Cloud
release critical path.

Add the read-only readiness check before launching expensive work:

```bash
bun run release:prepare -- --version <version> --repository
```

`--repository` uses the GitHub CLI to inspect, without changing anything:
repository activity, the default-branch registration and enabled state of
`.github/workflows/release-cloud.yml` and `release-cloud-candidate.yml`,
required push permission, Actions enablement, registered runners, and the latest
candidate run. It never dispatches a workflow, changes a setting, or touches
billing. Facts it cannot read (including Actions billing/capacity) are reported
as `unknown`, never inferred as available. Blocked stages include the supported
administrator remedy. The result is recorded under `repositoryReadiness` in
`output/release/preflight.json`.

Then use GitHub Actions to manually run **Qualify OR3 Cloud Candidate** on the
exact intended branch/commit and enter the same version. Do not create the tag
yet. The workflow rejects used identities first, runs focused source checks,
then builds both multi-architecture images once. It stores their exact digests
and the digest-bound tarball, then runs manifest/anonymous-pull checks, security
scans, ARM runtime checks, and upgrade/rollback/restart/persistence checks as
independent jobs. The final job records immutable source/image/tarball
identities in `candidate-receipt.json` only after every required verifier
passes. It publishes only source-qualified candidate evidence; it cannot
publish npm or the public version images.

The manifest contract also starts the exact operator image as an unprivileged,
read-only container and installs the latest published Cloud CLI in its bounded
tmpfs. This keeps the operator's pinned npm bootstrap on the pre-tag path;
dashboard package-install failures must not first appear after publication.

The application build uses a registry-backed BuildKit cache at
`ghcr.io/saluana/or3-chat:buildcache-cloud`. Only the manually dispatched
candidate workflow has permission to update it. The cache is not release
evidence and cannot replace the digest-qualified candidate image.

When the default profile changed, verify the exact build-time provider versions
in `packages/create-or3-chat/first-party-versions.json` are already available
on npm:

```bash
npm view or3-provider-basic-auth@0.0.9 version
npm view or3-provider-sqlite@0.0.10 version
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
5. retries exact npm and `npx` verification until registry propagation ends;
   and
6. runs dashboard update, rollback, interruption, and persistence checks in a
   clearly labeled post-publication job with per-stage timing.

The workflow's application and operator image digests are deployment identity
inputs. Copy both into the release notes with the supported profile and any
migration/rollback warnings.

## Selecting and retaining deeper checks

Deeper checks reuse the existing named suites and jobs; do not add a new
workflow, job, schedule, required status context, image build, or cross-workflow
gate. Choose by what changed in the base-to-target diff:

| Change | Existing suite to run |
| --- | --- |
| Backup inventory/retention, managed state, schema or migration | **Extended validation → Complete Cloud deployment lifecycle**, plus the relevant historical/interruption cases |
| Operator protocol, dashboard compatibility, app/CLI transition | **Extended validation** contract tests and the deployment lifecycle's operator cases |
| Browser-facing Caddy/CSP, authentication, or OpenRouter connection flow | **Extended validation** browser/connection cases (or the same `scripts/release/smoke-browser.mjs` harness locally) |

Bind each result to the exact source SHA and image/tarball digests through the
existing run links and the candidate receipt; an unlinked or stale result is not
evidence. Unrelated releases do not repeat the full added matrix, and existing
schedules are not expanded. A missing comparison baseline is treated as a
relevant change. The default candidate lane keeps essential regressions only;
deeper history and browser combinations stay in Extended validation so a CLI
fix is not gated on browser coverage it cannot affect.

## Component release notes and publication receipt

Release notes use a short component-change table so an operator can tell what
actually changed:

| Component | Changed? | Notes |
| --- | --- | --- |
| `@or3/cloud` CLI | yes/no | commands, state format, recovery |
| application image | yes/no | runtime behavior |
| generated assets (Compose/Caddy/operator) | yes/no | copied on update |
| dependencies / image rebuild | yes/no | first-party versions |

Include fixed-issue references validated against the diff, and an explicit
no-change statement for unchanged components. An image-only rebuild is not a
CLI bug fix.

Record publication evidence separately from deployment/acceptance:

- candidate qualification (workflow run + receipt),
- tag workflow status,
- npm exact version + integrity/shasum + clean-cache `npx`,
- both public GHCR multi-architecture digests,
- post-publication verification result,
- production deployment result and owner acceptance (pending until a real
  OpenRouter connection and persistence checks pass).

A published artifact does not imply a deployed application. Keep a rollback ID
and the previous deployment until acceptance passes.

## Failure handling

If a candidate verifier fails after the image-build job succeeded, use
GitHub's **Re-run failed jobs** action. The successful build and package jobs
are retained, so the failed stage reuses the same immutable digests instead of
rebuilding. If the source must change, bump the version before qualifying again
because candidate identities are single-use. Do not tag a failed candidate.
If promotion succeeds but npm has a transient failure, rerun
the tag workflow unchanged: it may continue only when both public image digests
and the npm tarball integrity exactly match the receipt. If npm accepted the
package but reads return 404/ETARGET, wait for propagation; do not republish,
change source, or reuse the version.

The public images and npm package are complete when **Publish exact npm package**
succeeds. A later **Post-publication dashboard lifecycle verification** failure
means the artifacts were published but deployment verification failed; fix it
with a new patch release rather than attempting to overwrite the published
version.

If a release needs a correction after publication, bump the version. The old
image and package remain available for rollback and support.

### Restoring CI capacity without bypasses

Qualification needs working GitHub Actions capacity owned by the account
administrator. When it is exhausted or misconfigured:

1. Run `bun run release:prepare -- --version <version> --repository` to see the
   blocked stage; the readiness result names what could not be verified.
2. Restore capacity or workflow setup through the normal GitHub path
   (account billing/actions limits, re-enabling a disabled workflow, or
   confirming required permissions). These are administrator-owned actions the
   CLI cannot change for you.
3. Re-run the failed stage on the unchanged candidate so it reuses the same
   immutable digests. Only a source change requires a new version.

Do not bypass qualification with a manual `npm publish`, an unpinned
installation, a self-hosted production runner, or a moved/immutable tag. If the
tag workflow cannot run, the release waits; the local readiness report and
results are retained meanwhile.

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

- `bun run release:prepare -- --version <version> --registry` passes in a clean worktree.
- The candidate workflow succeeds before the release tag exists.
- The tag and candidate receipt contain the same source SHA and version.
- `npm pack --dry-run` contains only the Cloud CLI and deployment assets.
- The exact default provider versions exist on npm.
- Recent scheduled **Extended validation** results are healthy; use an on-demand
  suite when a change affects a deep-only surface.
- Both public GHCR images pull from a clean machine.
- Basic Auth login, deep health, conversation persistence, and file persistence
  pass after container restart.
- Backup archive checksum/list validation passes.
- A deliberately failed image health check restores the previous version/data
  snapshot.
- The exact npm version and `npx @or3/cloud@<version> --help` resolve after
  propagation.
- Release notes include both image digests and the rollback warning.
