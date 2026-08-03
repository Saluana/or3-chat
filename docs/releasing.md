# Upgrading and releasing OR3 packages

This runbook covers version bumps across the OR3 repositories and the final
`create-or3-chat` release. npm versions are immutable: once a version exists,
make another version bump for every correction.

Pushes to `main` run the relevant package qualification jobs, so a normal
GitHub push validates the release contents without publishing anything.
Releases are triggered by version-matching Git tags (or by an explicitly
started `workflow_dispatch`). npm versions are immutable, so publishing every
branch push would either fail on the existing version or require silently
inventing versions.

## Release order

Release only packages that changed. Use this dependency order:

1. Shared clients and independent packages.
2. Runtime bridges (`@or3/openclaw`).
3. Providers.
4. `or3-workflow-core`.
5. `or3-workflow-vue` when it depends on a new core version.
6. `create-or3-chat`, after every version embedded in its template is on npm.

Do not update `first-party-versions.json` to a version that npm does not serve
yet. The creator generates npm and Bun lockfiles from the registry, so one
missing version stops the release.

## Package and repository map

| npm package | Repository/directory | Release tag |
|---|---|---|
| `@or3/intern-client` | `or3-intern/clients/typescript` | `v<version>` in `or3-intern` |
| `@or3/openclaw` | `or3-chat/packages/openclaw-or3` | `openclaw-v<version>` |
| `or3-provider-basic-auth` | `or3-provider-basic-auth` | `v<version>` |
| `or3-provider-clerk` | `or3-provider-clerk` | `v<version>` |
| `or3-provider-convex` | `or3-provider-convex` | `v<version>` |
| `or3-provider-fs` | `or3-provider-fs` | `v<version>` |
| `or3-provider-s3` | `or3-provider-s3` | `v<version>` |
| `or3-provider-sqlite` | `or3-provider-sqlite` | `v<version>` |
| `or3-scroll` | `or3-vsc` | `v<version>` |
| `or3-workflow-core` | `or3-workflows/packages/workflow-core` | `or3-workflow-core-v<version>` |
| `or3-workflow-vue` | `or3-workflows/packages/workflow-vue` | `or3-workflow-vue-v<version>` |
| `create-or3-chat` | `or3-chat/packages/create-or3-chat` | `v<version>` in `or3-chat` |

The `or3-intern` tag releases its GitHub binaries, npm bootstrap package, and
TypeScript client at the same version. Before tagging it, confirm that the
target version is unused for both npm packages; otherwise the workflow can
partially publish and then fail on the existing version.

The external-agent Connect changes are in that same coordinated release. The
published `@or3/connect@0.1.0` predates the `openclaw`/`hermes` router, so verify
the next release's packed wrapper and downloaded binary before advertising the
new commands. Do not reuse a version already served by either package.

For the current external-agent work, the first published OpenClaw bridge is
`@or3/openclaw@0.1.0`, so the next bridge release must bump its package version
and use `openclaw-v<next-version>`. The public `@or3/connect@0.1.0` predates
the runtime router; release the next coordinated `or3-intern` version (using a
version unused by both `@or3/connect` and `@or3/intern-client`) with the `v<version>`
tag. A tag must point at the commit containing the package version and the
workflow that publishes it.

The OpenClaw bridge is released independently from the application. Its
workflow runs the package qualification and publishes only for an exact
`openclaw-v<version>` tag (or an explicitly approved `workflow_dispatch`).
Publish it before releasing a Connect CLI version that pins it, then verify the
exact version with `npm view @or3/openclaw@<version> version`.

## 1. Bump a package

Choose the next semantic version based on the change:

- Patch: compatible fix.
- Minor: compatible feature.
- Major: breaking API or behavior.

Update the package's `package.json` and its repository lockfile together. In a
monorepo, update exact internal dependencies too. For example, when Vue needs a
new workflow-core release, publish core first and update
`or3-workflow-vue` to depend on that exact published version.

Before committing, run the verification appropriate to that repository. At a
minimum, inspect the diff and the packed file list:

```bash
npm pack --dry-run
```

Use the package's targeted build, typecheck, and tests when its release workflow
expects them. Provider runtime source imports OR3 host aliases such as `~/` and
`~~/`; their standalone release workflows validate the distributable module
build because raw `tsc --noEmit` cannot resolve host-app modules outside OR3.

Commit and push the version bump before creating the tag. The tag must point to
the commit containing both the new version and the workflow that publishes that
package (for OpenClaw, `.github/workflows/publish-openclaw.yml`).

## 2. Trigger trusted publishing

For a single-package repository:

```bash
git tag v0.0.4
git push origin v0.0.4
```

For the workflow monorepo:

```bash
git tag or3-workflow-core-v0.1.5
git push origin or3-workflow-core-v0.1.5

git tag or3-workflow-vue-v0.1.7
git push origin or3-workflow-vue-v0.1.7
```

Replace the examples with the versions in the corresponding `package.json`.
The workflows reject mismatched tags.

Trusted publishing uses GitHub's OIDC identity and does not require an
`NPM_TOKEN`. Each npm package must trust its exact GitHub owner, repository,
and publishing workflow filename, with `npm publish` permission. For
`@or3/openclaw`, the npm Trusted Publisher fields are `Saluana`, `or3-chat`,
and `publish-openclaw.yml`. For `@or3/connect` and `@or3/intern-client`, use
`Saluana`, `or3-intern`, and `publish.yml`. A package generally needs one
manual publication before its npm trusted-publisher settings can be
configured.

For that first manual publication, package-level
`publishConfig.provenance: true` may cause:

```text
Automatic provenance generation not supported for provider: null
```

Disable provenance explicitly for the manual command:

```bash
npm publish --access public --provenance=false
```

Future GitHub Actions releases should retain provenance.

## 3. Verify npm propagation

A green workflow means npm accepted the publication, but registry reads may
take a short time to propagate. Verify the exact version before using it:

```bash
npm view or3-provider-fs@0.0.4 version
```

The command must print the requested version. An `E404` immediately after a
successful publication can be propagation; `ETARGET` means npm does not
currently serve the requested version. Check the workflow and retry
`npm view` before changing code or lockfiles.

Never:

- Force-move a published release tag.
- Delete and recreate a version to change its contents.
- Assume the `latest` tag proves a specific version exists.
- Publish from a branch whose package version is already on npm.

## 4. Update the creator's first-party versions

After every required dependency is available, update:

```text
or3-chat/packages/create-or3-chat/first-party-versions.json
```

Use exact versions. Then rebuild and qualify the embedded template from the
`or3-chat` directory:

```bash
node packages/create-or3-chat/scripts/build-template.mjs
node scripts/release/check-create-or3-chat.mjs --registry
npm run release:create:locks
npm run release:create:check -- --require-locks --registry
```

The registry check must pass before publishing the creator. It also catches
template dependencies that point outside the generated project.

Keep the OR3 application and creator release versions aligned in:

- `or3-chat/package.json`
- `or3-chat/packages/create-or3-chat/package.json`
- Generated template metadata

Commit the version map, generated template, lockfiles, and version changes
together.

## 5. Release `create-or3-chat`

Push a tag matching the creator version:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The `or3-chat/.github/workflows/publish.yml` workflow runs creator checks on
Linux, macOS, and Windows; verifies registry dependencies; generates both
lockfiles; scaffolds npm and Bun projects; builds them; and runs the Docker
smoke before publishing the packed artifact.

Confirm the result at the registry:

```bash
npm view create-or3-chat@0.1.2 version
npm create or3-chat@latest -- --help
```

The `workflow_dispatch` path is for an intentional operator-triggered release.
Normal development pushes never invoke npm publishing.

## Updating an existing generated project

V1 generated projects contain editable application source and do not yet have
an automatic upgrade command. Treat an upgrade as an application dependency
change:

1. Back up `.env` and persistent `/data`.
2. Commit the generated project's current state.
3. Update desired OR3 dependencies to published versions.
4. Regenerate the npm or Bun lockfile with the project's chosen package manager.
5. Run `npm run doctor` (or `bun run doctor`) and build the project.
6. Rebuild the Docker deployment and verify `/api/health?deep=true`.

For large template changes, scaffold the new creator version into a separate
directory and deliberately merge the application changes. Do not overwrite an
existing non-empty project with the initializer.

## Failure checklist

- **Provenance fails locally:** publish the first version with
  `--provenance=false`; use OIDC in GitHub Actions afterward.
- **`E404` or `ETARGET` while generating locks:** verify every entry in
  `first-party-versions.json` with `npm view`.
- **Trusted publishing is rejected:** confirm the npm package trusts the exact
  GitHub owner, repository, and workflow filename, and that the workflow grants
  `id-token: write`.
- **Tag workflow rejects the version:** bump `package.json`, commit it, and use
  the exact tag format from the repository map.
- **Provider typecheck cannot resolve `~/` or `~~/`:** validate the module build
  in the provider repository and run host-integrated checks from `or3-chat`.
- **Vue cannot resolve workflow-core:** build core first and confirm Vue's exact
  dependency version exists on npm.
- **Publication reports an existing version:** choose a new version; npm
  versions are immutable.
