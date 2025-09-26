# Design: Images Grid Performance & Cleanup

artifact_id: a247d4f0-9964-4a1f-a34d-b4b23aa6c58d

## Overview

The dashboard images experience must revoke stale preview URLs promptly, throttle IntersectionObserver (IO) churn, and simplify the images page module without changing user-facing workflows. The update keeps the Vue/Nuxt stack intact while introducing a lightweight cache manager and scheduler inside `GalleryGrid.vue`. No backend changes are required. The plan preserves existing event contracts (`view`, `download`, `copy`, etc.) while reducing memory pressure and improving responsiveness when rendering large galleries.

## Architecture

### Component Interaction

```mermaid
flowchart TD
    ImagesPage[pages/images/index.vue]
    Grid[GalleryGrid.vue]
    UrlCache[PreviewUrlCache]
    IOSched[IntersectionScheduler]
    FileStore[(IndexedDB / FileStore)]

    ImagesPage -->|props.items| Grid
    Grid -->|ensureUrl(meta)| UrlCache
    UrlCache -->|create/revoke| BrowserAPI[URL.createObjectURL]
    Grid -->|scheduleObserve()| IOSched
    IOSched -->|bind tiles| IntersectionObserver
    Grid -->|events| ImagesPage
    Grid -->|getFileBlob| FileStore
```

### Components & Responsibilities

-   **GalleryGrid.vue (updated)**

    -   Maintains a reactive `Map` of active preview URLs keyed by hash.
    -   Watches `props.items` for diffing; revokes URLs for hashes no longer present before re-scheduling IO observers.
    -   Delegates observer rebinding to a micro-throttled scheduler.
    -   Exposes `ensureUrl` to parent consumers (existing API preserved).

-   **PreviewUrlCache (new local utility)**

    -   Wraps `Map<string, string>` to centralize create/revoke logic.
    -   Guarantees idempotent revocation (swallows double-revoke errors) and reports failures via `reportError`.
    -   Optionally records timestamps for debugging; no persistence is required.

-   **IntersectionScheduler (new local utility)**

    -   Provides `schedule(callback)` that coalesces rapid calls using `requestIdleCallback` when available, otherwise falls back to `setTimeout(..., 0)`.
    -   Cancels pending jobs if a fresh schedule request arrives before execution.
    -   Executes observer binding within the scheduler to ensure one rebind per burst.

-   **pages/images/index.vue (cleanup)**
    -   Removes unused imports/local variables.
    -   Reuses existing computed flags (`isMutating`, `isSoftDeleting`, etc.) to avoid duplicated boolean calculations in the template or methods.
    -   Keeps type unions near usage for clarity.

## Data Models & Types

```ts
type PreviewUrlCacheEntry = {
    url: string;
    createdAt: number;
};

type PreviewUrlCache = Map<string, PreviewUrlCacheEntry>;

interface PreviewUrlManager {
    has(hash: string): boolean;
    get(hash: string): string | undefined;
    ensure(meta: FileMeta): Promise<void>;
    revoke(hash: string): void;
    revokeMissing(hashes: Set<string>): void;
    revokeAll(): void;
}

type IdleRequestHandle = number;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface IntersectionScheduler {
    schedule(job: () => void): void;
    cancel(): void;
}
```

Implementation will reside inside `GalleryGrid.vue` (or a colocated helper file) to avoid increasing bundle size with global singletons.

## Key Algorithms

1. **Prop Diff & URL Revocation**

    - Compute `nextHashes = new Set(props.items.map((i) => i.hash))`.
    - Derive `stale = cachedHashes \cap complement(nextHashes)`.
    - `stale.forEach(cache.revoke)` prior to observer rebind.
    - If `props.items` length is zero, call `cache.revokeAll()`.

2. **Throttled Observer Binding**

    - Expose `scheduleObserve()` that calls `scheduler.schedule(bindTiles)`.
    - `bindTiles` disconnects existing IO, instantiates a new observer, and attaches to `[data-hash]` elements in the next frame (`requestAnimationFrame`).
    - Scheduler uses `requestIdleCallback` when available to avoid main-thread contention; fallback is `setTimeout`.

3. **Cleanup on Unmount**
    - `onBeforeUnmount` triggers `scheduler.cancel()`, disconnects IO, and calls `cache.revokeAll()`.

## Error Handling

-   Wrap URL revocation in try/catch; ignore `DOMException: Failed to execute 'revokeObjectURL'` when the URL is already revoked.
-   Continue to rely on `reportError` for blob loading failures, adding new `tags` (`stage: 'revoke' | 'schedule'`).
-   Scheduler fallbacks avoid throwing when APIs are missing; type guards ensure availability at runtime.

## Testing Strategy

-   **Unit Tests (`GalleryGrid.spec.ts`)**

    -   Mock `URL.createObjectURL`/`revokeObjectURL` to assert revocation on prop diffs and component unmount.
    -   Simulate rapid `items` updates and assert scheduler executes observer binding once per batch.

-   **Component Tests (Vitest + Vue Test Utils)**

    -   Mount `GalleryGrid` with fake `FileMeta`s; spy on `ensureUrl` to verify lazy loading only happens when entries intersect.
    -   Verify selection mode interactions still emit events correctly after refactor.

-   **Integration Smoke (pages/images/index.vue)**

    -   Ensure imports tree-shake correctly by running the lint task (ESLint) and a minimal end-to-end path that loads the images page.

-   **Performance Profiling (Optional)**
    -   Capture browser performance recording before vs. after to confirm reduced JS heap growth over large scroll sessions.

## Rollout & Monitoring

-   Ship behind existing UI without feature flags; regressions would surface via QA smoke tests.
-   Add a devtools console message (once) when revoking more than 500 URLs in a session to aid debugging (optional, controlled via `process.dev`).
-   Document the 50 ms throttle assumption in code comments and README snippet for future tuning.
