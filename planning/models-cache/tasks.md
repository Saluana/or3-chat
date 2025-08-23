# tasks.md

artifact_id: b7d86d7a-8e75-4ded-9dbe-37f5b9c73976

## LLMS (IMPORTANT!!)

All dexie related stuff is in app/db/\* if you need to know how the db works please check it out.

refer to the requirements and design docs for more details /planning/models-cacher/design.md, /planning/models-cacher/requirements.md

You should refer to the docs everytime you start a new task.

also it's very important you cross off the tasks as you go.

## 2. Extend useModelStore

-   [x] 2.1 Define constants `MODELS_CACHE_KEY`, `MODELS_TTL_MS`. (Req: 3.2)
-   [x] 2.2 Add reactive `lastLoadedAt` ref. (Req: 3.1)
-   [x] 2.3 Add module-level `inFlight` promise var. (Req: 3.3)
-   [x] 2.4 Implement `isFresh(ts, ttl)`. (Req: 3.2)
-   [x] 2.5 Implement `loadFromDexie(ttl)` with freshness check + hydration. (Req: 3.1, 3.5)
-   [x] 2.6 Implement `saveToDexie(list)` with try/catch. (Req: 3.1, 3.6)
-   [x] 2.7 Implement `invalidate()` clearing memory + deleting Dexie record. (Req: 3.4)
-   [x] 2.8 Update `fetchModels` to apply decision tree (memory → Dexie → network) + force + dedupe. (Req: 3.1, 3.3, 3.2)
-   [x] 2.9 Add stale fallback on network failure logic. (Req: 3.7)
-   [x] 2.10 Export new functions (`invalidate`) from composable return. (Req: 3.4)
-   [x] 2.11 Implement `refreshModels()` wrapper calling `fetchModels({ force: true })`. (Req: 3.10)
-   [x] 2.12 Export `refreshModels` from composable. (Req: 3.10)

## 3. Error & Corruption Handling

-   [x] 3.1 Wrap Dexie ops in try/catch with `[models-cache]` prefix logs. (Req: 3.6)
-   [x] 3.2 On JSON parse error, delete bad record (best-effort) and continue. (Req: 3.6)

## 4. SSR / Environment Guards

-   [x] 4.1 Guard Dexie usage with `canUseDexie()`. (Req: 3.5)
-   [x] 4.2 Ensure no import-time IndexedDB access that breaks SSR. (Req: 3.5)

## 5. Testing / Verification

-   [ ] 5.1 Add unit-style test harness or manual script (if test infra exists) for memory hit. (Req: 3.1)
-   [ ] 5.2 Test Dexie cold start hydration (manual in browser). (Req: 3.1)
-   [ ] 5.3 Simulate stale by editing `updatedAt` to older than TTL. (Req: 3.2)
-   [ ] 5.4 Verify in-flight dedupe with parallel Promise.all calls. (Req: 3.3)
-   [ ] 5.5 Force fetch bypass check. (Req: 3.1, 3.3)
-   [ ] 5.6 Corruption handling: manually set invalid JSON and fetch. (Req: 3.6)
-   [ ] 5.7 Offline mode stale fallback test (devtools offline). (Req: 3.7)

## 6. Documentation

-   [ ] 6.1 Update README or add short note in `docs/` describing cache behavior + invalidate usage. (Req: 3.1, 3.4)

## 7. Deferred / Future (Not in this iteration)

-   [ ] 7.1 Server KV warm start layer. (Req: 3.8 - Deferred)
-   [ ] 7.2 Metrics instrumentation for cache hits. (Req: 3.9 - Deferred)
-   [ ] 7.3 Stale-while-revalidate background refresh. (Out of scope)

## Requirement Mapping Summary

-   Req 3.1: Tasks 1.2, 2.5, 2.6, 2.8, 5.\*
-   Req 3.2: Tasks 2.1, 2.4, 5.3
-   Req 3.3: Tasks 2.3, 2.8, 5.4, 5.5
-   Req 3.4: Tasks 2.7, 2.10, 6.1
-   Req 3.5: Tasks 1.3, 2.5, 4.1, 4.2
-   Req 3.6: Tasks 2.6, 3.1, 3.2, 5.6
-   Req 3.7: Tasks 2.9, 5.7
-   Req 3.8: Tasks 7.1
-   Req 3.9: Tasks 7.2
-   Req 3.10: Tasks 2.11, 2.12
