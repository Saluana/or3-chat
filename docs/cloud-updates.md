# Updating OR3

This is the canonical update guide. Every other document should point here
instead of repeating an update procedure. It covers four different things that
are often all called "updating":

- **Updating a local Git checkout** — getting the newest source on your computer.
- **Publishing a Docker image** — building and storing a tested container image.
- **Updating a running server** — replacing the container that serves your app.
- **Publishing a stable release** — the deliberate public release ceremony.

**Normal update:** if you just want your running application to reflect small
source changes, use [Normal update](#normal-update). Everything else in this
guide is reference material for the uncommon cases.

## Normal update

The repository has two supported deployment shapes:

| Deployment | How it gets a new version | When to use it |
|---|---|---|
| **Development deployment** — a plain Docker Compose project created from `compose.dev.yaml` | A push to `or3-cloud` that changes runtime files builds, smoke-tests, and publishes a development image; you point the deployment at the new exact digest | Day-to-day application changes you want to see running quickly |
| **Managed deployment** — created by `npx @or3/cloud init` (CLI or dashboard updates) | Only published stable releases, verified against the signed `@or3/cloud` package | Production, once changes are done |

The managed installer deliberately refuses development images: its update path
is bound to the exact image digests signed into each published `@or3/cloud`
version. That is a security property, not an obstacle to work around. Never use
`OR3_CLOUD_TEST_IMAGE`, `OR3_CLOUD_SKIP_PULL`, or a hand-edited generated
`compose.yaml` on a managed deployment.

The recommended routine path for application changes is the development
deployment:

```text
edit code → push to or3-cloud → Checks workflow (type-check + core tests)
          → Development image job builds once and smoke-tests it
          → image digest published → update the development deployment by digest
```

A managed production deployment is updated the same day only when the change
has an official stable release (see [Stable release](#e-stable-release)).

## A. Which update method applies?

| I want to… | Method | Where it runs |
|---|---|---|
| Get the newest source locally | `git pull` in the checkout | Your computer |
| Publish a testable development image | Push to `or3-cloud` (or manually dispatch **Checks**) | GitHub Actions |
| Update a Docker Compose development deployment | Pull and recreate with an exact digest | The server |
| Update a managed `@or3/cloud` or dashboard installation | `npx --yes @or3/cloud@<version> update --to <version>` from a published stable release | The server |
| Publish an official stable release | **Qualify OR3 Cloud Candidate**, tag, **Release OR3 Cloud** | GitHub Actions and npm |

Short definitions:

- **Image tag** — a human-readable name such as `ghcr.io/saluana/or3-chat:dev-amd64`
  or `ghcr.io/saluana/or3-chat:0.1.63`. A tag can, in principle, be reassigned.
- **Image digest** — the immutable `sha256:…` content address of one exact
  image build, written `ghcr.io/saluana/or3-chat@sha256:…`. Deployments should
  use digests so nobody can swap what runs on the server.
- **Stable release** — a versioned image plus an `@or3/cloud` npm package whose
  metadata pins that image digest. Only stable releases are accepted by managed
  installations.

## B. Making a normal application change

### 1. Enter the repository and check for uncommitted work

Run these on **your computer**:

```bash
cd ~/Documents/or3/or3-chat
git status
```

If `git status` shows changes, commit them or `git stash push -m "work in
progress"` before updating the branch. Never discard local work to make an
update succeed.

### 2. Update the branch safely

```bash
git switch or3-cloud
git pull --rebase origin or3-cloud
```

The default branch is `or3-cloud`. Pull before you start so your change lands on
the newest source. If `git stash` was used, restore it with `git stash pop`
after the pull.

### 3. Make and test the change

```bash
bun install                    # only when dependencies changed
bun run type-check
bun run test                   # the same core tests the CI gate runs
```

Optionally run a narrower check while iterating:

```bash
bun run test:changed           # tests affected by uncommitted changes
bun run lint:changed -- <files>
```

Sensitive changes (database migrations, authentication, storage, installer or
update logic, runtime dependencies) should also run the relevant deeper suite
from [Extended validation](#running-deeper-checks-on-demand) before reaching
production.

### 4. Commit and push

```bash
git add -A
git commit -m "[Type] Short note on changes."
git push origin or3-cloud
```

Direct pushes and merged pull requests both end in the same place: a new commit
on `or3-cloud`.

### 5. What runs automatically

Pushing to `or3-cloud` starts the **Checks** workflow
(`.github/workflows/tests.yml`):

- **Core checks** (required gate): type-check, core tests, changed-file lint,
  documentation check, banned-import check.
- **Contracts and compatibility** (runs in parallel, does not gate the image):
  script and release-policy tests, Cloud package contracts, plugin
  compatibility checks.
- **Development image** (only after **Core checks** passes): builds one
  `linux/amd64` image from the Dockerfile, starts that exact digest with
  disposable credentials and storage, waits for `/api/health?deep=true`, runs
  the sign-in + SQLite sync + file upload smoke, then publishes:

```text
ghcr.io/saluana/or3-chat:dev-<first-12-characters-of-the-commit>-<arch>
ghcr.io/saluana/or3-chat:dev-<arch>   (moving tag advanced only after the smoke passes)
```

`<arch>` is `amd64` or `arm64`. The immutable tag and the moving tag are
architecture-scoped, so an AMD64 build can never be reused or served as ARM64.

This workflow never publishes npm packages, never creates release tags, and
never touches a running server. Pull requests do not publish images; merge into
`or3-cloud` (or push) to get one.

You can also run it manually: **Actions → Checks → Run workflow**, and
optionally choose `linux/arm64` instead of the default `linux/amd64`. Use the
architecture of the server you deploy to.

### 6. Find the image digest

Open **Actions → Checks → the run for your commit → Development image job →
Summary**. The summary lists:

- the source commit,
- the target architecture,
- the immutable reference
  `ghcr.io/saluana/or3-chat:dev-<sha>-<arch>@sha256:<digest>`,
- the checks that ran,
- the next command for the server.

The same digest is available from any machine that can read the registry
(`dev-amd64` or `dev-arm64` for the architecture you deployed):

```bash
docker buildx imagetools inspect ghcr.io/saluana/or3-chat:dev-amd64
```

### 7. Version bumps and tags

Ordinary development updates need **no version bump and no Git tag**. The image
is identified by the source commit and its digest. Version bumps and `v<version>`
tags exist only for stable releases, and only when the managed installer must
consume the change.

## C. Updating the running container

### One-time setup: a development deployment

Do this **once** on the server. It creates a dedicated plain Compose project;
it is not a managed `@or3/cloud` deployment. Substitute `/srv/or3-dev` with the
directory you want.

1. On the **server**, create the directory and copy `compose.dev.yaml` from the
   repository into it.

2. Create `/srv/or3-dev/.env` (owner-only). Generate real secret values with
   `openssl rand -hex 32` and replace every `<...>` placeholder:

```bash
cat > /srv/or3-dev/.env <<'EOF'
# Compose reads this name from .env automatically.
COMPOSE_FILE=compose.dev.yaml

# Exact image digest from the Checks workflow summary.
OR3_IMAGE=ghcr.io/saluana/or3-chat@sha256:<digest>
OR3_PORT=3100

# Fixed supported profile: Basic Auth + SQLite + filesystem storage.
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=basic-auth
OR3_AUTH_PROVIDER=basic-auth
OR3_GUEST_ACCESS_ENABLED=false
OR3_AUTH_REGISTRATION_MODE=invite_only
OR3_AUTH_AUTO_PROVISION=false
OR3_BASIC_AUTH_JWT_SECRET=<openssl rand -hex 32>
OR3_BASIC_AUTH_REFRESH_SECRET=<openssl rand -hex 32>
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=you@example.com
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=<strong owner password>
OR3_ADMIN_USERNAME=you@example.com
OR3_ADMIN_PASSWORD=<strong admin password>
OR3_ADMIN_JWT_SECRET=<openssl rand -hex 32>
OR3_SYNC_ENABLED=true
OR3_CLOUD_SYNC_ENABLED=true
OR3_SYNC_PROVIDER=sqlite
OR3_STORAGE_ENABLED=true
OR3_CLOUD_STORAGE_ENABLED=true
NUXT_PUBLIC_STORAGE_PROVIDER=fs
OR3_STORAGE_FS_TOKEN_SECRET=<openssl rand -hex 32>
EOF
chmod 600 /srv/or3-dev/.env
```

3. Start it **on the server**:

```bash
cd /srv/or3-dev
docker compose pull or3
docker compose up -d --wait --wait-timeout 180 or3
curl --fail --silent --show-error 'http://127.0.0.1:3100/api/health?deep=true'
```

The deep health response must contain `"status":"ok"`. Data lives in the
`or3-dev-data` Docker volume and survives image updates. The port is bound to
`127.0.0.1`; reach it through an SSH tunnel or add a reverse proxy if you need
remote access. This project is not managed, so `npx @or3/cloud backup` does not
apply to it; if you need a snapshot, stop the service briefly and archive the
volume contents instead of deleting or recreating the volume.

### Routine update: replace the image

Run every command in the development deployment directory **on the server**
unless stated otherwise.

1. Record what is running now, so you can go back:

```bash
cd /srv/or3-dev
grep '^OR3_IMAGE=' .env
docker compose ps or3
```

2. On **your computer**, confirm the new immutable reference in the **Checks**
   workflow summary (see [B6](#6-find-the-image-digest)).

3. On the **server**, put the new digest in `.env`:

```bash
cd /srv/or3-dev
# Edit .env and set OR3_IMAGE=ghcr.io/saluana/or3-chat@sha256:<new-digest>
sed -i 's|^OR3_IMAGE=.*|OR3_IMAGE=ghcr.io/saluana/or3-chat@sha256:<new-digest>|' .env
```

4. Pull and recreate the service. A restart alone does **not** install a newly
   published image, and `git pull` alone changes nothing on the server:

```bash
docker compose pull or3
docker compose up -d --wait --wait-timeout 180 or3
```

5. Verify the exact image and the application:

```bash
container="$(docker compose ps -q or3)"
docker inspect --format '{{.Config.Image}}' "$container"
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container"
curl --fail --silent --show-error 'http://127.0.0.1:3100/api/health?deep=true'
docker compose logs --tail 100 or3
```

`.Config.Image` must show the digest you set. To roll back, set `OR3_IMAGE` back
to the previous digest and repeat step 4; the data volume is untouched.

### Updating a managed installation

Managed installations (CLI or dashboard) update only from a published stable
release. Run these on the **server**, in the managed deployment directory:

```bash
cd /path/to/managed-deployment
npx @or3/cloud status
npx @or3/cloud doctor
npx @or3/cloud backup
npx --yes @or3/cloud@<version> update --to <version>
npx @or3/cloud verify
```

The package version and `--to` version must match; that is how the CLI installs
the exact Compose/Caddy assets that belong to the image. The updater records the
previous image and data snapshot as its immediate rollback point.

For a dashboard-capable deployment, **Admin → Operations → Dashboard Update**
performs the same exact-version update. Do not mix CLI update commands with
hand-edited generated Compose files.

## D. Updating dependencies

The repository intentionally has two dependency files:

| File | Consumer | Command |
|---|---|---|
| `bun.lock` | contributors, local dev, tests | `bun install` |
| `package-lock.json` | the Docker fixed-profile build | maintained through `bun run check:lock-drift` and the Dockerfile's `scripts/docker/prepare-manifest.mjs` |

When you change `package.json`:

1. Update the contributor tree and lockfile with Bun:

```bash
bun install
```

2. Confirm the fixed-profile lock still matches the pruned manifest:

```bash
bun run check:lock-drift
bun run release:cloud:check
bun run cloud:package:check
```

3. If a first-party provider version changed, update
   `packages/create-or3-chat/first-party-versions.json` and verify the exact
   versions exist on npm before building an image:

```bash
npm view or3-provider-basic-auth@<version> version
npm view or3-provider-sqlite@<version> version
npm view or3-provider-fs@<version> version
```

A dependency change always requires a new image build (push to `or3-cloud` and
let the **Development image** job build it). Do not substitute a Bun-built
artifact for the Docker/npm-built one. For production, add the relevant
security and compatibility checks from **Extended validation** or the stable
candidate workflow before publishing; the build is not a substitute for them.

## E. Stable release

This is **not** the procedure for ordinary development updates. A stable release
is required only when a managed installation must receive the change, or when
you want a public versioned artifact. The detailed authority for the release
ceremony is [Releasing OR3 Cloud](releasing.md); the short version is:

1. **Prepare the version** in a clean worktree. The same version must appear in
   the root `package.json`, root lock metadata, `packages/or3-cloud/package.json`,
   and `packages/or3-cloud/src/cli.ts`.

2. **Qualify the candidate** with **Qualify OR3 Cloud Candidate** on the exact
   commit (`workflow_dispatch`). It rejects used versions, builds both
   multi-architecture images once, and runs the deeper checks: package binding,
   manifest and anonymous-pull contracts, security scans, ARM runtime,
   upgrade/rollback/persistence lifecycle, and a signed receipt. It cannot
   publish npm or stable image tags.

3. **Review the result**, including the receipt digests and any migration or
   rollback warnings.

4. **Promote and publish** by pushing the matching tag (`git tag v<version>`,
   `git push origin v<version>`). **Release OR3 Cloud** promotes the exact
   qualified digests without rebuilding and publishes the exact qualified
   tarball as `@or3/cloud@<version>`.

5. **Confirm publication**: the npm job verifies the exact version, integrity,
   and `npx` invocation, and reports both image digests.

6. **Update managed installations** with the exact-version CLI command shown in
   [Updating a managed installation](#updating-a-managed-installation).

Failed candidate verification reuses the already-built digests: use GitHub's
**Re-run failed jobs**, not a new build. A source change requires a new version.

## F. Recovery and troubleshooting

### CI passed, but no new image appeared

- The **Development image** job runs only on a push to `or3-cloud` or a manual
  **Checks** dispatch, and only when the push changed runtime files. Markdown
  changes outside `public/` (for example `docs/` or `README.md`) do not build an
  image.
- Check the **Core checks** job result first. If it failed, the image job is
  skipped by design.
- Check the **Development image** job summary for the digest. If the commit's
  `dev-<sha>-<arch>` tag already existed with the same revision, the job reuses
  it instead of rebuilding.

### An image was published, but the server still runs the old version

- `docker compose restart` and `git pull` never install a new image.
- The development deployment changes only when `.env` points at the new digest
  and you run `docker compose pull or3` followed by
  `docker compose up -d --wait or3`.
- Managed installations change only through the exact-version `@or3/cloud`
  updater. Installing a development image on a managed deployment is not
  supported.

### The new container fails to start

```bash
cd /srv/or3-dev
docker compose ps -a or3
docker compose logs --tail 200 or3
```

Then restore the previous `OR3_IMAGE` digest and run step 4 again. Common causes
are missing secrets in `.env`, a typo in the digest, or a volume permission
change. The container runs as non-root; the Dockerfile seeds `/data` for it.

### Health or readiness checks fail

```bash
curl --silent --show-error 'http://127.0.0.1:3100/api/health?deep=true'
docker compose logs --tail 200 or3
```

`"status":"degraded"` means at least one configured provider is not healthy
(for example missing SQLite or storage settings); HTTP 200 alone is not enough.
Do not delete the data volume to "clean" a failing start.

### Registry authentication or image pulling fails

- Public GHCR packages pull anonymously. For a private package, run
  `docker login ghcr.io` on the server with a token that can read packages.
- `manifest unknown` usually means a typo in the tag or digest, or a digest from
  a canceled run that never finished publishing.
- For managed updates, run the exact-version CLI so the digest and generated
  assets match.

### A late verification step fails

- Development images: re-run only the failed **Smoke-test the development
  image** or **Advance the development tag** job. The image build is retained,
  so the retry reuses the same digest.
- Stable candidates: use **Re-run failed jobs**. Do not rebuild, do not change
  the source, and do not reuse a version.
- Publication succeeded but post-publication verification failed: the artifacts
  are public; correct the problem with a new patch version instead of trying to
  overwrite them.

### Restoring a previous version

- Development deployment: set `OR3_IMAGE` back to the previously recorded
  digest and repeat the pull/recreate steps.
- Managed deployment: `npx @or3/cloud rollback --yes` restores the immediately
  preceding update point (one step only). It also restores the data snapshot
  taken before that update, so it discards writes made after the update.
- An older image alone cannot reverse a database migration. If schema or data
  changed, use the supported backup/restore flow and read the warnings before
  confirming a destructive restore.

**Never** run `docker compose down --volumes` or delete the application volume
as an update or troubleshooting step. That deletes the authentication database,
SQLite data, and uploaded files.

## Running deeper checks on demand

Go to **Actions → Extended validation → Run workflow** and pick a suite:

- `tests` — full test suite, browser suites, and full-project lint.
- `lint` — full-project ESLint only.
- `performance` — strict performance budgets and production build budgets.
- `plugin-runtime` — full plugin compatibility and static generation.
- `deployment` — complete disposable Cloud deployment lifecycle.
- `all` — everything above.

The same suites run on the weekday schedule. They are intentionally not part of
the routine deployment path; run the relevant one when a change touches a
sensitive subsystem or before a stable release.

## Choosing checks against the deployed revision

The routine path always runs type-check, core tests, changed-file lint, and the
development image smoke. Extra checks are selected by what changed:

- Database migrations, authentication, storage, installer/update logic, or
  runtime dependencies: run the relevant **Extended validation** suite.
- Any change that will reach a managed production deployment: compare the
  revision that is actually deployed with the revision you intend to deploy,
  not just the last commit. Read the deployed revision from the running
  container label:

```bash
container="$(docker compose ps -q or3)"
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container"
```

Then diff locally from that revision to the target commit and run the extended
suite if any sensitive subsystem appears:

```bash
git diff <deployed-revision>..<target-commit> --stat
```

If the deployed revision is unknown or no longer available locally, treat the
change as potentially sensitive and run the relevant suite instead of assuming
nothing important changed.

## Related

- [Installation and operations](installation.md)
- [Releasing OR3 Cloud](releasing.md)
- [Cloud package README](../packages/or3-cloud/README.md)
- [Deployment and operations](../public/_documentation/cloud/deployment-operations.md)
