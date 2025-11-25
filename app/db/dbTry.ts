import { reportError, err } from '~/utils/errors';

/** Quota guidance (Req 20.2) exported for UI/doc reuse */
export const DB_QUOTA_GUIDANCE =
    'Storage quota exceeded. Clear older chats, files, or browser site data to free space.' as const;

/**
 * Lightweight DB operation wrapper (Task 7.1).
 * Usage: const res = await dbTry(() => db.table.put(obj), { op: 'write', entity: 'message' })
 * - Maps Dexie/IndexedDB quota errors -> ERR_DB_QUOTA_EXCEEDED (non-retryable)
 * - Maps generic errors to read/write codes
 * - Attaches domain:'db', op, entity tags for hooks & diagnostics
 */

export interface DbTryTags {
    readonly op: 'read' | 'write';
    readonly entity?: string; // table/entity name for context
    readonly [k: string]: unknown;
}

function getErrorInfo(e: unknown): { name: string; message: string } {
    if (e instanceof Error) {
        return { name: e.name, message: e.message };
    }
    if (typeof e === 'object' && e !== null) {
        const obj = e as Record<string, unknown>;
        return {
            name: typeof obj.name === 'string' ? obj.name : '',
            message: typeof obj.message === 'string' ? obj.message : '',
        };
    }
    return { name: '', message: '' };
}

export async function dbTry<T>(
    fn: () => Promise<T> | T,
    tags: DbTryTags,
    opts: { rethrow?: boolean } = {}
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (e: unknown) {
        // Quota detection: DOMException name or message heuristic
        const { name, message: msg } = getErrorInfo(e);
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
