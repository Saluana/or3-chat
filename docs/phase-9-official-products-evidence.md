# Phase 9 evidence: official products (Model Compare, Prompt Workbench, Document Utilities)

Scope: tasks 9.1–9.7. The three first-party products ship as ordinary portable
packages; official identity bypasses no rule.

## What was built

| Task | Implementation |
|---|---|
| 9.1 | `official-plugins/or3-model-compare`: prompt + model selection from the host allowlist, bounded parallel `ai.complete` calls, per-answer attributed spend and a spend summary, mapped failure copy. Host surface: `ai.models` capability + operator configuration (`OR3_PLUGIN_ALLOWED_MODELS`, `OR3_PLUGIN_MODEL_PRICES`), `shared/plugins/ai/model-catalog.ts`, `server/utils/plugins/ai/model-catalog.ts`, SDK helpers `listHostModels`/`completeWithHostModel`. |
| 9.2 | Choose-an-answer → `host.chat.continue` (new thread whose first message is the chosen answer, then navigate) and `host.document.create`; partial failures keep completed answers; catalog-unconfigured and budget/timeout/cancel states have actionable copy. |
| 9.3 | `official-plugins/or3-prompt-workbench`: `{{variable}}` parsing with malformed-placeholder detection, literal substitution, preview and execution sharing one render function, missing-value refusal. No expressions, includes, loops or background engine. |
| 9.4 | Versioned presets (`{version, presets}` in plugin storage, migration-by-reset for unknown versions, bounded name/count, deterministic slugs), first action that fills a `selection` variable from the host-provided selection or, when none exists, the package sample; package tests for save/load/delete and drift. The UI commits a preset only after the host storage service confirms the write. |
| 9.5 | `official-plugins/or3-document-utilities`: selection validation with explicit UTF-8 byte bounds, four model transforms plus a deterministic **offline outline** (no model), preview with provenance, transform prompt builder. Host handoff: the surface resolves an authorized, activation-bound selection handle through `POST /first-action`, checks `documents.read` and a byte bound, and only then hands content to the plugin. |
| 9.6 | Host-performed writes only: `host.document.create`, `host.document.replace` (host confirmation of the exact frozen payload and document revision, target = the document the plugin was opened on, never a plugin-named id), `host.chat.continue`. Each write requires the activation's currently approved `documents.write`, is pinned to the workspace database captured at admission, and re-checks the activation identity and write grant before the write. `app/utils/plugins/portable-host-actions.ts` plans from validated payloads; `app/composables/plugins/usePortableHostActions.ts` unwraps the RPC envelope and performs the plan; `PortableClientView.vue` intercepts reserved `host.*` actions, renders canonical host wording and refuses unknown ones. |
| 9.7 | Packaging through the ordinary lane: CLI `validate`/`test`/`pack`/`inspect` per package, deterministic archives, digests recorded below, conformance drift guards in the repository. |

Supporting SDK/host work:

- `ai.models` bridged capability (grant `network.http`), disclosure-only: approved
  models, prices and the enforced limits; unconfigured hosts answer
  `configured: false` instead of appearing to offer models.
- `firstAction.samplePath` in the portable profile: optional, refused when
  `usesSampleContext` is false, and declared-path-missing is a build-time
  refusal. Selected context always wins; the sample is the fallback when nothing
  was selected, and `GET /api/plugins/{pluginId}/sample` resolves it inside the
  package directory with a 32 KiB bound. The reference example was regenerated.
- Production portable storage: `createPortableSettingsServices()` now registers
  workspace/plugin-scoped `storage.*` (Dexie `kv`, namespaced by plugin id) next
  to `settings.*`, so presets persist and a refusal reaches the plugin as data.
- Demand-driven activation: the manifest sync records verified sources and
  registers surfaces, while the sandbox starts when its surface opens and can be
  restarted after the containment watchdog stops it without discarding typed
  fields.
- `createPortableTestHost()` in `@or3/plugin-sdk/testing`: the same
  `PortableClient` contract the sandbox provides (canned answers *and*
  refusals, working settings/storage, captured renders/contributions/events), so
  packages test through the real `createPortablePlugin()` path.
- Docs: `public/_documentation/plugins/official-products.md` (+ docmap),
  `plugin-sdk.md` host-capability and test-host sections, `portable-profile.md`
  sample rule.

## Package evidence

Recorded from `bun packages/plugin-sdk/bin/or3-plugin.mjs` on this commit
(after the third review round; the SDK `dist/` was rebuilt first):

| Package | Validate | Tests | Package digest | Manifest digest |
|---|---|---|---|---|
| `or3-model-compare` | conformant | 18 pass / 0 fail | `sha256-0e86877f54f572a5b503366c58f97fa3123ff8050dba24376d0837495cd6618b` | `sha256-b32703bcc349a82536a332de756484c53bffe7e93f4860014c51a572105cfb24` |
| `or3-prompt-workbench` | conformant | 17 pass / 0 fail | `sha256-50a9438b760b2aa090fd59b52958f28d93dc2f78ec0c88e2109dc2e80ccc11f0` | `sha256-400dfc157f1876ea16432b30281fa81bb0652053a40a6b61a74f9e37fa7e4919` |
| `or3-document-utilities` | conformant | 16 pass / 0 fail | `sha256-c4513a03682639c781d5261b3f36d6835510f8fcfc8fb629313ceb0bc5979cf7` | `sha256-e7e16f2b19f88a67079eb116a3ea782a973608a243e5f1c3b0af9f154a8a1ba3` |

Model Compare and Prompt Workbench manifest digests changed because both now
declare the `documents.read`/`documents.write` grants their selection handoff and
approved writes require; `or3-document-utilities` already declared them. The CLI
resolves the SDK from `dist/`, so the SDK (and therefore the CLI) was rebuilt
before this table was produced.

Packing is deterministic (the same source packed twice produced the same archive
bytes). Each package carries its own `LICENSE` (GPL-3.0), `THIRD_PARTY_NOTICES`
(no third-party runtime code), source, settings schema, fixtures and tests, as
task 9.7 requires.

Per-package source/license/setup/compatibility evidence:

- **Source**: one package directory, `.mjs`/node-only `.authoring` generator;
  no private OR3 aliases (the conformance reviewer scans the module graph).
- **License**: GPL-3.0 `LICENSE` + notices; the paid-Plus distribution terms are
  recorded in `or3-marketplace/docs/commercial-policy.md`.
- **Setup**: generated `or3.setup.json` with fields, a test action and a first
  action (`or3-model-compare`/`or3-prompt-workbench` on the package sample,
  `or3-document-utilities` on the selection).
- **Compatibility**: `engines { or3: ^0.3.0, pluginApi: ^2.0.0 }`,
  `features.required: [or3-portable-client-v1]`, `trust: isolated-client`,
  `stateCompatibility` version 1 with `rollback: safe`.

## Review round (self-review before hand-off)

A ruthless review of this change set found and fixed:

| Issue | Fix |
|---|---|
| **Model Compare defaults never applied**: the setup field is `text` (the host stores a string) while the client read an array and the settings schema declared an array, so a saved default list was silently ignored. | `parseDefaultModels()` parses the comma-separated string (arrays still accepted for tests), the settings schema declares a string, and the label states the format. |
| **Replace renamed the user's document**: the host applied the plugin-provided payload title to the existing document. | `host.document.replace` is content-only; a plugin-supplied title is ignored (asserted in tests). |
| **Host limits ignored**: both products used their own output ceilings and never disclosed the host's session spend cap. | The host's disclosed `maxOutputTokens` clamps the plugin default and any saved setting, and the spend cap appears next to the attributed spend. |
| **Prompt Workbench had no model choice** and its new selector first landed inside a form, which scopes the host's submitted values to that form. | A model selector with prices, and the run button deliberately outside every form; each package now asserts that whole-store action buttons are not nested in a form. |
| **A declared `firstAction.samplePath` could be missing from the archive**, failing only at run time. | `or3-plugin validate` reports `portable-sample-missing` as nonconformant and `pack` refuses to write the archive; covered by tests and verified end to end on a package copy. |
| **A write was reported but not shown**. | `create`/`replace` navigate to the written document (chat continuation already navigated), with navigation best-effort after the write is reported. |
| **Dead references/params**: an unused `actions` return (and its now-dangling identifier), unused fact-parser parameters, and a settings field `description` the descriptor contract drops. | Removed; hints live in labels and the settings schema. |

## Review round 2 (independent P1 review)

A code-inspection review of the phase-9 change set (without running tests) found
twelve P1 issues; all were fixed:

| Issue | Fix |
|---|---|
| **Host writes read the wrong RPC shape**: `callPlugin()` resolves to an `{ ok, result }` envelope, so every successful write looked like an empty payload. | `readHostActionRpcPayload()` unwraps the envelope, preserves `ok: false` codes and requires a validated `result`; unit and composable tests pin it. |
| **Model Compare generated identifiers the host rejects**: remove buttons used the raw `provider/model` id, and `/` is forbidden by the host validator. | Remove buttons/actions are index-based and mapped back to models in plugin state; tests assert every rendered button id/action matches the host pattern with provider-qualified models. |
| **Prompt Workbench had no production storage**: the runtime registered only `settings.*`, and the UI claimed a save even if `storage.set` failed. | `createPortableSettingsServices()` registers workspace/plugin-scoped `storage.*`; the UI commits presets only after a successful result and reports a refusal. |
| **Products could render trees the host refuses**: character limits ignored UTF-8 bytes and aggregate budgets (prompt + four answers, expanded variables). | All limits are byte-based and sized to the renderer budgets; expanded prompts are bounded and refused with the offending name; previews/answers are explicitly abbreviated; each package has a last-resort render guard. |
| **Preset loads and clears left edited fields stale**: the renderer preserves dirty values and no replacement was requested. | A host-approved field-replacement handshake (`fieldValues` in the RPC result, applied by `PortableUiTree.replaceValues()` only to rendered ids) is used for preset loads, clears and context loads. |
| **Host writes bypassed approved authority**: the executor never checked grants. | Every host write requires the activation's currently approved `documents.write`; reserved action buttons render canonical host wording. Model Compare and Prompt Workbench declarations now request the document grants. |
| **The document handoff bypassed scoped selection handles**: the surface read `route.query.documentId` directly and sent unbounded text. | The surface resolves an activation-generation handle through `POST /first-action`, checks `documents.read` and a 6,000-byte bound, then reads exactly the handle's context. |
| **Replacement confirmation was not bound to content/target/revision**. | `prepare()` freezes the payload, target, activation identity and document revision; confirmation executes that exact plan, refusing a changed document, and the tree is disabled while confirmation is pending. |
| **Async writes were not pinned to a workspace**: a switch could redirect or split records. | The workspace database and generation are captured at admission, the activation identity and write grant are re-checked at execution, and `createDocumentInDb`/`updateDocumentInDb`/`getDocumentInDb`/`createMessageInDb` perform the writes on the captured database. |
| **`OR3_PLUGIN_ALLOWED_MODELS`/`OR3_PLUGIN_MODEL_PRICES` did not configure a prebuilt image**. | The container entrypoint translates both into `NUXT_ADMIN_*` runtime overrides (the plugin-connection-secret pattern), covered by the entrypoint translation test. |
| **The sample rule broke the SDK starter**: `usesSampleContext: true` without `samplePath` was rejected while the starter shipped exactly that. | `samplePath` is optional again (the pre-sample v1 shape stays valid): selected context wins, the sample is the fallback, and a package without one simply requires a selection. Docs and tests state the compatibility behavior explicitly. |
| **Products died after the 2-minute activation budget with no recovery**. | Activation is demand-driven (surfaces start their own sandbox), a stopped activation offers restart, and the last rendered tree plus the host field store survive so typed values are not lost. |

## Review round 3 (P2 review)

The same inspection then listed fifteen P2 findings; all were fixed:

| Issue | Fix |
|---|---|
| **Save Preset could not see the edited template**: it sat inside the preset-name form, so only that form's values were submitted. | The button sits outside every form (asserted by the package test) and the handler falls back to plugin state when a host submits only form values. |
| **The first paid transformation could run before the model was chosen**: changing the Transformation field updated host state while the plugin dispatched immediately with the first approved model. | Selecting a model-backed transformation is an explicit state update that renders the selector and prices; only the following click dispatches. The offline outline still runs in one click. |
| **Variable names collided with host control ids** (`template`, `model`, `presetName`) and `_`-prefixed names failed the host identifier rule. | Variable field ids are namespaced (`variable:<name>`) and mapped back to variable names on submit; covered by a package test. |
| **A failed transformation left an old result under new transform state** and write payloads were relabeled. | Every output stores its own transform, title and source; preview and write payloads derive only from that immutable result. |
| **Clear and context replacement did not invalidate an in-flight transformation.** | Each run carries a token; clear/reset/context replacement advance it and a superseded response is discarded. |
| **Model Compare could stay disabled after typing**, because enablement read plugin state that typing never updates. | The button is enabled independently of plugin state; the submitted prompt is validated at submit time with an explicit refusal. |
| **Workbench silently truncated oversized variable values.** | Oversized values are refused with the field name and bound; nothing is silently sliced before a model sees it. |
| **Different preset names silently overwrote each other** through the lossy slug. | A slug collision with a different actual name is refused explicitly; only the same name replaces its preset. |
| **Workbench's first action always used the sample.** | Selected context now wins; the sample is only the fallback when nothing was selected (round 2's handoff change). |
| **Provider failures lost their distinctions**: the HTTP transport collapsed every non-2xx to `policy-denied` and the SDK mapped unknown codes to `permission-denied`. | The transport preserves `data.rpcCode` (with status fallbacks), the bridge passes known codes through, and the SDK has a complete code map (`internal`, `invalid-input`, `not-found`, `unavailable`, `timeout`, …). |
| **Host actions had no re-entry protection.** | A host execution lock rejects a second action while one is preparing/executing and disables the rendered tree; covered by a component test. |
| **Replace reported success when no document was updated.** | Execution requires the updated record and otherwise refuses with `stale-target`. |
| **The document-to-text converter changed content meaning** (hard breaks and nested blocks ran together). | Hard breaks become newlines and nested lists keep their own markers. |
| **The "strict" price parser accepted `null`/`false`/`''` as zero**, and the catalog advertised all-zero prices the governor refuses. | A shared `isUsablePluginModelPrice()` (actual finite non-negative numbers, at least one positive) is used by both the catalog and the governor; malformed and all-zero prices are refused. |
| **The test host hid contract mismatches**: arbitrary trees were recorded, storage always existed, and `invokeRequest` returned raw handler payloads. | The portable test host validates every rendered/contributed view against the host schema and budgets (with a repository agreement test against the production validator), supports `unavailableCapabilities`, and returns the real `{ ok, result }` RPC envelope; all package tests were updated to read it. |

## Verification performed

Review round 1 (original hand-off):

- Package tests (`bun test` per package): 22 tests, all passing, including the
  first action, capability refusal handling, host-action payloads and preset
  migration.
- Repository: `bun run test` → 1 pre-existing failure only
  (`SystemPromptsModal.test.ts`, reka-ui `DialogRootContext`), everything else
  passing including the 26 new host/SDK tests; `bun run type-check` → 25 errors,
  all pre-existing (none in changed files, see below); `bun run build` → success,
  with the recorded build-time note that trusted-host V2 client UI remains
  rebuild-required (portable/isolated-client is the profile the products use);
  targeted `eslint` on every changed file → 0 errors and 0 new warnings.
- The packaged CLI resolves the SDK from `dist/`; it was rebuilt before the
  digests above were taken (the guard for a missing declared sample exists only in
  the rebuilt CLI).

Review round 2 (this change set):

- Package tests (`or3-plugin test` per package, which runs `bun test`):
  `or3-model-compare` 15 pass / 0 fail, `or3-prompt-workbench` 13 / 0,
  `or3-document-utilities` 12 / 0. New coverage includes host-safe identifiers
  with provider-qualified models, byte-budgeted prompt/template/selection,
  abbreviated previews, field-replacement envelopes and storage-refusal reporting.
- Host/SDK suite (`vitest run`): the portable host-action planner/parser,
  the setup handoff plan, the portable runtime (demand-driven activation,
  approvals), the `usePortableHostActions` composable (RPC unwrapping, write
  authority, frozen replace revision, captured database, activation re-check),
  the surface component, official-package conformance, SDK profile/sample/review/
  golden fixtures, and the Cloud entrypoint translation test → all passing.
- `bun run type-check`: the same 25 pre-existing errors, none in a changed file.
- `bun run typecheck` in `packages/plugin-sdk`: clean.
- Targeted `eslint` on every changed file: 0 errors and no new warnings.
- `or3-plugin validate` / `pack` / `inspect` on all three packages with the
  rebuilt SDK: conformant and eligible; package and manifest digests recorded
  above.

Review round 3 (this change set):

- Package tests (`bun test` per package, with the strengthened portable test
  host): `or3-model-compare` 18 pass / 0 fail, `or3-prompt-workbench` 17 / 0,
  `or3-document-utilities` 16 / 0. The harness now rejects invalid trees and
  returns the RPC envelope, so these tests exercise the renderer→RPC→action
  boundary rather than a permissive stand-in; the render guards, byte bounds and
  serializers got direct tests during the verification pass.
- Repository (`vitest run`): the portable test-host contract suite (including an
  agreement corpus against the production `validateRenderPayload`), the SDK host
  capability mapping, the model catalog parser, the full
  `shared/plugins/isolation/__tests__` suite and `shared/plugins/ai/__tests__`
  (128 tests) → all passing. The isolation bridge test's pre-existing bad
  assertion (invoking the ai.models spec while asserting `ai.complete`) was
  corrected.
- Final verification pass added direct coverage the earlier rounds lacked: the
  production plugin-storage service (namespacing, list/delete, invalid-input),
  each package's render guard under over-budget trees, restart with retained
  typed fields, the plugin tree disabled while a confirmation is pending, the
  replace path refusing a store that did not update a record, selective field
  replacement preserving unrelated edits, HTTP 503 → `unavailable`, an all-zero
  price refused by the provider, and the first-action client reading exactly the
  server-minted `handle.contextId`. The pass also found and fixed one duplicate
  price predicate in `openrouter-client.ts` that still accepted all-zero prices.
- `bun run type-check`: the same 25 pre-existing errors, none in a changed file;
  `bun run typecheck` in `packages/plugin-sdk`: clean.
- Targeted `eslint` on every changed file: 0 errors and no new warnings.
- `or3-plugin validate` / `pack` / `inspect` on all three packages with the
  rebuilt SDK: conformant and eligible; round-3 digests recorded above.

Pre-existing failures, distinguished from this work:

- `bun run type-check`: 25 errors in `shared/plugins/authority/__tests__`,
  `shared/plugins/isolation/__tests__`, `app/components/marketplace`,
  `server/utils/plugins/setup/__tests__`, `server/utils/plugins/connections/__tests__`,
  `shared/plugins/__tests__`, and
  `server/api/plugins/__tests__/isolation-capability.post.test.ts` (3 lines that
  exist unchanged in `HEAD`).
- `bun run plugin-runtime:sdk:check`: the `tests/plugin-runtime/sdk-minimal`
  fixture calls `context.http.request` while `PluginContext` has no `http`
  member; the fixture usage predates this phase (`8065baa9`) and is unrelated to
  the products.

## Not executed (honest limitations)

- **No browser journey.** Installing a package and clicking through a product in
  a real browser needs an admin-authenticated local instance with the portable
  runtime enabled, a configured model allowlist and provider credential. That was
  not available here, so activation/rendering is evidenced by the runtime's own
  tests, the surface component tests (including host-action interception and
  confirmation) and package tests through the real portable runtime — not by a
  browser session. Task 10.4's Gate 3 journeys remain the place this is proven.
- **No live provider call.** Model behavior is tested against a scripted host
  response; no paid completion was made.
- **No marketplace submission.** The packages are packed, validated and recorded,
  but publishing them requires the deployed central marketplace with a
  signed-in publisher account (deferred with phase 2.7). The submission bundle is
  the package archive plus the evidence above.
