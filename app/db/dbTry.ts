import { reportError, err } from '~/utils/errors';

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
                err(
                    'ERR_DB_QUOTA_EXCEEDED',
                    'Local storage is full. Remove old data to continue.',
                    {
                        severity: 'error',
                        retryable: false,
                        tags: { ...tags, domain: 'db' },
                    }
                ),
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
                tags: { ...tags, domain: 'db' },
                cause: e,
            }),
            { toast: true }
        );
        if (opts.rethrow) throw e;
        return undefined;
    }
}
