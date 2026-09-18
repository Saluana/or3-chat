# Phase 9 evidence: official products (Model Compare, Prompt Workbench, Document Utilities)

Scope: tasks 9.1–9.7. The three first-party products ship as ordinary portable
packages; official identity bypasses no rule.

## What was built

| Task | Implementation |
|---|---|
| 9.1 | `official-plugins/or3-model-compare`: prompt + model selection from the host allowlist, bounded parallel `ai.complete` calls, per-answer attributed spend and a spend summary, mapped failure copy. Host surface: `ai.models` capability + operator configuration (`OR3_PLUGIN_ALLOWED_MODELS`, `OR3_PLUGIN_MODEL_PRICES`), `shared/plugins/ai/model-catalog.ts`, `server/utils/plugins/ai/model-catalog.ts`, SDK helpers `listHostModels`/`completeWithHostModel`. |
| 9.2 | Choose-an-answer → `host.chat.continue` (new thread whose first message is the chosen answer, then navigate) and `host.document.create`; partial failures keep completed answers; catalog-unconfigured and budget/timeout/cancel states have actionable copy. |
| 9.3 | `official-plugins/or3-prompt-workbench`: `{{variable}}` parsing with malformed-placeholder detection, literal substitution, preview and execution sharing one render function, missing-value refusal. No expressions, includes, loops or background engine. |
| 9.4 | Versioned presets (`{version, presets}` in plugin storage, migration-by-reset for unknown versions, bounded name/count, deterministic slugs), first action that fills a `selection` variable from the host-provided selection or the package sample, package tests for save/load/delete and drift. |
| 9.5 | `official-plugins/or3-document-utilities`: selection validation with explicit bounds, four model transforms plus a deterministic **offline outline** (no model), preview with provenance, transform prompt builder. Host handoff: `first-action.run` carries only the selected content the host resolved. |
| 9.6 | Host-performed writes only: `host.document.create`, `host.document.replace` (host confirmation required, target = the document the plugin was opened on, never a plugin-named id), `host.chat.continue`. `app/utils/plugins/portable-host-actions.ts` plans from validated payloads; `app/composables/plugins/usePortableHostActions.ts` performs them through the app's own stores; `PortableClientView.vue` intercepts reserved `host.*` actions and refuses unknown ones. |
| 9.7 | Packaging through the ordinary lane: CLI `validate`/`test`/`pack`/`inspect` per package, deterministic archives, digests recorded below, conformance drift guards in the repository. |

Supporting SDK/host work:

- `ai.models` bridged capability (grant `network.http`), disclosure-only: approved
  models, prices and the enforced limits; unconfigured hosts answer
  `configured: false` instead of appearing to offer models.
- `firstAction.samplePath` in the portable profile (required with
  `usesSampleContext: true`, refused otherwise) plus
  `GET /api/plugins/{pluginId}/sample` which resolves it inside the package
  directory with a 32 KiB bound. The reference example was regenerated.
- `createPortableTestHost()` in `@or3/plugin-sdk/testing`: the same
  `PortableClient` contract the sandbox provides (canned answers *and*
  refusals, working settings/storage, captured renders/contributions/events), so
  packages test through the real `createPortablePlugin()` path.
- Docs: `public/_documentation/plugins/official-products.md` (+ docmap),
  `plugin-sdk.md` host-capability and test-host sections, `portable-profile.md`
  sample rule.

## Package evidence

Recorded from `bun packages/plugin-sdk/bin/or3-plugin.mjs` on this commit:

| Package | Validate | Tests | Package digest | Manifest digest |
|---|---|---|---|---|
| `or3-model-compare` | conformant | 11 pass / 0 fail | `sha256-1c3353e6ec4677a3e14c3cef175a6164fb3f0148be2dbaa11b3796c74f250356` | `sha256-6acfb8d8957dd64496f7244d5025bb94853960902a6ca6d0386629b05d3c2573` |
| `or3-prompt-workbench` | conformant | 9 pass / 0 fail | `sha256-5fdbbe0b06575966ebfbf3b0bc331897562dadf1cfe8cb2e9863b29013c7a361` | `sha256-1866194815a40e2dc2eb249adf12f08beec6d3c5de6a4300a1d2d33d8a2e2803` |
| `or3-document-utilities` | conformant | 9 pass / 0 fail | `sha256-ebd894862e68e0c66c57ef077409d9c2d3ce29e88081398f3d66d4a3574335b0` | `sha256-e7e16f2b19f88a67079eb116a3ea782a973608a243e5f1c3b0af9f154a8a1ba3` |

Manifest digests are unchanged from the first recording: the review round below
touched package code, the setup field label and the READMEs, not the manifest.
The CLI resolves the SDK from `dist/`, so the CLI was rebuilt before this table
was produced.

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

## Verification performed

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
- Pre-existing failures, distinguished from this work:
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
