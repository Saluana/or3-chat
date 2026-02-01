# Review findings (sync conflicts)

## Issue: Conflict resolver flags ties even when payloads are identical

**Snippet** (from app/core/sync/conflict-resolver.ts):

```ts
} else if (remoteClock === localClock) {
    // Tie-break with HLC
    const localHlc = local.hlc ?? '';
    if (compareHLC(stamp.hlc, localHlc) > 0) {
        await table.put(remotePayload);
        // ...
        conflicts.push({ tableName, pk, local, remote: payload, winner: 'remote' });
        return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
    }
    conflicts.push({ tableName, pk, local, remote: payload, winner: 'local' });
    return { applied: false, skipped: true, isConflict: true, winner: 'local' };
}
```

**Why this is bad:** `remoteClock === localClock` is treated as a conflict without checking if the payload is effectively identical. That turns benign replays or echo changes into “conflicts,” which contaminates telemetry and spam-notifies users.

**Real-world consequence:** Users get conflict notifications even when nothing meaningful happened, and the system becomes noisy and harder to trust.

**Suggestion:** Short‑circuit if the normalized payload matches the local record (or if a stable hash matches). Only emit a conflict when there is a real divergence.

---

## Issue: Conflict notification dedupe maps grow without bounds

**Snippet** (from app/plugins/notification-listeners.client.ts):

```ts
const conflictDedupe = new Map<string, number>();
const errorDedupe = new Map<string, number>();
const streamDedupe = new Map<string, number>();
const DEDUPE_WINDOW_MS = 15_000;
```

**Why this is bad:** The maps are only ever added to; there is no pruning. In a long‑running session this is unbounded growth.

**Real-world consequence:** Memory growth over time and slower lookups due to oversized maps, especially if sync is chatty.

**Suggestion:** Periodically prune entries older than the dedupe window (or cap size and evict LRU). A simple prune on insert is enough.

---

## Issue: Notification clocks use second resolution

**Snippet** (from app/core/notifications/notification-service.ts):

```ts
const now = nowSec();
const notification: Notification = {
    // ...
    created_at: now,
    updated_at: now,
    clock: now,
};
```

**Why this is bad:** `nowSec()` only changes once per second. Multiple updates in the same second get identical clocks, which increases tie‑break paths in LWW and makes conflicts more likely.

**Real-world consequence:** Increased conflict rate under normal user actions (rapid read/clear sequences), with unnecessary conflict logging or notifications.

**Suggestion:** Use a higher‑resolution clock for `clock` (e.g., milliseconds) or store an HLC on writes to avoid ties.
