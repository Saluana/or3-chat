# Selected Document Utility Example

`examples/plugins/selected-document-utility` is a complete, free, offline
selected-document utility that an external developer can scaffold, build, test,
validate, pack, and inspect with the `or3-plugin` CLI. It is
conformant with the [`or3-portable-client-v1`](./portable-profile) profile and
reports `trust: "isolated-client"`.

## What it does

The utility registers one host-mediated command-palette command,
`or3.selected-document.summarize` (`Summarize selected document`). The host
passes the current selection to the isolated worker; the utility returns a
deterministic digest with an outline, statistics, and Markdown. There is no API
key, no network access, no server code, and no plugin dependency.

The first action writes its result through the declared `documents.write`
operation and reads the selection through the declared `documents.read`
operation. Both are declared in `or3.package-policy.json` and covered by
`manifest.requestedGrants`. The package registers the command handler on its
host-mediated command channel during activation; the host resolves the command
id to that handler when it runs the first action, so the shipped default export
is immediately executable (the handler itself is never serialized across the
worker boundary).

## First-action fixture

The first action is pinned by a committed input/output pair, exercised by the
utility's own tests:

| File | Purpose |
| --- | --- |
| `fixtures/sample-selection.json` | The sample selection (`title` + `content`) and its workspace context. |
| `fixtures/expected-digest.json` | The exact expected first-action result. |
| `fixtures/workspace/sample-document.md` | The same content as a standalone sample document. |

The shipped test `client.test.mjs` fails if the expected digest changes, if the
selection is not deterministic across runs, or if the standalone sample document
drifts from the selection fixture.

## Sample workspace

The sample workspace is the smallest context that exercises the first action:

```
fixtures/workspace/
  sample-document.md        # one document
```

The selection is the whole document (`fixtures/sample-selection.json` records
`selection.kind: "whole-document"`). To reproduce the first action outside OR3,
read the document, build the selection `{ title, content }`, and call the
exported `analyzeSelection(selection, options)`. No workspace database, thread,
or account is required.

## Authoring configuration

`or3.manifest.json`, `or3.package-policy.json`, and `or3.setup.json` are
generated from one configuration via `defineOr3PortableProfile()` and
`applyPortableProfileToManifest()`:

```sh
bun .authoring/generate.mjs          # rewrite the generated files
bun .authoring/generate.mjs --check  # fail when the committed files drift
```

`.authoring/` is a hidden directory on purpose: OR3's conformance reviewers and
the `or3-plugin` packer both skip dot-directories, so the Node-only generator is
never scanned or shipped. The repository unit test
`tests/unit/plugin-sdk-selected-document-utility.test.ts` calls the same
`buildArtifacts()` function and fails on drift.

## Validate, test, build, pack, inspect

```sh
or3-plugin validate .
or3-plugin test .
or3-plugin build .
or3-plugin pack . --archive ./selected-document-utility.or3pkg
or3-plugin inspect .
or3-plugin inspect ./selected-document-utility.or3pkg
```

`inspect` reports the same canonical package-tree digest for the source root, the
`.or3pkg` archive, and the `.zip` alias.

## Pinned test container

`examples/plugins/selected-document-utility/container/Dockerfile` pins the
toolchain by image digest:

```
oven/bun:1.3.6@sha256:f20d9cf365ab35529384f1717687c739c92e6f39157a35a95ef06f4049a10e4a
  linux/amd64 -> sha256:766690ef3be36b73288435428c638e47b8500d01f8fa1c298c4b09dc29841197
  linux/arm64 -> sha256:d70b0bfcd9c2a976f79b6bedefc744446e8a3f99f871098156531bda3c05c343
```

`container/run.sh` packs the SDK tarball into the build context and runs the
utility's tests inside the image:

```sh
npm pack <path-to-sdk>              # e.g. npm pack ../../../packages/plugin-sdk
SDK_TARBALL=./or3-plugin-sdk-2.0.0.tgz sh container/run.sh
```

The container installs `@or3/plugin-sdk` from the tarball so the tests run
against the exact package under test, with no registry access.

## License and notices

The package is GPL-3.0 (`LICENSE`, matching the repository) and documents its
own source in `THIRD_PARTY_NOTICES`. It bundles no third-party runtime code; the
only runtime dependency is `@or3/plugin-sdk`, and the `.authoring/` generator is
not shipped.
