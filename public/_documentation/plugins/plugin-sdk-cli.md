# CLI reference

`or3-plugin` scaffolds, validates, tests, builds, packs, and inspects a workspace
plugin. It also freezes release candidates. For a guided local workflow, use
[Build your first plugin](/documentation/plugins/first-plugin); for review submission, use
[Publish your plugin](/documentation/plugins/publish).

## Install the SDK

The source tree's current workflows do not publish `@or3/plugin-sdk`. The local
`bun run dev:plugin --create ...` command packs and installs it automatically.
For a standalone authoring workspace, pack a local SDK checkout:

```sh
cd /absolute/path/to/or3-chat/packages/plugin-sdk
bun pm pack --destination /absolute/path/to/sdk-artifacts
cd /absolute/path/to/authoring-workspace
bun add /absolute/path/to/sdk-artifacts/or3-plugin-sdk-2.0.0.tgz
```

Create the destination directories first and use the tarball filename printed
by packing if the SDK version differs. The tarball exposes prebuilt ESM/types;
the repository itself resolves live `src/` exports. Bun 1.3.6 or newer is required
for CLI builds and starter tests. A standalone SDK can scaffold without a host
checkout, but `dev` needs a linked OR3 Chat checkout to run the app.

Invoke an installed CLI as `./node_modules/.bin/or3-plugin`, or use
`bun packages/plugin-sdk/bin/or3-plugin.mjs` from the host checkout.

## Commands

| Command | Effect |
| --- | --- |
| `create --id <id> --dir <path> --sdk-source <path> [--name <name>] [--template <template>]` | Creates a starter; SDK source is a local tarball or SDK directory |
| `dev [package-root] [--host <checkout>] [--port <port>]` | Starts the linked dedicated local host and watches a portable package |
| `validate <root>` | Checks manifest, package tree, profile, imports, and conformance without activating code |
| `test <root> [-- <test-args...>]` | Runs a declared `bun run test`; otherwise uses Vitest when its config exists, then `bun test` |
| `build <root>` | Materializes a deterministic build in `dist`, bundles local modules, and computes package identity |
| `pack <root> [--out <dir>] [--archive <path>]` | Packs the existing `dist`; refuses missing build output |
| `inspect <root-or-archive>` | Reports identity, imports, grants, trust, and state preflight without importing plugin code |
| `candidate <root> --out <new-dir>` | Builds and freezes package, source, and receipt together |
| `candidate --verify <dir>` | Verifies the frozen candidate without rebuilding |
| `candidate --qualify <root> --candidate <dir>` | Reproduces the candidate from frozen clean source and dependencies; requires byte-equal output |

### Templates

| Exact template name | Runtime |
| --- | --- |
| `portable-v1` (default) | Isolated portable worker with generated policy/setup descriptors |
| `minimal-v2` | Trusted-host definition |

Template names are literal CLI identifiers. Both produce the current manifest
format. The SDK source is stored as an absolute `file:` development dependency;
keep it available, or relink it if the project moves.

```sh
./node_modules/.bin/or3-plugin create --id my-tools.greeting \
    --dir ./greeting --sdk-source /absolute/path/to/sdk-artifacts/or3-plugin-sdk-2.0.0.tgz
cd greeting
bun install
./node_modules/.bin/or3-plugin validate .
./node_modules/.bin/or3-plugin test .
./node_modules/.bin/or3-plugin build .
./node_modules/.bin/or3-plugin pack . --archive ../greeting.or3pkg
./node_modules/.bin/or3-plugin inspect ../greeting.or3pkg
```

For trusted-host scaffolding, add `--template minimal-v2`. Portable development
uses `bun run dev`; the ignored `.or3-dev/host.json` remembers its linked checkout.

## Build and archive behavior

`pack` consumes `dist`, so rebuild after source changes. It never silently
rebuilds during packing. `.or3pkg` and `.zip` use the same deterministic ZIP
transport. The canonical package-tree digest identifies runtime content;
archive-byte and manifest digests are separate identities.

Trusted-host builds bundle local modules and Vue SFCs, leaving `vue` and
`@or3/plugin-sdk` as host singletons. Imported styles emit a sibling stylesheet
that the host attaches and removes with the activation. Declared server route
handlers are bundled to their manifest paths, without relying on the author's
`node_modules`. Route paths must be relative to the plugin route prefix.

Inspecting an archive verifies its exact extracted bytes. Inspecting a source
directory materializes its shippable tree; it is not a promise that source and
built archive always have the same digest. Inspect the actual archive for
release verification.

## What ships

| File class | Runtime package | Candidate source |
| --- | --- | --- |
| Runtime modules, descriptors, schemas, declared samples/assets | Included | Included |
| `.authoring/`, tests/specs | Excluded | Included for reproduction |
| Dependency lockfiles | Excluded | Included |
| `.git/`, `node_modules/`, build outputs, local host association, secrets | Excluded | Excluded |

Runtime validation and packing share exclusions. Test code may import
`@or3/plugin-sdk/testing`; authoring generators may import `/profile`.
A shipped runtime import of an authoring-only helper is refused.

## Candidate files and qualification

A candidate directory contains immutable `package.zip`, `source.zip`, and
`receipt.json`. The receipt binds package/archive/manifest/source/authority
identities, required host features, revision cleanliness, and actual SDK,
lockfile, and runtime inputs. Changing files after freezing breaks verification.
Qualification rebuilds the source snapshot in an isolated directory and compares
output; it never replaces the tested package.

Use a new output directory after edits. Keep candidate output outside the source
snapshot. Local dirty snapshots cannot qualify for publication. The watched
host's disposable candidates do not become submissions automatically.

## Failures

| Failure | Next step |
| --- | --- |
| Missing build output | Run `build` before `pack` |
| Unsafe import or Nuxt alias | Use the [SDK](/documentation/plugins/plugin-sdk) or move the helper to `.authoring/` |
| Descriptor drift | Run `profile:generate`, inspect the diff, then `profile:check` |
| Manifest integrity mismatch | Rebuild from intended source; do not edit an archive's identity |
| Unsupported profile/permission | Check the [Manifest](/documentation/plugins/manifest) and host support table |
| Interrupted test or missing runner | Fix the runner and rerun; signals/spawn failures never count as passing tests |
| Candidate verification or qualification mismatch | Create a new consistent candidate from clean, reproducible inputs |

Marketplace draft preparation is a separate source-checkout command,
`bun run marketplace:submit -- ...`. It authenticates, qualifies, uploads, and
opens a draft; final submission requires browser verification, and publication
requires independent review and signing. See [Publish](/documentation/plugins/publish).
