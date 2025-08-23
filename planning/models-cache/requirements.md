# requirements.md

artifact_id: 7e0e1d5a-5a39-4a37-9f6b-0e5f2c8e9c56

## 1. Introduction

A 48-hour client-side cache layer for the OpenRouter models catalog will reduce network latency, bandwidth, and repeated parsing overhead. The feature introduces a simple, performant caching strategy using in-memory state, IndexedDB (Dexie), and an existing server-side KV helper (optional / deferred) while maintaining force-refresh and invalidation semantics. Scope: augment `useModelStore` with caching; do not alter backend APIs.

## 2. User Roles

-   End User (Chat App User)
-   Developer (Maintainer / Debugger)

## 3. Functional Requirements

### 3.1 Fetch Models With Multi-Tier Cache

As an end user, I want the app to load the models list quickly on repeated visits within 48 hours so that my experience feels instant.
Acceptance Criteria:

-   WHEN `fetchModels` is called AND a fresh (<48h) in-memory catalog exists AND no force flag is set THEN it SHALL return the cached list without Dexie or network access.
-   WHEN in-memory cache is absent or stale AND a fresh Dexie record exists THEN the function SHALL hydrate state from Dexie and avoid a network request.
-   WHEN both in-memory and Dexie caches are stale or missing THEN the function SHALL perform a network fetch, update state, and persist to Dexie.
-   WHEN `opts.force` is true THEN the function SHALL bypass all caches and perform a network fetch.

### 3.2 48-Hour Time-To-Live (TTL)

As a developer, I want a consistent TTL applied so that stale data does not persist indefinitely.
Acceptance Criteria:

-   IF a cached record `updatedAt` is >= 48h old THEN it SHALL be considered stale and ignored for fast-path returns.
-   TTL SHALL be overrideable per call via `opts.ttlMs`.

### 3.3 In-Flight Request Deduplication

As an end user, I want concurrent requests not to trigger duplicate network calls so that performance is optimized.
Acceptance Criteria:

-   IF a network fetch for models is already in progress AND another call arrives without `force` THEN it SHALL await the existing promise.
-   IF `force` is set on the second call THEN it SHALL initiate a new fetch independent of the in-flight one.

### 3.4 Manual Invalidation

As a developer, I want to manually invalidate the cache so that debugging and refresh scenarios are easy.
Acceptance Criteria:

-   WHEN `invalidate()` is called THEN it SHALL clear in-memory catalog and remove the Dexie record.
-   AFTER invalidation, the next `fetchModels` call SHALL perform a network fetch (unless force override rules apply differently).

### 3.5 Graceful Degradation (SSR / Unsupported Storage)

As a developer, I want the system to work in SSR or restricted environments so that no runtime errors occur.
Acceptance Criteria:

-   IF IndexedDB/Dexie is unavailable (e.g., SSR) THEN the function SHALL skip Dexie operations and rely on memory + network only.
-   No unhandled exception SHALL be thrown due to Dexie absence.

### 3.6 Corruption Handling

As a developer, I want resilience to corrupt stored JSON so the app remains functional.
Acceptance Criteria:

-   IF the stored value cannot be parsed THEN the record SHALL be deleted and a network fetch performed.
-   Corruption SHALL be logged with a warning (not an error crash).

### 3.7 Stale Fallback on Network Failure

As an end user, I prefer some data over none if the network is down.
Acceptance Criteria:

-   IF network fetch fails AND a stale (>=TTL) cache exists THEN the function SHALL return the stale list with a warning.
-   IF network fetch fails AND no stale cache exists THEN the function SHALL propagate an error.

### 3.8 Optional Server KV Warm Start (Deferred)

As a developer, I may want a cross-device warm start later.
Acceptance Criteria:

-   The design SHALL allow adding a server KV layer later without refactoring the core caching logic.
-   This requirement is Deferred (not implemented in this iteration).

### 3.9 Metrics Hooks (Deferred)

As a developer, I want to know cache hit sources later.
Acceptance Criteria:

-   Code SHALL isolate decision points for future lightweight logging.
-   Deferred.

### 3.10 Explicit Fresh Override Helper

As a developer or power user, I want a simple helper to bypass caches without remembering option flags so that I can always fetch the latest catalog on demand.
Acceptance Criteria:

-   WHEN `refreshModels()` is invoked THEN it SHALL perform the equivalent of `fetchModels({ force: true })` and always hit the network (barring network failure fallback rules).
-   WHEN `refreshModels()` finishes successfully THEN in-memory and Dexie caches SHALL be updated with the new list and timestamp.
-   IF the network fetch fails AND a stale cache exists THEN it SHALL return the stale cache with a warning; otherwise propagate the error (same behavior as forced fetchModels).

## 4. Non-Functional Requirements

-   Performance: Returning from memory should be O(1) and under 1ms JS time; IndexedDB access limited to a single `get` per cold load.
-   Simplicity: Additional code limited (~<70 LOC net additions across new Dexie file + composable changes).
-   Maintainability: Clear constants for keys and TTL; no deep abstractions.
-   Safety: All storage interactions wrapped in try/catch.
-   Type Safety: Strong typing of cache record shape.

## 5. Constraints & Assumptions

-   Tech: Nuxt 3 + TypeScript + Bun environment.
-   Dexie available only client-side; guarded by `process.client` or `typeof indexedDB` checks.
-   Network fetch function `modelsService.fetchModels` remains unchanged.
-   No schema migrations required beyond initial version (v1) with single KV table.

## 6. Out of Scope

-   Multi-tenant separation of model catalogs.
-   Partial diff updates.
-   Background stale-while-revalidate refresh.
-   Analytics & metrics (deferred).

## 7. Open Questions (None Blocking)

-   Should stale fallback trigger silent background refresh? (Deferred)
-   Should we persist favorites alongside catalog in Dexie? (Currently separate via existing kv helper.)

## 8. Acceptance Test Scenarios Summary

1. Fresh load -> network -> Dexie populated.
2. Second call same session -> memory hit (no Dexie read).
3. New tab within 48h -> Dexie hit (no network).
4. Expired cache -> network refresh.
5. Force fetch -> bypass caches.
6. Corrupt Dexie record -> network fetch + record replaced.
7. Network down + stale present -> stale returned with warning.
8. Network down + no cache -> error thrown.

## 9. Glossary

-   Fresh: Cache age < TTL.
-   Stale: Cache age >= TTL.
-   In-flight: Currently executing network fetch promise.
