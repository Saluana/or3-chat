# Compaction review repairs and final local qualification

Updated2026-10-03 UTC. **47 tasks complete,7 partial,1 not started;55 total.** All locally feasible repairs and owning-boundary matrices are complete. This is a candidate for final parent review, not all55 acceptance or a release claim. All79 exact criteria remain in [ACCEPTANCE_LEDGER.md](./ACCEPTANCE_LEDGER.md); [tasks.md](./tasks.md) retains IDs/order/Done-when wording. Earlier receipts remain in [evidence.md](./evidence.md), Git history and `task3/output/compaction-review/previous-qualification-packet-31b1e6b3.md`.

## Exact source and isolation

Tested runtime **c5ab90d4d34453e83db2084b6e0e1df048d54659**, branch feat/manual-context-compaction, succeeds reviewed candidate31b1e6b3. Private SQLite **1bdf11395ecf179e6d71fb3ccc8d6cee0ef6072d** adds qualification to production642612a; Convex **83583de704991e49067149c4bc016c5eb48463c3** adds qualification to production31940bd. Workflows **802cca1fc06b20638bb14c624d4b4ce024cd21d0** is separately built/qualified, not installed or published.

Only private task3 source and disposable fixtures changed. Main dirty product checkout, old task16 and other workers' previews stayed untouched. Installed node_modules implementations were never edited. Checks used one sequential heavy lane; no source/test/config edits occurred during runners. Owned3211/25211 ports are free afterward. Brendon removed intermediate phase gates; final parent review remains. No merge, publication, deployment, live/paid inference, credential/access change or destructive real-data operation occurred.

## Parent findings F1–F5

| Finding | Repair and owning evidence |
| --- | --- |
|F1 recursive Retry|Local turn selection now excludes only selected owned IDs from full canonical recursive history. Native send re-resolves/validates before writes; rejected Retry restores inherited UI. Actual reference-descendant Send/Retry/Continue, accepted foreground tool loop and background Send/Retry/Continue bodies retain inherited summary/later parent, exclude raw originals.|
|F2 background recovery|HTTP normalization retains structured code/nonretryability. Pre-job rejection saves literal context_full, checkpoint/real IDs and separate human text; accepted jobs stay excluded from initial replay. Reload/larger-model recovery preserves IDs/body/filter-once and clears checkpoint.|
|F3 route/cancel|Composer/model watcher and Send propagate effective concrete Nitro/Floor identity. Actual Settings bodies and variant-only held-readable-SSE cancellation prove prompt abort, no late child and retained draft. Prior30s-timeout “green” remains explicitly insufficient cancellation evidence.|
|F4 historical media|Shared metadata-only selection marks inherited/stored replayed raster/remote/inline image costs unknown without hydration. Actual ancestor-image/text-only draft and real file chooser/removal pass. Prompt revision and deep attachment/configuration invalidation were also repaired.|
|F5 ordering|Lookup target/neighbors expose actual finite index/string order_key and truthful legacy absence within existing output caps. Registered server/browser cases reindex37/order37:reindexed and pass.|

These findings are repaired locally, pending final parent acceptance. Original report: `/Users/brendon/Documents/Codex/2026-10-03/task/output/compaction-final-candidate-review.md`.

Same-model follow-up: documented unresolved Auto/Free/Pareto/Fusion/Jev/Switchyard/BodyBuilder/latest aliases reject before inference/fork/outbox and recover on explicit concrete model selection. Concrete Nitro/Floor remains valid. Public docs link primary OpenRouter definitions; arbitrary future custom routers are not claimed universally discoverable.

## Current gates

Log basenames are copied under `task3/output/compaction-review/logs/`; originals are `/tmp/<basename>`.

| Gate | Result / receipt |
| --- | --- |
|Changed host|532 pass/38 files,1 separately qualified opt-in Workflows case skipped,8.38s; task3-compaction-final-review-changed.log. No broad full suite.|
|Configured types|Normal BasicAuth/SQLite/fs wrapper passes; task3-compaction-final-review-types.log.|
|Strict changed production TS|max-warnings=0 passes; task3-compaction-final-review-lint.log. Vue is qualified by types/browser, not claimed linted by this command.|
|Compatibility/public contracts|39 modules/596 exports/273 callables/309 auto-imports; task3-compaction-final-review-compat.log and task3-compaction-final-review-contracts.log. Ledger source positions refreshed; public snapshots unchanged. Existing five provider contracts remain verified by task3-compaction-final-provider-contracts.log.|
|Static/SSR wrappers|Both complete with built-in/V1/client-server bundle checks; task3-compaction-final-review-static.log and task3-compaction-final-review-ssr.log.|
|Browser|**7/7,64.934s,workers1/retries0,0 flaky/skipped**, fixturev6; task3-compaction-final-review-browser.log and .qualification/review-complete-candidate.|
|SQLite current owner|**76/76**, actual normal-built DB/adapter/migrations/current host; task3-compaction-sqlite-owner-final-second.log.|
|Convex current owner|**54/54**, actual built gateway/fresh generated scaffold with storage scripted; task3-compaction-convex-owner-final.log.|
|Provider source types|Both normal standalone commands pass; task3-compaction-{sqlite,convex}-standalone-final.log.|
|Provider owner/current-host types|SQLite task3-compaction-sqlite-current-host-types-second.log; Convex task3-compaction-convex-current-host-types-fourth.log pass under actual Nuxt Vue and SDK declarations.|
|Workflows source integration|1 pass/29 unrelated skipped,1.20s; task3-compaction-workflow-host-built-third.log; actual802cca source-built send-hooks entry and private vitest.workflows-host.config.ts.|
|Historical negative control|Expected genuine assertion RED: task3-compaction-historical-continuation-first.log. Byte-identical pre-feature9191c3c0 continue.ts loses inherited summary at actual native body. Current extended matrix1 pass/32 unrelated skipped: task3-compaction-reference-body-matrix-first.log. Isolated historical production-boundary proof, not an entire old-host browser rebuild.|

Static/SSR uses unchanged installed provider predecessors, establishing backward-compatible host builds. Private readers are separately qualified through normal-built artifacts. Existing unrelated prerender IndexedDB/catalog and trusted-host ModuleV2Loader ABI rebuild-required warnings remain recorded; no deployed readiness is implied.

## Distinct local closures

- Measured estimator: matching prefix/suffix and whole-body lower bound; stale text/route/tools/reasoning/missing/zero baseline; hydrated-image invalidation/unknown costs. Native owners retain600k/3.8M-byte untrimmed transport under1M capacity with valid per-row sizes.
- Attachment/background recovery: real file hydration, rejection/reload and same IDs/body. Confirmed native lossy tool loop executes accepted oversized result once and blocks before second inference with no extra omissions/replay/checkpoint leak.
- Actual separately owned Workflows registration/controller plus host hooks/Dexie: unavailable pure prepare has zero writes/inference; real-ID commit once, scripted background start once, no native fallthrough. Only external service/catalog/credential UI is scripted. Publication/adoption remains separate.
- Actual H3 readiness/session/can/registry/job creation:401/no queries, ready/no-store/no content/job, absent capability, partial summary, fresh revocation. Actual native core registration freezes hybrid/client/foreground placement; later gaps fail explicitly.
- Actual SQLite local→canonical→second Dexie client: atomic summary/lineage, partial pair rejection, usage finalization/pull, DB reopen, bounded authoritative snapshot/purge recovery. Source originals remain; receiving disposable client loses purged originals but retains usable summary/new turns. No real data touched.
- Actual rebuilt selected Convex gateway→JSON service→fresh generated indexed internal handler and current host scope/registry: missing capability/summary, sibling denial, revocation, later gaps. Scripted storage is not deployed validators/transaction isolation/token verification.
- Actual family group/menu targets distinguish newest activity from creation-ordered latest compaction after reload/filter. Central deletion owner covers checkpoint clearing, hook rollback and preference retention until final member retirement.
- Generator24-case matrix covers real corrective transport, refusal/rolling/budget/schema/tool/media; at most one correction, no third request/partial child. Forced SSR client success/correction/denial/abort is separate from existing actual SSR auth/key/capacity owner; no deployed authenticated round trip is claimed.

Final browser bodies/assertions are embedded in the report and extracted into portable JSON. Six unique current runtime PNGs were opened/inspected; original16 light/dark/mobile Library receipts remain unchanged. Dev-only fixture controls/Nuxt toolbar are instrumentation, not shipped UI.

Scale: exact10,000 threads/500 families/one200-member family, independent50-member pages and distinct50→100 top-level rows. Seven grouping/three member samples yield nearest-rank p95=max **18.1ms/47.0ms**, zero sidebar message reads. Small local Chromium1280×720/Mac sample, not universal/deployed latency. Prior19.6/53.2 and earlier shapes retain their actual identities.

## Retained failures and limits

First product failures remain: F1 task3-compaction-review-f1-regression.log; F2 task3-compaction-review-f1-f2-first.log/task3-compaction-review-native-first.log; F3 task3-compaction-review-f3-first.log; F4 review-f3-f4-first archive; F5 task3-compaction-review-f5-first.log; stale attachment local-ui-first; saved prompt local-ui-second; unresolved router task3-compaction-router-first.log. Current passes do not overwrite them.

Setup failures remain: Blob/tool-event annotations, stale generated Convex history reference, Workflows import resolution and incorrect delegated-native-budget expectation, incomplete SQLite usage envelope/schema, mixed old/new registry blocked reconciliation, missing Nuxt/SDK type declarations, duplicate Vitest option and stale ledger positions. SQLite normal pinned-host type-check still has old canonical-reader alias/pre-existing job-test errors; it is **not** relabeled green. Standalone source and current-host owner types are distinct passing gates. Repairs use actual production boundaries, no replacement-policy fixtures or new unit suites.

## Exact remaining criteria

| Tasks | Remaining blocker |
| --- | --- |
|2.5b,3.3,6.2,6.5|Compatible provider publication/pins and authorized selected backend/deployed Convex validators/transactions/token-service/second-client/background-retrieval reconnect. Release/deployment/access changes are outside authorization.|
|2.8|Installed legacy side-effecting filters require compatible adoption of the separately qualified pure Workflows prepare/real-ID commit package for universal zero-write final-payload admission. Do not move/repeat final filters or invent temporary durable IDs. Publication/adoption needs separate ownership/approval.|
|2.7a|Concrete variant/catalog/cache facts pass. Nitro/Floor choose provider pools without pinning an endpoint; independently guaranteed endpoint constraints require a product decision about explicit endpoint selection/pinning. No guessed quota/minimum cap is introduced.|
|5.5|Original required failure-fixture-before-provider-implementation chronology was not established. Current conformance/readiness passes cannot restore chronology; parent must disposition this provenance criterion. Acceptance wording stays unchanged.|
|8.3|Three manual tool-heavy/discussion/mixed quality scorecards, two rolling compactions each, require separately approved live model traffic. No factual-quality pass is fabricated from scripted responses.|

Read-only remote: or3-cloud **a13116e28bd1327eb7e1393b831a791f5eba0310** is an ancestor. PR188 remains OPEN/DRAFT at **0c64775204752837db6e9d7694fe3c88e22c74f5**, reviewed integration base **883358517ae4a8df4a20c7d06c6a9c3fffcbf8c5**. Current candidate Actions lookup returns no runs (connector returns first-page PR-triggered runs only); old successful Checks37024773124 is not attributed to this candidate.

Push/PR writes remain held after an earlier automatic approval rejection. Exact rejected call/reason transcript is unavailable here; no same-call or alternate-route retry occurred. Parent coordination needs that record before a permitted retry. This hold blocked no local repair above.

Rollback is a revert of coherent local host/provider commits; no deployment/package/pin changed. Portable bundle/patches/configuration/receipt hashes and checkpoint are in task3/output/compaction-review. Final parent review is the next handoff boundary.
