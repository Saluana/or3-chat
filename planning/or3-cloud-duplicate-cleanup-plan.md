# OR3 Cloud duplicate-code cleanup — one-page plan

I reviewed the 46 findings. Fix the real drift first; do **not** turn every
similar-looking function into a framework.

## P0 — fix now (behavior/security drift)

1. **Configuration contract (1, 3–5, 7, 18, 29):** introduce one typed env
   descriptor with `adminWritable`, `wizardOwned`, metadata, aliases, and
   secret flags; derive the admin/wizard lists from it. Centralize boolean and
   alias parsing, while keeping explicit `boolean` versus `enabled-unless-false`
   modes. Centralize strict-mode input and config-validation issues, not the
   caller-specific policy. Keep source-wizard and managed-CLI profile code
   separate, but test their common runtime profile against the same fixture.
   Make the release-version manifest the provider-version source of truth.
2. **Wizard duplication (8, 10–17):** export provider-selection helpers
   (`usesConvex`, `usesSqlite`, module ID mapping, local IDs), password policy,
   Convex project preparation, and session sanitization from their existing
   wizard modules. Replace local copies. Fix the browser password generator’s
   modulo bias with rejection sampling; share policy test vectors with the
   managed CLI rather than adding a cross-package runtime dependency.
3. **Operational contracts (19, 21, 26, 28):** use one server readiness probe
   and define a dual-stack port-availability policy. Adopt one documented,
   owner-only `KEY=value` initial-credentials format. Use cryptographically
   uniform Node/browser generators. Add cross-product contract tests where the
   published `@or3/cloud` package must remain self-contained.
4. **Server security/runtime (30, 32, 36, 37, 40):** extract a sliding-window
   core that supports both check/record and atomic use; standardize the 429 +
   `Retry-After` helper; share admin host-allowlist/host/proxy normalization;
   and use one generic-admin rate-limit enforcement helper.
5. **Provider contract/UI (45, 46):** generate the standalone provider host
   fixtures from the existing compatibility generator; replace client wizard
   substring error matching with structured `{ field, step, message }` issues.

## P1 — real, but characterize before consolidating

- **2, 6, 9, 14, 15, 20, 23–25, 27:** share parsers, profile defaults,
  Convex normalization, foreground command execution, and source-only
  readiness/TTY/next-step helpers only after parity tests. The managed package
  gets behavioral contract tests, not imports from the source app.
- **31, 38, 39, 41, 43:** reuse the fixed-window memory provider only where
  its semantics match; factor TTL parsing/cache construction with options;
  route the local presign fallback through the core expiry resolver; normalize
  hashes with an explicit allowed-algorithm parameter; share storage validation
  *test vectors*, not a new provider package.

### P1 implementation status

- **Done — 9:** `convex-self-hosted.ts` now normalizes the URL, admin key, and
  optional site URL once. Application env, local Convex CLI env, and deploy
  branching consume those inputs; tests lock the shared values.
- **Done — 39:** the download endpoint delegates its provider/default expiry
  decision to `resolvePresignExpiresAt`; tests cover provider precedence,
  legacy `expires_at`, and the maximum bound.
- **Done — 41:** `normalizeStorageHash(value, allowedAlgorithms)` now serves
  upload quota matching and legacy quota records. Upload allows only SHA-256;
  quota may normalize SHA-256 and MD5.
- **Deferred intentionally:** 2, 6, 20, 23–25, 27, 31, 38, and 43 still need
  contract tests that prove matching semantics. Do not merge their separate
  lifecycle, profile, package-boundary, or provider-specific behavior first.

## Deliberately do not consolidate

- **22:** source and managed `doctor` commands inspect different products;
  share the P0/P1 primitives only.
- **33–35:** gateway handlers and registries have meaningful authorization,
  lifecycle, and caching differences; registry item 34 already uses
  `createRuntimeConfigRegistry`.
- **42, 44, provider-ID half of 46:** provider packages have distinct routes,
  admin registration, client plugins, and release boundaries. Their literal
  IDs are their local identity, not drift.

## Execution order

Add characterization tests first, land P0 in small independent commits, then
take P1 only when a test demonstrates matching behavior. Run `bun run
test:changed` per batch, plus `bun run test:scripts` for CLI changes and the
provider compatibility check for fixture changes. Remove old code only after
all migrated callers pass those tests.

---

## Accepted findings: implementation context

This is the complete list of findings this cleanup should address. `P1` means
the outcome may be a shared test fixture or a small common primitive rather
than a cross-package import; do not delete code until characterization tests
prove the callers have the same contract.

### P0 — fix in this cleanup

- **1 — Env-key surfaces:** `config-manager.ts` has an admin write allowlist,
  `catalog.ts` has the wizard-owned list, and `config-metadata.ts` has a third
  schema. Their key coverage already differs. Create one typed descriptor and
  derive each view; keep the admin allowlist as an explicit security property.
- **3 — Boolean coercion:** `resolve-config.ts`, `catalog.ts`, and `derive.ts`
  accept different values. Use a shared token parser with separate explicit
  helpers for ordinary booleans and feature flags.
- **4 — Env aliases:** auth and sync/storage aliases are encoded in four
  places. Define aliases and precedence once, then derive reads and writes.
- **5 — Strict mode:** runtime config, wizard config, and wizard validation
  calculate strictness separately. Export a pure resolver with explicit env,
  deployment target, and production inputs.
- **7 — Managed profile:** source `deriveEnvFromAnswers()` and managed CLI
  `buildEnv()` both emit the closed Basic Auth/SQLite/FS profile. Preserve the
  package boundary, but verify their common runtime keys with a shared fixture
  and remove duplicate source-side profile assembly where possible.
- **8 — Convex selection:** `derive.ts`, `validation.ts`, `deploy.ts`, and the
  web wrapper calculate whether Convex is in use. Export one helper that
  includes sync, storage, and effective Connect selection.
- **10 — Password policy:** browser wizard, source CLI, managed CLI, and
  server checks implement the same policy. Keep the existing browser-safe
  policy as canonical and run the managed CLI against shared policy vectors.
- **11 — Local provider IDs:** `catalog.ts`, `provider-compatibility.ts`, and
  doctor each own the same set. Re-export the compatibility registry; doctor
  uses the same source or a generated fixture if it must stay standalone.
- **12 — Provider module IDs:** `derive.ts`, compatibility code, doctor, and
  the managed CLI build package module names independently. Route source code
  through `providerIdToModuleId`; assert standalone tools against its fixture.
- **13 — SQLite selection:** derivation, validation, and install planning gate
  SQLite differently. Export one `usesSqliteProvider()` that includes Connect.
- **14 — Command runner:** wizard deploy and install-plan each wrap
  `cross-spawn` with the same foreground/error behavior. Move that narrow,
  foreground runner beside `package-manager.ts`; do not merge detached or
  signal-forwarding process modes into it.
- **15 — Convex scaffold:** deploy, doctor, and web wizard independently
  detect/init the Convex project. Share the idempotent project test and init
  command builder; leave command orchestration at the caller.
- **16 — Secret persistence:** validation sanitizes answers while preset save
  also strips secrets inline. Make preset save call `sanitizeAnswersForSession`.
- **17 — Connect fallback:** `catalog.ts` duplicates the effective-connect
  fallback already provided by `connect-provider.ts`; replace the inline copy.
- **18 — Provider versions:** `provider-versions.ts` still pins Basic Auth at
  `0.0.4`, while package/creator metadata use `0.0.7`. Generate or validate
  this table from the release version manifest; fail release checks on drift.
- **19 — HTTP readiness:** source CLI and web wizard have byte-identical
  `waitForHttpReady`. Extract one server-safe helper. Keep the client
  composable's abort/lifecycle behavior separate, but test the same probe
  semantics.
- **21 — Port availability:** source CLI/doctor are IPv4-only, dev has
  dual-family behavior, and other callers invert the question. Define
  `isPortAvailable` around an explicit bind policy and use it in both port
  pickers and diagnostics.
- **26 — Secret generation:** browser wizard uses modulo-biased random choice;
  Node callers use different algorithms. Provide uniform Web Crypto and Node
  implementations behind the same test vectors; fix the browser generator
  with rejection sampling.
- **28 — Initial credentials:** source and managed flows write the same
  `.or3-initial-credentials` name in incompatible formats. Select documented
  `KEY=value` format, write mode `0600`, and make readers tolerate the legacy
  form during the transition.
- **29 — Config validation:** CLI validation, wizard validation, admin config,
  and `config.or3cloud.ts` expose incompatible ideas of valid config. Extract
  the resolved-env validation result; callers add only their contextual
  preflight checks.
- **30 — Sliding limiter:** sync and LLM reimplement timestamp-window/LRU
  logic. Extract a configurable core supporting read-only check, record, and
  atomic check-and-record, then retain separate policy tables.
- **32 — 429 responses:** sync, storage, workflow, and related handlers repeat
  retry calculation, header setting, and error shape. Add one enforcement
  helper without changing route-specific rate-limit keys.
- **36 — Admin host allowlist:** `admin-gate.ts` and `admin/guard.ts` duplicate
  host normalization/proxy handling and 404 policy. Share an
  `enforceAdminHostAllowlist(event, config)` helper.
- **37 — Host/protocol/loopback handling:** middleware and request identity
  reimplement host/proxy/loopback rules. Consolidate the security predicates
  around `normalize-host.ts` and the proxy identity utilities; add IPv4/IPv6
  regression cases.
- **40 — Generic admin rate limits:** admin handlers repeat IP lookup,
  generic limit check, and 429 emission. Reuse one enforcement helper built on
  the existing admin auth limiter.
- **45 — Provider host fixtures:** five provider-local `or3-chat-contract.ts`
  files are hand-maintained `any` shims, and Convex carries unused Clerk data.
  Extend the existing compatibility snapshot generator to own these files and
  make its check fail on drift.
- **46 (client part) — Wizard field errors:** client rules infer field/step
  from error-string substrings, duplicating wizard metadata. Return structured
  validation issues and bind them to field/step IDs directly.

### P1 — address after a parity/characterization test

- **2 — `.env` parser/serializer:** admin editing preserves comments and uses
  a different serializer from managed CLI parsing. Factor parsing/escaping
  rules, retain the admin-only preserving writer, and test quotes/comments
  across both flows.
- **6 — DB/driver/TTL defaults:** repeated literals are drift-prone, but
  source relative paths and managed `/data` paths are intentionally different.
  Define profile/provider defaults in their owning module, not in the wizard
  catalog, and test source-versus-managed values explicitly.
- **9 — Convex self-hosted env:** deploy's CLI environment and derivation's
  application env overlap but are not identical. Share normalized self-hosted
  Convex inputs, then derive each output deliberately.
- **20 — Deep-health/Compose arguments:** source deploy repeats managed CLI
  health behavior. Keep the published package self-contained; share a health
  contract fixture and only extract source-local Docker helpers.
- **23 — Spawn and signals:** six command paths have different foreground,
  detached, and signal-forwarding needs. Consolidate only the proven
  foreground runner (item 14); preserve specialized lifecycle code.
- **24 — Package-manager builders:** `start.mjs` and creator intentionally run
  with no app dependency. Keep those copies, but add parity vectors against
  the wizard's canonical package-manager functions.
- **25 — Next steps:** source and managed UX strings have drifted. Centralize
  source-wizard messaging and give managed CLI a snapshot test for its
  separately shipped wording.
- **27 — TTY/headless detection:** share source-side detection where import
  boundaries allow and assert standalone CLI behavior with parity tests.
- **31 — Fixed-window limiters:** the common memory provider, generic admin
  limiter, login limiter, and webhook limiter differ in bypass, key, and
  lifecycle semantics. Migrate only callers whose tests match the provider;
  do not silently replace auth throttling behavior.
- **38 — TTL LRU caches:** session and token-broker caches share parsing and
  expiration mechanics but have different keys/value invalidation. Extract a
  configurable cache helper only after tests lock those policies down.
- **39 — Presign expiry:** do not touch third-party `node_modules` adapters.
  Replace the local download-route fallback with the core presign-expiry
  resolver and characterize provider precedence.
- **41 — Hash normalization:** upload accepts SHA-256 while quota also accepts
  MD5. Share normalization with an explicit allowed-algorithm parameter so
  upload does not accidentally start accepting MD5.
- **43 — FS/S3 storage validation:** TTL, strict-mode, and diagnostic plumbing
  match, but provider requirements differ. Share a small host-level helper or
  test vectors only; do not create a new provider package just for this.
