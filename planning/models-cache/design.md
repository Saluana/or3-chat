# design.md

artifact_id: 3a7b9344-4b5f-47d1-8a92-552af0f99390

## Overview

Implement a lightweight 48h TTL caching layer for the OpenRouter models catalog in `useModelStore`. The solution uses a three-tier strategy:

1. In-memory reactive state (fastest, per-session)
2. Client-side persistent storage via Dexie (IndexedDB) for cross-tab / restart reuse
3. Network fetch via existing `modelsService.fetchModels`

Force refresh and manual invalidation are supported. The design keeps complexity low while enabling future extension (optional server KV warm start, metrics, stale-while-revalidate) without refactors.

## High-Level Flow

```mermaid
flowchart TD
  A[fetchModels(opts)] --> B{Force?}
  B -- yes --> N[Network Fetch]
  B -- no --> C{Memory Fresh?}
  C -- yes --> R1[Return Memory]
  C -- no --> D{Dexie Available?}
  D -- no --> N
  D -- yes --> E[Read Dexie Record]
  E --> F{Dexie Fresh?}
  F -- yes --> M1[Hydrate Memory]\nReturn
  F -- no --> N
  N --> G{Success?}
  G -- yes --> H[Update Memory + Save Dexie + Set timestamps]
  H --> R2[Return List]
  G -- no --> I{Stale Present?}
  I -- yes --> W[Warn + Return Stale]
  I -- no --> X[Throw Error]
```

## Components

-   `useModelStore` (updated) – orchestrates cache logic.
-   `dexie.ts` (new) – provides a minimal Dexie client with a generic `kv` table.
-   `modelsService` (existing) – unchanged network source of truth.

## Constants & Keys

```ts
export const MODELS_CACHE_KEY = 'MODELS_CATALOG';
export const MODELS_TTL_MS = 48 * 60 * 60 * 1000; // 48h
```

## Data Structures

```ts
export interface ModelsCacheRecord {
    key: string; // 'MODELS_CATALOG'
    value: string; // JSON.stringify(OpenRouterModel[])
    updatedAt: number; // epoch ms
}
```

Dexie schema (v1):

```
kv: 'key,updatedAt'
```

Primary key: `key` (string).

## Interfaces & Functions (Composable Additions)

```ts
// In useModelStore scope
const catalog = ref<OpenRouterModel[]>([]);
const lastLoadedAt = ref<number | undefined>();
let inFlight: Promise<OpenRouterModel[]> | null = null;

function isFresh(ts: number, ttl: number) {
    return Date.now() - ts < ttl;
}

async function loadFromDexie(ttl: number): Promise<OpenRouterModel[] | null> {
    if (!canUseDexie()) return null;
    try {
        const rec = (await dexie.kv.get(MODELS_CACHE_KEY)) as
            | ModelsCacheRecord
            | undefined;
        if (!rec) return null;
        if (!isFresh(rec.updatedAt, ttl)) return null; // stale
        const parsed = JSON.parse(rec.value);
        if (!Array.isArray(parsed)) return null;
        catalog.value = parsed;
        lastLoadedAt.value = rec.updatedAt;
        return parsed;
    } catch (e) {
        console.warn('[models-cache] Dexie load failed', e);
        return null;
    }
}

async function saveToDexie(list: OpenRouterModel[]) {
    if (!canUseDexie()) return;
    try {
        const rec: ModelsCacheRecord = {
            key: MODELS_CACHE_KEY,
            value: JSON.stringify(list),
            updatedAt: Date.now(),
        };
        await dexie.kv.put(rec);
    } catch (e) {
        console.warn('[models-cache] Dexie save failed', e);
    }
}

async function invalidate() {
    catalog.value = [];
    lastLoadedAt.value = undefined;
    if (canUseDexie()) {
        try {
            await dexie.kv.delete(MODELS_CACHE_KEY);
        } catch {}
    }
}

async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
    const ttl = opts?.ttlMs ?? MODELS_TTL_MS;
    if (
        !opts?.force &&
        catalog.value.length &&
        lastLoadedAt.value &&
        isFresh(lastLoadedAt.value, ttl)
    ) {
        return catalog.value; // memory hit
    }
    if (!opts?.force) {
        const dexieHit = await loadFromDexie(ttl);
        if (dexieHit) return dexieHit;
    }
    if (inFlight && !opts?.force) return inFlight; // dedupe
    const fetchPromise = (async () => {
        try {
            const list = await modelsService.fetchModels(opts);
            catalog.value = list;
            lastLoadedAt.value = Date.now();
            saveToDexie(list); // fire & forget
            return list;
        } catch (err) {
            // stale fallback
            if (canUseDexie()) {
                try {
                    const rec = (await dexie.kv.get(MODELS_CACHE_KEY)) as
                        | ModelsCacheRecord
                        | undefined;
                    if (rec) {
                        const parsed = JSON.parse(rec.value);
                        if (Array.isArray(parsed)) {
                            console.warn(
                                '[models-cache] network failed; serving stale'
                            );
                            return parsed; // stale acceptable
                        }
                    }
                } catch {}
            }
            throw err;
        }
    })();
    if (!opts?.force)
        inFlight = fetchPromise.finally(() => {
            inFlight = null;
        });
    return fetchPromise;
}

// Explicit convenience wrapper for always-fresh fetch
async function refreshModels() {
    return fetchModels({ force: true });
}
```

## Dexie Initialization

```ts
// app/db/dexie.ts
import Dexie from 'dexie';
import type { ModelsCacheRecord } from '~/composables/useModelStore'; // (or duplicate lightweight interface to avoid circular dep)

class Or3ClientDB extends Dexie {
    kv!: Dexie.Table<ModelsCacheRecord, string>;
    constructor() {
        super('or3_client');
        this.version(1).stores({
            kv: 'key,updatedAt',
        });
    }
}
export const dexie = new Or3ClientDB();
export function canUseDexie() {
    return typeof indexedDB !== 'undefined';
}
```

(If importing from composable causes circular reference, define `ModelsCacheRecord` locally in this file and export it.)

## Error Handling Strategy

-   Wrap all Dexie operations in try/catch; log warnings with `[models-cache]` prefix.
-   JSON parse failures result in ignoring the record (and optional deletion for cleanup).
-   Network failures attempt stale fallback; otherwise rethrow for UI to handle.

## Testing Strategy

1. Unit (Composable): Mock Dexie + modelsService; test decision branches (memory hit, dexie hit, stale -> network, stale fallback).
2. Integration (Browser): Launch app, open devtools network offline, verify stale fallback.
3. Concurrency: Fire multiple parallel fetch calls; assert single network request (spy).
4. Expiry: Manually manipulate `updatedAt` to simulate stale state.
5. Force: Use `fetchModels({ force: true })` to confirm bypass.

## Performance Considerations

-   Single Dexie `get` per cold start; no iterative writes.
-   JSON parse/stringify only on transitions; memory reuse via direct assignment.
-   Deduplicated network fetch reduces burst load.

## Security & Privacy

-   Only public model metadata cached; no sensitive user tokens.
-   Data stored client-side only; removal via `invalidate()`.

## Extensibility Hooks

-   Insert metrics counters around cache decision branches (future).
-   Add optional server KV warm start by inserting a pre-Dexie step without altering existing order.

## Deferred Items

-   Server KV warm start
-   Metrics / logging instrumentation beyond warnings
-   Background refresh (stale-while-revalidate)

## Summary

The design delivers a minimal, robust 48h cache with clear layering, safe fallbacks, and future-proof extension points while keeping code changes concise and localized.
