# Selected Document Utility

A minimal, free, offline **selected-document** utility for OR3. It takes the
user's current selection and returns a compact digest: an outline of the leading
sentence of each paragraph, deterministic statistics, and a short Markdown
result. There is no API key, no network access, no server code, and no plugin
dependency.

- **Plugin id:** `or3.selected-document-utility`
- **Trust:** `isolated-client` (worker isolation)
- **Profile:** `or3-portable-client-v1` — it validates with zero findings and
  inspects as `conformant`.
- **License:** GPL-3.0 (see [`LICENSE`](./LICENSE))
- **Notices:** [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)

## First action

`Summarize selected document` (`or3.selected-document.summarize`) is a
host-mediated command-palette command. The host passes the selection to the
isolated worker and receives a result:

```json
{
  "title": "Portable plugin runtime",
  "style": "bullets",
  "outline": ["The portable client profile keeps plugin code inside an isolated worker."],
  "statistics": { "characters": 666, "words": 96, "sentences": 9, "paragraphs": 3, "readingMinutes": 1 },
  "markdown": "# Selection digest: Portable plugin runtime\n\n..."
}
```

The exact first-action input and output are committed as a fixture:

- `fixtures/sample-selection.json` — the sample selection (`title` + `content`).
- `fixtures/expected-digest.json` — the byte-for-byte expected result.
- `fixtures/workspace/sample-document.md` — the same content as a standalone
  **sample workspace** document. `client.test.mjs` fails if it drifts from the
  selection fixture.

## Layout

| Path | Purpose |
| --- | --- |
| `client.mjs` | Client entry: manifest + `createSelectedDocumentUtility()` setup. |
| `lib/digest.mjs` | Pure, dependency-free first-action transform. |
| `client.test.mjs` | Shipped tests, including the first-action fixture. |
| `or3.manifest.json` | Generated manifest V2. |
| `or3.package-policy.json`, `or3.setup.json` | Generated portable descriptors. |
| `settings.schema.json` | Settings schema referenced by the manifest. |
| `.authoring/` | Authoring-only generator (never shipped; see below). |
| `container/` | Pinned Bun test container. |

## Requirements

- [Bun](https://bun.sh) 1.3.6 or newer (the utility's tests run with `bun test`).
- Node.js 24 or newer for the `or3-plugin` CLI.
- `@or3/plugin-sdk` 2.0.0 or newer.

## External developer workflow

From a scratch directory outside the OR3 checkout, as an outside developer:

```sh
# 1. Install the SDK from a packed tarball (the SDK is not yet published on npm).
npm pack <path-to-sdk>              # e.g. npm pack ../../../packages/plugin-sdk
npm install ./or3-plugin-sdk-2.0.0.tgz

# 2. Scaffold a starter (or copy this package).
npx or3-plugin create --id or3.selected-document-utility --dir selected-document-utility
cp -R <this-package>/. selected-document-utility/

# 3. Install the package's own dependency and run every gate.
cd selected-document-utility
npm install
npx or3-plugin validate .
npx or3-plugin test .
npx or3-plugin build .
npx or3-plugin pack . --archive ./selected-document-utility.or3pkg
npx or3-plugin inspect .
npx or3-plugin inspect ./selected-document-utility.or3pkg   # identical digest
```

## Authoring configuration

`or3.manifest.json`, `or3.package-policy.json`, and `or3.setup.json` are
generated from one configuration in
[`.authoring/profile.config.mjs`](./.authoring/profile.config.mjs) via
`defineOr3PortableProfile()` and `applyPortableProfileToManifest()` from
`@or3/plugin-sdk/profile`. Never hand-edit the descriptors.

```sh
bun .authoring/generate.mjs          # rewrite all generated files
bun .authoring/generate.mjs --check  # fail if the committed files drifted
```

The `.authoring/` directory is deliberately hidden: OR3's conformance reviewers
and the `or3-plugin` packer both skip dot-directories, so this Node-only tool is
never scanned or shipped. The repository's unit test
(`tests/unit/plugin-sdk-selected-document-utility.test.ts`) calls the same
`buildArtifacts()` function and fails if the committed files drift.

## Pinned test container

`container/Dockerfile` pins the exact Bun image by digest
(`oven/bun:1.3.6@sha256:f20d9cf365ab35529384f1717687c739c92e6f39157a35a95ef06f4049a10e4a`,
`linux/amd64` + `linux/arm64`). `container/run.sh` packs the in-repo SDK, builds
the image, and runs the utility's tests inside it:

```sh
sh container/run.sh
```

## Tests

```sh
bun test   # or: or3-plugin test .
```

The shipped suite covers the fixture, descriptor agreement, determinism, option
clamping, and input validation. It also activates the **default export** on the
shipped `@or3/plugin-sdk/testing` `PluginTestHost` and executes the first action
through the host-mediated command channel (the plugin registers the handler
during activation; the host resolves the command id to it, exactly as the
production worker RPC bridge does). The repository-only unit test does the same
against the workspace SDK source. `@or3/plugin-sdk/testing` is safe in a shipped
test because the packer and the conformance scanner share one exclusion set:
test/spec files and dot-directories are never scanned or packed.
