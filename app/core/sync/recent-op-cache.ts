/**
 * Recent opId cache for suppressing echo changes from sync providers.
 *
 * Keeps a short-lived in-memory set of recently pushed opIds so
 * subscription handlers can drop echoed changes without treating
 * them as conflicts.
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

export function markRecentOpId(opId: string | undefined | null): void {
    if (!opId) return;
    const now = Date.now();
    recentOps.set(opId, now);
    prune(now);
    if (import.meta.dev) {
        console.debug('[sync] recentOp mark', { opId, size: recentOps.size });
    }
}

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
