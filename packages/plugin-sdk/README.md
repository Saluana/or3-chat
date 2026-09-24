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
# From an SDK checkout with its build dependencies installed:
cd <path-to-sdk-checkout>
mkdir -p /absolute/path/to/external-workspace
bun pm pack --destination /absolute/path/to/external-workspace
cd /absolute/path/to/external-workspace
printf '{"private":true,"type":"module"}\n' > package.json
bun add ./or3-plugin-sdk-2.0.0.tgz
```

Bun 1.3.6 or newer must be on PATH for the CLI, bundling and starter tests.
The library also supports Node.js 24 or newer. The tarball ships prebuilt ESM + type declarations under
`dist/`; no TypeScript toolchain is required to consume it. The
developer-oriented `src/` is included for source inspection.

## Entry points

| Subpath | Exports |
| --- | --- |
| `@or3/plugin-sdk` | `defineOr3Plugin()` and Manifest V2 types, result helpers, typed mediated client types |
| `@or3/plugin-sdk/manifest` | Manifest V2 / grant / trust types |
| `@or3/plugin-sdk/host` | Host-only context construction boundary |
| `@or3/plugin-sdk/testing` | `PluginTestHost` fake host |
| `@or3/plugin-sdk/profile` | `defineOr3PortableProfile()` and the portable profile validator (Node-only) |
| `@or3/plugin-sdk/package-tree` | Canonical package tree hashing/verification (Node-only) |
| `@or3/plugin-sdk/plugin-icon` | Bounded PNG/WebP app-icon byte validation (Node-only) |
| `@or3/plugin-sdk/package-archive` | Deterministic ZIP transport for package trees (Node-only) |
| `@or3/plugin-sdk/candidate` | Immutable candidate receipts, validation and qualification (Node-only) |
| `@or3/plugin-sdk/state-compatibility` | State compatibility policy helpers (Node-only) |

The host owns context construction, plugin identity, generation, grants,
cancellation, client scoping, and cleanup. Plugin-facing client calls never
accept a plugin or workspace identity parameter.

Plugin packages can use `@or3/plugin-sdk/testing` for the local fake host. It
supports activation, reviewed-grant denial, feature negotiation, generation
teardown, storage revisions/CAS, pane and command dispatch, chat, secrets and
bounded file fixtures without importing OR3 application internals. The context
shape is stable across hosts (`ai`, `ui`, `panes`, `commands`, `chat`,
`workspace`, `storage`, `settings`, `secrets`, `files`, `http`, `network`,
`activity`, `events`); unavailable production adapters return typed
`unsupported` results for ordinary calls. Registration and subscription methods
use the synchronous exception contract below.

Registration and subscription methods are synchronous: `ui.registerSidebar`,
`ui.registerPane`, `ui.registerCard`, `ui.registerAction`, `commands.register`,
`activity.registerSource`, `events.on`, and `workspace.onChange` return a
registration handle on success and **throw** when unavailable. Unsupported
host defaults throw an `Error` with `code: "unsupported"` and
`retryable: false`; handle this with `try/catch`. Other unavailable methods
return a `PluginResult` with `error.code: "unsupported"` (asynchronously when
the method returns a promise). Namespace presence does not establish operation
support. Check the host's advertised features and grants, and still handle a
refusal from each call.

The lightweight portable test host records `client.emit()` as outbound only.
Use `host.emitHostEvent(name, payload)` to deliver a host-origin event; it copies
payloads and does not loop plugin-origin events back into subscriptions.
Raw grant denials use the wire code `grant-denied`, which the SDK maps to
`permission-denied`. Real-broker conformance covers cancellation, deadlines,
in-flight limits and replacement across captured databases; the fake does not
simulate transport timing or establish installed-browser qualification.

The generic test host settles blocked file writes on caller cancellation or
activation teardown, requests iterator cleanup without waiting for a stalled
producer, and never commits a late chunk. If workspace-switch cleanup fails,
it attempts to restore the previous definition. The failure includes
`details.rollback` (`restored` or `failed`) and `details.active`, so callers can
distinguish a restored plugin from an inactive host.

Activity sources use an owner-scoped id and can provide bounded run summaries,
optional details, live events, and explicit actions. The host maps these values
into its Activity registry using an opaque host activation namespace. Identical
logical IDs in separate activations cannot collide. Teardown removes subscriptions
and refuses late list/detail/action results. The host contains source failures;
plugins never receive
the registry or its internal records. Pane restore data, file handles, chat
messages, and secret references are validated as opaque host-facing values.
Secret-marked setup fields are rejected by ordinary settings writes and must
use the secrets client.
Command registration grants a plugin its own command execution; invoking a
command owned by another plugin additionally requires the reviewed
`commands.run.public` grant.

`PluginSseDecoder` is an incremental, bounded decoder for host-provided SSE
streams. It preserves event ids and names across split UTF-8/CRLF chunks,
emits heartbeats as comments, and refuses oversized lines or events.
CR-only event terminators dispatch immediately; incomplete events are discarded
at EOF. Delimiter scanning is linear within each input batch.

Portable storage enforces local admission limits of 1000 live keys, 1 MiB of
serialized values, and 10,000 retained names (including deleted names) per
plugin/workspace. Deleting frees live usage; names remain retained for CAS
safety and can be reused. `getRecord()` preserves deletion revisions, including
sync snapshot history. Lists skip deletions and return at most 200 keys in key
order; use `listPage()` to continue. The portable fake matches these limits and
returns copied settings values, including through `settings.list()`. Storage writes
use JSON wire semantics; conflicts include `details.currentRevision`.

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
./node_modules/.bin/or3-plugin create --id or3.example --dir ./example --sdk-source ./or3-plugin-sdk-2.0.0.tgz
(cd example && bun install)
./node_modules/.bin/or3-plugin validate ./example
./node_modules/.bin/or3-plugin test ./example
./node_modules/.bin/or3-plugin build ./example
./node_modules/.bin/or3-plugin pack ./example --archive ./example.or3pkg
./node_modules/.bin/or3-plugin inspect ./example.or3pkg
```

- `create` requires `--sdk-source`, a local tarball or SDK directory. It writes
  an absolute `file:` development dependency so installation resolves the chosen SDK from
  the generated directory. Keep that source available; update the dependency
  when moving the project. The optional peer range records SDK compatibility
  without fetching the unpublished package from npm. It copies a starter. The default `portable-v1` template is conformant
  with the `or3-portable-client-v1` profile (isolated-client worker, generated
  `or3.package-policy.json` + `or3.setup.json`, settings schema, client entry and
  a passing test). `minimal-v2` scaffolds the trusted-host V2 shape instead.
- `validate` runs the portable profile rules and the shared import/auto-import
  rules. It reuses the same rule constants and validator as the OR3 reviewer.
- `test` runs the package's own tests: `bun run test` when `package.json` has a
  `test` script, otherwise `bun test` (Bun is the supported runtime).
- `build` materializes a deterministic build tree and packs it.
- `pack` requires a preceding `build` and consumes `<package-root>/dist`,
  including the bundled entry. Source edits require another build; it does not
  silently rebuild. The lower-level `packV2Package` helper packs its explicit
  tree (also used internally for source snapshots). It writes a deterministic ZIP (`.or3pkg`/`.zip`) using the canonical
  package-tree digest.
- `inspect` reports the digest, manifest digest, module graph, grants, trust,
  state compatibility and conformance status without importing plugin code.
- `candidate` freezes one testable unit: sibling `package.zip`, `source.zip`
  and `receipt.json` outputs in a new directory. It composes the existing
  validate/build/pack helpers, records the source revision with dirty-snapshot
  status plus the actual SDK, lockfile and runtime inputs, and refuses to
  overwrite a frozen output — a changed source is a new candidate, never a
  mutated one. `--verify` recomputes every digest from the frozen files
  without rebuilding; `--qualify` additionally requires the exact clean
  source commit with matching SDK and dependency inputs, rebuilds, and fails
  unless the bytes compare equal. Dirty snapshots test locally but never
  qualify. Published versions are immutable: different bytes need an unused
  version. A package that pins a vendored SDK tarball or a sibling alias
  records those exact bytes in the receipt; release qualification compares
  them rather than trusting a version string.

Marketplace submission works without CI: upload the verified candidate's
`package.zip` and `source.zip` in Developers > Submissions, then attach
`receipt.json` to the draft. CI may build and qualify the same immutable
candidate as an artifact; ordinary pushes do not publish it. The Marketplace
currently requires an interactive developer session for upload and recent MFA
to submit it for independent review.

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
- `bun pm pack` runs `scripts/build.mjs` (Bun bundler + `tsc --emitDeclarationOnly`)
  and `scripts/publish-manifest.mjs`, which rewrites the publish `exports` to
  `./dist/*` for the tarball only, then restores the repository manifest. The package manager
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
