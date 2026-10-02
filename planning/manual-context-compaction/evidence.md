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
