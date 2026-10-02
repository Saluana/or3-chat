# Implementation and acceptance evidence

The six plan files match upstream exactly at the inspected default base `6ee4450b`.
This branch is separate from assistant/Files and starts on the temporary reviewed
integration base containing PR179 `40b7aef6`, PR181 `bb86066c`, and PR182 `07b235b2`.
The last PR adds only three strengthened tests after reviewed production `a515ab95`.

## Current source reconciliation

There is no current 128k numeric cap in the inspected native budget resolver.
The actual stale assumptions are the guessed 8k fallback, a 20%/8,192-token reply
reserve, and silent historical-message trimming in messageBuild/send/continue.
Native send currently persists user and assistant rows before final before-send
filters, so zero-write local rejection requires a preparation/admission boundary
without restoring pre-reliability lifecycle snapshots. Existing workflow handling
must still run through its normal admitted path.

OpenRouter documents total context shared by input and output, with advertised
completion capacity a ceiling, not guaranteed reserved output. Evidence sources:
[Models API](https://openrouter.ai/docs/guides/overview/models) and
[request parameters](https://openrouter.ai/docs/api_reference/parameters).
The implementation must account for actual requested reply capacity, tool/schema
and protocol overhead, and known route-specific input/output limits. A user
maximum is optional and cannot supply missing model capacity metadata.

## Failure owners and next sequence

1. Shared context-budget policy: advertised/user/route capacity, input plus reply,
   unknown metadata and tool/media estimate boundaries.
2. Canonical messageBuild owner: full unchanged provider payload, overflow instead
   of message removal, input/draft immutability through preparation.
3. Native useAi/continue/tool-loop and server owners: final admitted request before
   provider traffic; structured recoverable rejection with drafts/settings intact.
4. Usage, meter/preferences, atomic summary forks and canonical lineage projection.
5. Summary controls/landmarks, browser/provider retrieval, family/deletion UI.
6. Provider round trips, scale/build/contracts/docs and quality evaluations.

The assistant proposal safety increment precedes broad Files polish; this
independent compaction foundation receives implementation attention now.

## Engineering milestones

- Shared capacity policy: 7 boundary cases passed in `/tmp/task16-compaction-budget-candidate.log` after the missing-module baseline. Million-token capacity, explicit output demand, verified route input/output limits, unknown metadata and tool/media estimates are covered. This is not yet native admission.
- Existing AI settings now persist an optional `maxContextTokens` (null by default/reset/legacy) without clamping it to the selected model. The canonical suite uses real Dexie KV; a delayed A-load reproduces a stale setting write crossing into B before origin guards. The later A→B→A review controls below require the actual workspace generation as well. Baselines: `/tmp/task16-compaction-settings-baseline.log`, `/tmp/task16-compaction-settings-race-baseline.log`. Candidate13 tests/two owners passed in `/tmp/task16-compaction-settings-candidate.log`.
- The preference UI and generation capture remain pending until native admission consumes this value. No inactive control is advertised as working.

## Acceptance status

- [ ] Phase A: usage persistence, capacity/preference policy, no implicit trimming,
      final native/server/tool-loop admission, meter and explicit lossy choice.
- [ ] Phase B: typed summary/lineage fields and provider preservation, captured
      membership, atomic fork, readiness guard, same-model summary validation,
      cancellation and card/navigation actions.
- [ ] Phase C: frozen ancestor retrieval, browser tools, canonical SQLite/Convex
      readers, current authorization, runtime selection and reconnect.
- [ ] Phase D: flat lazy family pagination, filters/keyboard/group state and
      central descendant deletion protection.
- [ ] Complete qualification: deterministic production journeys, near-million
      token mocked requests, 10k-thread scale, docs/contracts/types/builds.
- [ ] Three live quality evaluations with two rolling compactions each; these
      require separately authorized paid model traffic and are not run.

No checked box or feature-complete claim substitutes for a real owner boundary
test and a current-head evidence receipt. No extra worker, publication, deployment,
default merge, credentials change or destructive real-user operation is authorized.

## Independent foundation review corrections

- Initial head `c3c075cd` had Core/Contracts success run36979751771; three subsequent source review concerns supersede that readiness.
- Verified selected-route output precedence reproduces an incorrect 4,096-token restriction despite the selected route supporting65,536 and the explicit request needing8,192. Shared admission now uses the verified route output limit; total-window and actual selected output overflow still reject. `/tmp/task16-compaction-review-all-baseline.log`.
- Actual KV timing reproduces lost different-field updates plus stale set/reset overwrites after A→B→A with a reused DB handle. Saves now queue within their captured workspace generation, merge current durable preferences, recheck generation through every mutation await, and use existing KV revision CAS. Separate-handle writes during a delayed save are refused instead of overwritten. All four settings failures reproduced at the pre-fix owner in `/tmp/task16-settings-review-full-baseline.log`. The failure control injects an actual Dexie write failure; throwing in a normal filter is intentionally swallowed by the existing hook engine and is not used as proof.
- Final18 cases/two canonical owners pass in `/tmp/task16-compaction-review-final-focused.log`; production lint exits0 and generated ledger is refreshed. New-head CI/configured local typecheck remain pending.
- Native admission must preserve installed workflow delegation: the workflow plugin runs inside the final before-send filter and depends on durable assistant IDs captured by the preceding send action. Moving that filter ahead of persistence without a compatible delegation boundary would break an existing workflow path. Native admission, usage, UI and full compaction remain unimplemented/unqualified.

- Correction41558342 Core failed; formatted gh logs omitted the result. Original logs/check annotations retained. Authorized failed-job-only rerun attempt2, job110762796348/run36981735409, samehead: fresh raw logs prove5033 tests/635 files PASS and TS2339 only in two actual KV input-hook fixtures at141/211 (unknown value used with includes). `/tmp/task16-pr188-review-ci-attempt2-raw.log`. Narrow string guards preserve both admitted timing cases; no production/gate changes used to obtain green. New exact-head CI still required after this test-only correction.

## Foundation exact-head qualification and lineage milestone

- Typing correction `6145a6f15a771161a9d3e4c551abb66d8619626f` passed Core and Contracts run36985337487; conditional image/tag/smoke jobs skipped. This clears the shared-policy/preferences foundation only, not native compaction. No further415-head rerun is needed.
- Canonical transcript metadata loss reproduced in `/tmp/task16-compaction-metadata-baseline.log`. Versioned summary/history-scope/usage validators and canonical reload now preserve validated host fields and exclude internal scope/fingerprint fields from the actual OpenRouter builder payload (3 transcript cases pass).
- Actual Dexie history baseline `/tmp/task16-compaction-history-baseline.log` has6 intended failures, including missing multi-generation reference context, partial summary wrongly loading and stale same-ID workspace reads. Iterative canonical projection now preserves tool roles, excludes deleted/superseded rows, resolves anchors by ID, stops at a valid compacted summary and rejects missing/cyclic lineage without a numeric depth cutoff.130 generations are covered. Combined history/transcript9 cases pass; missing/cycle assertions also run in the repaired candidate after the long-chain control. Native send/continue admission remains unwired.
- Existing two fork APIs reproduced inherited bogus roots/summary pointers/provenance and a generic compacted-create bypass: `/tmp/task16-compaction-fork-lineage-baseline.log` has3 intended failures/1 migration pass. Both helpers now derive real roots, clear inherited summary pointers and stamp manual/retry provenance; generic overrides/filters/actions cannot bypass the atomic writer. Legacy unanchored branches remain local-only. Additional actual-hook mutations and compacted-boundary upserts bring this owner to6 passes in `/tmp/task16-compaction-fork-guards.log`. Existing fork bulk-write regression remains passing.
- Dexie version21 adds root/family indexes without rewriting legacy rows or emitting startup outbox records. Shared sync wire schema validates optional lineage fields, accepts legacy/partial-delivery rows and preserves JSON round trips. Provider-owned SQLite/Convex schemas and rebuilt source artifacts remain unverified; passthrough is not claimed as provider evidence.
- Narrow lineage/transcript/fork regression14 cases/4 owners pass `/tmp/task16-compaction-lineage-candidate.log`; sync-schema/transcript-repository19 cases/2 owners pass `/tmp/task16-compaction-lineage-sync.log`. Production lint0 errors/warnings `/tmp/task16-compaction-lineage-lint.log`; compatibility ledger/public snapshots refreshed. Full configured types/current-head CI still required for this new milestone. No local heavy lane was held.
- Scope metadata carries only captured IDs/clocks and references inherited scopes. No newly imposed2048-reference or128-link application cap was added: the user's latest hard constraint overrides those stale numerical plan bounds. Actual provider/model capacity and existing256KiB per-record storage admission still apply. Summary capture/revalidation, atomic writer, controller, usage transport/persistence, no-trim native admission, UI/landmarks/retrieval/family/deletion and full provider/browser/quality gates remain open.

- Lineage0f7880ad Core failed run36986857551/job110773748004; Contracts passed. Raw `/tmp/task16-pr188-lineage-core-raw.log` identifies schema-version20 expectations requiring21, two fixture annotation errors and a duplicate parent_thread_id constructor property. Exact narrow corrections preserve all canonical-row/outbox assertions and mutation controls.33 actual DB cases/3 owners (derived indexes, fork lineage and new uncommitted writer) pass `/tmp/task16-compaction-lineage-correction-writer.log`. Writer remains separate implementation work; current-head CI is still required.

## Captured scope, strict summary validation and atomic writer

- New writer owner baseline missing module: `/tmp/task16-compacted-writer-baseline.log`. Actual DB engineering fixtures use existing HookBridge capture and production transaction scopes; initial missing pending_ops/tombstone fixture errors are preserved in first-candidate logs and corrected at the fixture boundary. No inference mock reimplements production persistence.
- Frozen capture records canonical visible input and raw eligible membership separately, references a validated prior scope instead of duplicating old IDs, derives roots through actual parents and rejects unrelated/cyclic inherited scope. Snapshot revalidation detects edits without thread clock changes, insertion/removal, reindexing and source eligibility changes. No long-lived write transaction spans inference.
- Ajv draft-07 strict model schema, real Markdown-section checks, Unicode description limits, trusted landmark derivation/deduplication/discard counts and provider-visible benefit/target checks brand a value for exactly one capture. Whole JSON/prose/extra host fields cannot be salvaged as valid output.64KiB is the specified summary-artifact response budget; existing256KiB complete stored-row admission is enforced without truncating references. Neither is a normal conversation context cap. Actual model-window target calculation/controller integration remains open.
- `createCompactedFork` uses captured originDB, preallocated IDs, current navigation/model guard, one threads/messages/pending_ops transaction, normal clocks/HLC/order keys, inherited project/prompt and reset runtime flags. Actual second-write failure and cancellation during a child write roll back both rows/outbox; same-operation replay returns the committed identity, distinct operations create siblings, and post-commit action failure/cancellation cannot lose a completed child. Branch filter/action preparation runs before the write transaction; changed source/anchor/mode is rejected.
- Pending-tools-after-anchor control reproduced a service miss in `/tmp/task16-compacted-pending-tools-baseline.log`; source-level tool readiness now rejects it. Branch-filter source change was ignored before repair: `/tmp/task16-compacted-hook-filter-baseline.log`. Generic create/fork ID collisions also reproduced actual compacted-boundary overwrites (2 failures `/tmp/task16-compaction-boundary-collision-actual-baseline.log`); both paths now protect existing boundaries.
- Writer/fork final28 focused actual-DB controls pass `/tmp/task16-compacted-writer-hooks-candidate.log`; broader writer/history/transcript/fork36 pass `/tmp/task16-compacted-writer-final-focused.log` before final hook preparation. Production lint0 errors/warnings. The3004-reference storage control proves membership is not cut off at2048 and rejects at the real byte ceiling. Provider wire usage, native send/continue readiness/admission, summary serializer/controller/inference/UI, retrieval/provider/families/deletion and current-head configured gates remain open.
