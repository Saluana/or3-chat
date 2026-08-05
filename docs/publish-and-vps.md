# Publish `create-or3-chat`

This guide covers the first `create-or3-chat` npm release. For local, Docker,
or public VPS installation, use [Installation and operations](installation.md).

## 1. Prepare npm

1. Sign in at [npmjs.com](https://www.npmjs.com/) and enable two-factor
   authentication for publishing.
2. Confirm that you can publish the unscoped `create-or3-chat` package and the
   scoped `@or3/intern-client` package. The npm account or organization must own
   those names.
3. Log in from the terminal and verify the account:

   ```bash
   npm login
   npm whoami
   ```

Configure each existing npm package with
[GitHub Actions trusted publishing](https://docs.npmjs.com/trusted-publishers/).
Trust its exact GitHub owner, repository, and `publish.yml` workflow with
`npm publish` permission. The release workflows use OIDC and npm provenance;
they do not require an `NPM_TOKEN`. A package normally needs one manual first
publication before its npm trusted-publisher settings exist.

See [Upgrading and releasing OR3 packages](releasing.md) for version order,
tag formats, and registry verification.

## 2. Publish the exact first-party dependencies

The generated project intentionally uses exact OR3 package versions. Every
entry in
[`packages/create-or3-chat/first-party-versions.json`](../packages/create-or3-chat/first-party-versions.json)
must exist on npm before the creator can generate clean npm and Bun lockfiles.

Check them from the `or3-chat` directory:

```bash
node packages/create-or3-chat/scripts/build-template.mjs
node scripts/release/check-create-or3-chat.mjs --registry
```

If the check names a missing package, publish that exact version from its
repository. In the sibling checkout used by this project, the package
directories are:

| Package | Directory |
|---|---|
| `@or3/intern-client` | `../or3-intern/clients/typescript` |
| `or3-provider-basic-auth` | `../or3-provider-basic-auth` |
| `or3-provider-clerk` | `../or3-provider-clerk` |
| `or3-provider-convex` | `../or3-provider-convex` |
| `or3-provider-fs` | `../or3-provider-fs` |
| `or3-provider-s3` | `../or3-provider-s3` |
| `or3-provider-sqlite` | `../or3-provider-sqlite` |
| `or3-scroll` | `../or3-vsc` |
| `or3-workflow-core` | `../or3-workflows/packages/workflow-core` |
| `or3-workflow-vue` | `../or3-workflows/packages/workflow-vue` |

Inspect each tarball before publishing it:

```bash
cd ../or3-intern/clients/typescript
npm pack --dry-run
npm publish --access public
```

Repeat only for versions that `npm view <package>@<version> version` does not
find. Never republish or silently change an existing version. These packages
currently use Bun in their prepack/build scripts, so install Bun on the release
machine or use their release workflows.

## 3. Qualify and publish `create-or3-chat`

Keep these three versions identical:

- The root `package.json`
- `packages/create-or3-chat/package.json`
- The embedded template, which is generated from the root version

Run the local qualification:

```bash
cd ../or3-chat
npm install
npm run type-check
npm run build
npm --prefix packages/create-or3-chat run check
npm run release:create:locks
npm run release:create:check -- --require-locks --registry
cd packages/create-or3-chat
npm pack --dry-run --ignore-scripts
```

Test the packed artifact before publishing:

```bash
npm pack --ignore-scripts
cd "$(mktemp -d)"
npm exec --yes \
  --package=/absolute/path/to/or3-chat/packages/create-or3-chat/create-or3-chat-0.1.1.tgz \
  -- create-or3-chat smoke-or3 --yes --skip-install --no-git
cd smoke-or3
npm install
npm run build
```

Replace the tarball version/path with the artifact printed by `npm pack`.

The recommended release path is the repository's **Release create-or3-chat**
GitHub Actions workflow:

1. Commit and push the qualified release.
2. Create and push a tag matching the package version exactly:

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. Watch the workflow complete its Windows/macOS/Linux creator tests, registry
   checks, npm and Bun install/build smokes, and Docker persistence smoke.
4. Confirm the release:

   ```bash
   npm view create-or3-chat@0.1.1 version
   npm create or3-chat@latest -- --help
   ```

For a manual release after the same checks:

```bash
cd packages/create-or3-chat
npm publish --access public --provenance=false
```

Local npm runs cannot generate GitHub provenance. Publishing is permanent for
that name/version, so use `npm pack --dry-run` and verify the version before
the final command.

## 4. Hand off to the installation guide

After publication is available from the npm registry, follow the
[public VPS with HTTPS and Caddy walkthrough](installation.md#public-vps-with-https-and-caddy).
It covers Debian and Docker prerequisites, nftables and UFW, Cloudflare
configuration, first-run credential handling, health checks, backups, and
BuildKit DNS recovery. The generated `or3-release.json` records the exact
artifact version and source revision deployed on the server.
