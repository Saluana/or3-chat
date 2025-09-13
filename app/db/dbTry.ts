import { reportError, err } from '~/utils/errors';

// Quota guidance (Req 20.2) exported for UI/doc reuse
export const DB_QUOTA_GUIDANCE =
    'Storage quota exceeded. Clear older chats, files, or browser site data to free space.';

// Lightweight DB operation wrapper (Task 7.1)
// Usage: const res = await dbTry(() => db.table.put(obj), { op: 'write', entity: 'message' })
// - Maps Dexie/IndexedDB quota errors -> ERR_DB_QUOTA_EXCEEDED (non-retryable)
// - Maps generic errors to read/write codes
// - Attaches domain:'db', op, entity tags for hooks & diagnostics

export interface DbTryTags {
    op: 'read' | 'write';
    entity?: string; // table/entity name for context
    [k: string]: any;
}

export async function dbTry<T>(
    fn: () => Promise<T> | T,
    tags: DbTryTags,
    opts: { rethrow?: boolean } = {}
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (e: any) {
        // Quota detection: DOMException name or message heuristic
        const name = e?.name || '';
        const msg: string = e?.message || '';
        const isQuota = /quota/i.test(name) || /quota/i.test(msg);
        if (isQuota) {
            reportError(
                err('ERR_DB_QUOTA_EXCEEDED', DB_QUOTA_GUIDANCE, {
                    severity: 'error',
                    retryable: false,
                    tags: { ...tags, domain: 'db', rw: tags.op }, // add rw tag (Req 20.1)
                }),
                { toast: true }
            );
            if (opts.rethrow) throw e;
            return undefined;
        }
        const code =
            tags.op === 'read' ? 'ERR_DB_READ_FAILED' : 'ERR_DB_WRITE_FAILED';
        reportError(
            err(code, 'Database operation failed', {
                severity: 'error',
                retryable: tags.op === 'read' ? true : true, // allow manual re-invoke upstream
                tags: { ...tags, domain: 'db', rw: tags.op }, // include rw convenience tag (Req 20.1)
                cause: e,
            }),
            { toast: true }
        );
        if (opts.rethrow) throw e;
        return undefined;
    }
}
