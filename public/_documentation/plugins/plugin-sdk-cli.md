# Plugin SDK CLI and Packaging

`@or3/plugin-sdk` provides prebuilt ESM and type declarations under `dist/`,
plus a standalone `or3-plugin` CLI. External authors can scaffold, build, test,
validate, pack and inspect a plugin package without an OR3 checkout and without
any private path alias.

> **Publication status:** `@or3/plugin-sdk` is **not yet on npm**, and plan task
> 2.7 (SDK publication) is intentionally open. The existing release workflows
> contain **no SDK publication job**, so publishing requires adding that release
> integration; it is not merely a matter of removing `private` (the package is
> not marked `private`). Until that integration exists, the supported install
> path is a packed tarball.

## Install

Package the SDK and install the resulting tarball:

```sh
npm pack ./packages/plugin-sdk            # or: npm pack <path-to-sdk-checkout>
npm install ./or3-plugin-sdk-2.0.0.tgz
```

Node.js 24 or newer. The `src/` tree is shipped alongside `dist/` for source
inspection, but runtime imports resolve to `dist/`:

| Subpath | Exports |
| --- | --- |
| `@or3/plugin-sdk` | `defineOr3Plugin()` and Manifest V2 types, result helpers, mediated client types |
| `@or3/plugin-sdk/manifest` | Manifest V2 / grant / trust types |
| `@or3/plugin-sdk/host` | Host-only plugin context construction |
| `@or3/plugin-sdk/testing` | `PluginTestHost` fake host |
| `@or3/plugin-sdk/profile` | Portable profile authoring + validation (Node-only) |
| `@or3/plugin-sdk/package-tree` | Canonical package tree hashing/verification (Node-only) |
| `@or3/plugin-sdk/package-archive` | Deterministic ZIP transport for package trees (Node-only) |
| `@or3/plugin-sdk/state-compatibility` | State compatibility policy helpers (Node-only) |

## CLI

```sh
or3-plugin create --id or3.example --dir ./example
or3-plugin validate ./example
or3-plugin test ./example
or3-plugin build ./example
or3-plugin pack ./example --archive ./example.or3pkg
or3-plugin inspect ./example            # or ./example.or3pkg
or3-plugin candidate ./example --out ./example-candidate-1
or3-plugin candidate --verify ./example-candidate-1
or3-plugin candidate --qualify ./example --candidate ./example-candidate-1
```

- `create` copies a starter template. `portable-v1` (default) is conformant with
  the `or3-portable-client-v1` profile; `minimal-v2` scaffolds the trusted-host
  V2 shape.
- `validate` runs the shared V2 decision engine — SDK/API range checks, the
  portable profile validator and the runtime import and Nuxt-auto-import rules —
  against the exact artifact, then canonically verifies the package tree. A
  tampered `integrity.package` fails with the canonical
  `manifest-integrity-mismatch` code. The host reviewer feeds the same engine,
  so local tooling and the reviewer cannot drift. The runtime import scan skips
  the files the packer excludes, so `@or3/plugin-sdk/testing` is allowed in test
  files and `@or3/plugin-sdk/profile` in dot-directories.
- `test` runs the package's own tests: `bun run test` when a `test` script
  exists, otherwise `bun test`. Bun is the supported runtime.
- `build` materializes a deterministic build tree and packs it.
- `pack` writes the deterministic ZIP transport (`.or3pkg`/`.zip`) bound to the
  canonical package-tree digest from `@or3/plugin-sdk/package-tree`.
- `inspect` reports the digest, manifest digest, module graph, grants, trust,
  state compatibility, state preflight and conformance status. A directory input
  is materialised before hashing; an archive is verified exactly as extracted, so
  the reported digest describes the artifact that was verified. It never imports
  plugin code. A fresh install reports `eligible`/`state-initialization`.
- `candidate` builds one immutable candidate — sibling `package.zip`,
  `source.zip` and `receipt.json` in a new directory — over the existing
  validate/build/pack helpers. The receipt (schema version 1, at most 16 KiB)
  binds plugin/version, package/manifest/source/authority digests, required
  host features, the source revision with dirty-snapshot status, and the
  actual SDK, lockfile and runtime inputs; unknown fields and oversized input
  are rejected. `--verify` recomputes every digest from the frozen files
  without rebuilding. `--qualify` requires the exact clean source commit with
  matching SDK and dependency inputs, rebuilds in a scratch directory, and
  fails unless the bytes compare equal — it never replaces the tested
  archive. Dirty snapshots test locally but never qualify, and a published
  version keeps immutable bytes (different bytes need an unused version).

The `or3-plugin` CLI bundles no third-party runtime code and imports only Node
built-ins plus this package's own modules. See [Local Development
Candidates](./local-development) for testing a candidate inside real OR3 Chat
without publishing it.

## Portable starter

`or3-plugin create` (default template) produces a package that:

- declares `manifest.trust: 'isolated-client'` and `runtime.client.isolation:
  'worker'`,
- requires the `or3-portable-client-v1` feature flag,
- ships generated `or3.package-policy.json` and `or3.setup.json` descriptors,
- ships a `settings.schema.json` that the manifest references,
- ships a client entry and a passing `client.test.mjs`,
- ships a hidden `.authoring/` generator (`bun .authoring/generate.mjs`, plus
  `profile:generate` / `profile:check` scripts) that regenerates the manifest
  fields and both descriptors from one configuration.

It validates and inspects with zero findings in both the external CLI and the
OR3 reviewer.

## Authoring-only files

The packer and the runtime import scanner share one exclusion set, so what is
reviewed is exactly what ships:

- Dot-directories (`.authoring/`, `.git/`) and build outputs (`node_modules/`,
  `dist/`, `coverage/`, `.or3-pack/`) are never scanned or packed.
- Test and spec files (`*.test.*`, `*.spec.*`, `__tests__/`) are never scanned
  or packed. You can therefore import `@or3/plugin-sdk/testing` in test files
  without it being treated as a shipped runtime import.
- Authoring tools that need `@or3/plugin-sdk/profile` (or `/package-tree`,
  `/package-archive`, `/state-compatibility`) belong in `.authoring/`.
- **Runtime files may not import `@or3/plugin-sdk/profile`.** The portable
  profile is an authoring-only surface; the scanner reports it as
  `unresolved-bare-import` if a shipped module imports it.

## Packaging

The repository checkout keeps `exports` pointed at `./src/*.ts` so the OR3 host
resolves the live source. `npm pack` runs the package's `prepack` script, which
builds `dist/` and rewrites the tarball's `exports` to `./dist/*`; `postpack`
restores the repository manifest. Because npm does not apply
`publishConfig.exports`, this prepack rewrite is what makes the tarball usable
as an installed dependency. Publishing that tarball to npm is not yet
implemented (see the publication note above). See [`plugin-sdk`](./plugin-sdk)
for the authoring surface and [`portable-profile`](./portable-profile) for the
portable rule set.
