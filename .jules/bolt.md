# Bolt's Journal ⚡

## 2026-01-11 - Initial Setup
**Learning:** Performance optimization requires precise measurement. I'm starting with optimizations in `convex/sync.ts` and `outbox-manager.ts`.
**Action:** Measure impact using available tests and type checks.

## 2026-01-11 - Batching DB Operations in Convex
**Learning:** Convex operations like `push` that process a batch of items can be significantly optimized by:
1. Parallelizing read-only checks (idempotency).
2. Batching sequence allocation (server versions) instead of sequential increments.
This reduces the number of roundtrips/transactions on the server version counter from N to 1.
**Action:** Always look for opportunities to batch sequence generation and parallelize independent reads.

## 2026-01-11 - Bulk Delete in Dexie
**Learning:** Replacing `Promise.all(ids.map(id => table.delete(id)))` with `table.bulkDelete(ids)` in Dexie reduces IndexedDB transaction overhead significantly for large batches.
**Action:** Prefer bulk operations (`bulkPut`, `bulkDelete`, `bulkGet`) over looped single operations in Dexie.
