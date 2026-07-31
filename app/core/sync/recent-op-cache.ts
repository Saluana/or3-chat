/**
 * @module app/core/sync/recent-op-cache
 *
 * Purpose:
 * Short-lived in-memory cache of recently pushed opIds. Used by
 * subscription handlers to detect and drop echoed changes that
 * originate from this device, preventing them from being treated
 * as conflicts or redundant applies.
 *
 * Behavior:
 * - `markRecentOpId()`: Records an opId with the current timestamp
 * - `isRecentOpId()`: Returns true if the opId was marked within the TTL
 * - Auto-prunes entries older than 60 seconds and caps at 2,000 entries
 *
 * Constraints:
 * - In-memory only; cleared on page reload (acceptable because pending_ops
 *   are re-pushed after reload anyway)
 * - TTL is fixed at 60 seconds; sufficient for typical push-to-echo latency
 *
 * @see core/sync/hook-bridge for marking opIds on local writes
 * @see core/sync/subscription-manager for filtering echoed changes
 */

const RECENT_OP_TTL_MS = 60_000;
const MAX_RECENT_OPS = 2_000;

const recentOps = new Map<string, number>();

function prune(now: number): void {
    for (const [opId, ts] of recentOps) {
        if (now - ts > RECENT_OP_TTL_MS) {
            recentOps.delete(opId);
        }
    }
    while (recentOps.size > MAX_RECENT_OPS) {
        const oldest = recentOps.keys().next().value as string | undefined;
        if (!oldest) break;
        recentOps.delete(oldest);
    }
}

/**
 * Purpose:
 * Mark an opId as recently pushed by this device.
 *
 * Behavior:
 * - Stores the opId in an in-memory map with the current timestamp
 * - Prunes entries outside the TTL and caps the map size
 *
 * Constraints:
 * - No-op for null/undefined/empty opIds
 * - Cache is in-memory only and resets on reload
 */
export function markRecentOpId(opId: string | undefined | null): void {
    if (!opId) return;
    const now = Date.now();
    recentOps.set(opId, now);
    prune(now);
    if (import.meta.dev) {
        console.debug('[sync] recentOp mark', { opId, size: recentOps.size });
    }
}

/**
 * Purpose:
 * Determine whether an opId should be treated as an echo.
 *
 * Behavior:
 * - Returns true if the opId was marked within the TTL window
 * - Automatically evicts expired entries
 *
 * Constraints:
 * - Returns false for null/undefined/empty opIds
 */
export function isRecentOpId(opId: string | undefined | null): boolean {
    if (!opId) return false;
    const now = Date.now();
    const ts = recentOps.get(opId);
    if (!ts) return false;
    if (now - ts > RECENT_OP_TTL_MS) {
        recentOps.delete(opId);
        return false;
    }
    if (import.meta.dev) {
        console.debug('[sync] recentOp hit', { opId });
    }
    return true;
}
