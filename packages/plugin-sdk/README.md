# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring contracts plus the standalone `or3-plugin`
authoring CLI. Plugin packages import only this package (or its documented
subpaths), never OR3 app aliases such as `~/`, `~~/`, `#imports`, or Nuxt
auto-imports.

## Install

`@or3/plugin-sdk` is **not yet published to npm**, and the existing release
workflows contain no SDK publication job, so publishing requires adding that
release integration. Install it from a packed tarball:

```sh
npm pack <path-to-sdk>              # e.g. npm pack ./packages/plugin-sdk
npm install ./or3-plugin-sdk-2.0.0.tgz
```

Node.js 24 or newer. The tarball ships prebuilt ESM + type declarations under
`dist/`; no TypeScript toolchain is required to consume it. The
developer-oriented `src/` is included for source inspection.

## Entry points

| Subpath | Exports |
| --- | --- |
| `@or3/plugin-sdk` | `defineOr3Plugin()` and Manifest V2 types, result helpers, mediated client types |
| `@or3/plugin-sdk/manifest` | Manifest V2 / grant / trust types |
| `@or3/plugin-sdk/host` | Host-only context construction boundary |
| `@or3/plugin-sdk/testing` | `PluginTestHost` fake host |
| `@or3/plugin-sdk/profile` | `defineOr3PortableProfile()` and the portable profile validator (Node-only) |
| `@or3/plugin-sdk/package-tree` | Canonical package tree hashing/verification (Node-only) |
| `@or3/plugin-sdk/package-archive` | Deterministic ZIP transport for package trees (Node-only) |
| `@or3/plugin-sdk/state-compatibility` | State compatibility policy helpers (Node-only) |

The host owns context construction, plugin identity, generation, grants,
cancellation, client scoping, and cleanup. Plugin-facing client calls never
accept a plugin or workspace identity parameter.

Plugin packages can use `@or3/plugin-sdk/testing` for the local fake host. It
supports activation, reviewed-grant denial, feature negotiation, one-shot
service failures, stale generations, and cleanup/activation-failure assertions
without importing OR3 application internals.

## CLI

### Portable workspace UI

Hosts advertising `or3-portable-workspace-v1` render a separate navigation tree
in the existing sidebar and the main tree in a workspace tab. The bounded
`columns` layout `workspace` gives content an approximately 860px maximum width
and an independently scrolling inspector. Below 760px, the inspector uses the
host's accessible modal slide-out instead of stacking below the content.
`field.text` and `field.select` can declare a bounded `onChange` action: text
input is debounced and select changes dispatch immediately with the current form
values. Host theme tokens, focus styles and touch sizing apply automatically,
without publisher CSS or DOM access. See the host's `plugins/portable-profile`
documentation for the complete surface and permission-gated tool contract.

The package installs an `or3-plugin` binary that works with no OR3 checkout and
no private path aliases:

```sh
or3-plugin create --id or3.example --dir ./example
or3-plugin validate ./example
or3-plugin test ./example
or3-plugin build ./example
or3-plugin pack ./example --archive ./example.or3pkg
or3-plugin inspect ./example            # or ./example.or3pkg
```

- `create` copies a starter. The default `portable-v1` template is conformant
  with the `or3-portable-client-v1` profile (isolated-client worker, generated
  `or3.package-policy.json` + `or3.setup.json`, settings schema, client entry and
  a passing test). `minimal-v2` scaffolds the trusted-host V2 shape instead.
- `validate` runs the portable profile rules and the shared import/auto-import
  rules. It reuses the same rule constants and validator as the OR3 reviewer.
- `test` runs the package's own tests: `bun run test` when `package.json` has a
  `test` script, otherwise `bun test` (Bun is the supported runtime).
- `build` materializes a deterministic build tree and packs it.
- `pack` writes a deterministic ZIP (`.or3pkg`/`.zip`) using the canonical
  package-tree digest.
- `inspect` reports the digest, manifest digest, module graph, grants, trust,
  state compatibility and conformance status without importing plugin code.

## Portable profile

`defineOr3PortableProfile()` from `@or3/plugin-sdk/profile` is the single
authoring input that generates byte-identical `or3.package-policy.json` and
`or3.setup.json` descriptors, required feature flags and revision hashes. The
portable profile keeps a package browser-only, dependency-free and
migration-free. See `public/_documentation/plugins/portable-profile.md` in the
OR3 repository for the full rule set.

## Packaging notes

- The repository checkout exposes `exports` that resolve to `./src/*.ts` so the
  OR3 host can consume the live source.
- `npm pack` runs `scripts/build.mjs` (Bun bundler + `tsc --emitDeclarationOnly`)
  and `scripts/publish-manifest.mjs`, which rewrites the publish `exports` to
  `./dist/*` for the tarball only, then restores the repository manifest. npm
  does not apply `publishConfig.exports`, so this prepack rewrite is required.
- The published subpaths and the JavaScript build entries live together in
  `scripts/publish-entries.mjs`, and `tests/unit/plugin-sdk-publish-surface.test.ts`
  fails if a published subpath is not built: declarations are emitted for every
  source file, so a missing build entry would otherwise ship a subpath that
  resolves to nothing.
- The package bundles no third-party runtime code; see `THIRD_PARTY_NOTICES`.

The V2 manifest supports optional `license` metadata containing the publisher’s
SPDX identifier or expression. Reviewed marketplace releases require it; the
host must not infer it from the presence of a LICENSE file.
