import type { Or3DB } from '~/db/client';

export const MAX_PENDING_OPS = 500;

export async function countQueuedSyncOperations(db: Or3DB): Promise<number> {
    const [pending, retryWait] = await Promise.all([
        db.pending_ops.where('status').equals('pending').count(),
        db.pending_ops.where('status').equals('retry_wait').count(),
    ]);
    return pending + retryWait;
}
