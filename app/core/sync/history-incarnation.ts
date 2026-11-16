import type { Or3DB } from '~/db/client';
import type { Transaction, Table } from 'dexie';
import type { SyncState } from '~~/shared/sync/types';
import { HistoryIncarnationSchema } from '~~/shared/sync/schemas';
import { clearRecentOpIds } from './recent-op-cache';

export type HistoryGuard = Pick<SyncState, 'historyIncarnation' | 'phase' | 'resetTarget' | 'firstBindEligible'>;
const unbound: HistoryGuard = { historyIncarnation: null, phase: 'unbound', resetTarget: null, firstBindEligible: false };
export class StaleHistoryError extends Error {
    constructor() { super('Sync history context is no longer current'); this.name = 'AbortError'; }
}
export async function readHistory(db: Or3DB | Transaction): Promise<HistoryGuard> {
    const row = await (db as { table(name: string): Table<SyncState, string> }).table('sync_state').get('sync_history');
    return row ? { historyIncarnation: row.historyIncarnation ?? null, phase: row.phase ?? 'unbound', resetTarget: row.resetTarget ?? null, firstBindEligible: row.firstBindEligible === true } : { ...unbound };
}
export function sameHistory(a: HistoryGuard, b: HistoryGuard): boolean {
    return a.historyIncarnation === b.historyIncarnation && a.phase === b.phase && a.resetTarget === b.resetTarget && (a.firstBindEligible === true) === (b.firstBindEligible === true);
}
export async function assertHistory(db: Or3DB | Transaction, expected: HistoryGuard): Promise<void> {
    if (!sameHistory(await readHistory(db), expected)) throw new StaleHistoryError();
}
export async function requestHistoryReset(db: Or3DB, expected: HistoryGuard, target: string): Promise<boolean> {
    HistoryIncarnationSchema.parse(target);
    const changed = await db.transaction('rw', ['sync_state'], async () => {
        if (!sameHistory(await readHistory(db), expected)) return false;
        await db.sync_state.put({ id: 'sync_history', ...expected, phase: 'resetting', resetTarget: target,
            cursor: 0, deviceId: '', lastSyncAt: 0 });
        return true;
    });
    if (changed) clearRecentOpIds();
    return changed;
}
export function changedHistoryFromError(error: unknown): string | undefined {
    const data = (error as { data?: { code?: string; historyIncarnation?: unknown } } | null)?.data;
    return data?.code === 'OR3_SYNC_HISTORY_CHANGED' && HistoryIncarnationSchema.safeParse(data.historyIncarnation).success
        ? data.historyIncarnation as string : undefined;
}

/** Protocol incompatibility is a paused boundary, never a retry/settlement. */
export function isHistoryProtocolBoundary(error: unknown): boolean {
    const value = error as { status?: number; statusCode?: number; code?: string; data?: { code?: string } } | null;
    return value?.status === 426 || value?.statusCode === 426 ||
        value?.code === 'OR3_SYNC_HISTORY_UNSUPPORTED' || value?.data?.code === 'OR3_SYNC_HISTORY_UNSUPPORTED';
}

/** Call in the same transaction as server-state exposure or unclassified import. */
export async function invalidateFirstBindEligibility(db: Or3DB | Transaction): Promise<void> {
    const table = (db as { table(name: string): Table<SyncState, string> }).table('sync_state');
    if ((await table.get('sync_history'))?.firstBindEligible === true) {
        await table.update('sync_history', { firstBindEligible: false });
    }
}
