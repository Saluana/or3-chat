import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { createError } from 'h3';
import { resolveAdminDataDir } from '../auth/data-paths';
import { AdvisoryPluginOperationLock } from '../plugins/package-operation-lock';

/**
 * Append-only private journal for administrative actions owned outside the
 * billing database. Each operation writes a durable intent before mutating and
 * a durable outcome after; a crash in between reads back as "incomplete".
 * There is no cross-store atomicity: the authoritative owner decides retries.
 */
const FILE = 'activity-journal.jsonl';
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const SECRET_KEY = /secret|password|token|credential|api[_-]?key|private|cookie|session/i;

export type JournalValue = string | number | boolean | null;
export interface JournalTarget { kind: string; id: string }
export interface ActivityItem {
    operationId: string;
    source: 'admin';
    at: number;
    actor: string;
    action: string;
    target: JournalTarget;
    reason: string | null;
    before: Record<string, JournalValue> | null;
    after: Record<string, JournalValue> | null;
    outcome: 'completed' | 'failed' | 'incomplete';
    code: string | null;
    completedAt: number | null;
}

interface IntentLine { v: 1; phase: 'intent'; operationId: string; at: number; actor: string; action: string; target: JournalTarget; reason: string | null; before: Record<string, JournalValue> | null }
interface OutcomeLine { v: 1; phase: 'outcome'; operationId: string; at: number; outcome: 'completed' | 'failed'; code: string | null; after: Record<string, JournalValue> | null }

/** Only scalar, non-secret, bounded values reach the journal. */
function redact(values: Record<string, unknown> | null | undefined): Record<string, JournalValue> | null {
    if (!values) return null;
    const result: Record<string, JournalValue> = {};
    for (const [key, value] of Object.entries(values).slice(0, 40)) {
        if (SECRET_KEY.test(key) || key.length > 80) continue;
        if (typeof value === 'string') { if (value.length <= 200) result[key] = value; }
        else if (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean' || value === null) result[key] = value as JournalValue;
    }
    return result;
}

function bounded(value: string, max: number, name: string): string {
    if (!value || value.length > max) throw createError({ statusCode: 400, statusMessage: `Invalid ${name}` });
    return value;
}

/**
 * Operation IDs present in the journal, derived from the file and never stored
 * elsewhere. Under the journal lock each append reads only the bytes written since
 * the last append (including other processes' appends), so a process scans the
 * whole file once instead of on every mutation. A replaced or truncated file
 * (restore) is detected by inode/size and re-indexed from the start.
 */
interface JournalIndex { inode: number; offset: number; ids: Set<string> }
const indexes = new Map<string, JournalIndex>();
const READ_CHUNK = 1024 * 1024;
// Operation IDs are [A-Za-z0-9_-], so JSON never escapes them; quoted text inside
// other string fields has escaped quotes and cannot match.
const OPERATION_ID = /"operationId":"([A-Za-z0-9_-]{1,100})"/g;

async function indexJournal(path: string, file: FileHandle): Promise<{ index: JournalIndex; partialTail: boolean }> {
    const { size, ino } = await file.stat();
    let index = indexes.get(path);
    if (!index || index.inode !== ino || size < index.offset) {
        index = { inode: ino, offset: 0, ids: new Set() };
        indexes.set(path, index);
    }
    const buffer = Buffer.alloc(Math.min(READ_CHUNK, Math.max(1, size - index.offset)));
    let carry = Buffer.alloc(0);
    let position = index.offset;
    while (position < size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - position), position);
        if (!bytesRead) break;
        position += bytesRead;
        const data = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
        // Only complete lines are indexed; a trailing fragment is re-read next time.
        const complete = data.lastIndexOf(0x0a) + 1;
        for (const match of data.toString('utf8', 0, complete).matchAll(OPERATION_ID)) index.ids.add(match[1]!);
        index.offset += complete;
        carry = data.subarray(complete);
    }
    return { index, partialTail: index.offset < size };
}

async function append(dir: string, line: IntentLine | OutcomeLine, refuseReuse = false) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const lease = await new AdvisoryPluginOperationLock(dir, hostname(), true).acquire('activity-journal', { timeoutMs: 5_000, requireDeadOwner: true });
    try {
        const path = join(dir, FILE);
        const file = await open(path, 'a+', 0o600);
        try {
            const { index, partialTail } = await indexJournal(path, file);
            if (refuseReuse && index.ids.has(line.operationId)) {
                throw createError({ statusCode: 409, statusMessage: 'This operation already started. Check its recorded result before retrying.', data: { code: 'operation_reused' } });
            }
            // A crashed writer's torn fragment must not absorb this record.
            await file.write(`${partialTail ? '\n' : ''}${JSON.stringify(line)}\n`);
            await file.sync();
            index.ids.add(line.operationId);
        } finally { await file.close(); }
    } finally { await lease.release(); }
}

/**
 * Records durable intent. Fails before any mutation if the intent cannot be
 * written, and refuses an operation ID that already began.
 */
export async function beginAdminOperation(input: {
    operationId: string; actor: string; action: string; target: JournalTarget; reason?: string | null; before?: Record<string, unknown> | null;
}, dir = resolveAdminDataDir()) {
    const operationId = bounded(input.operationId, 100, 'operation ID');
    if (!/^[A-Za-z0-9_-]+$/.test(operationId)) throw createError({ statusCode: 400, statusMessage: 'Invalid operation ID' });
    const intent: IntentLine = {
        v: 1, phase: 'intent', operationId, at: Date.now(), actor: bounded(input.actor, 200, 'actor'), action: bounded(input.action, 80, 'action'),
        target: { kind: bounded(input.target.kind, 40, 'target'), id: bounded(input.target.id, 200, 'target') },
        reason: input.reason ? bounded(input.reason.trim(), 500, 'reason') : null, before: redact(input.before),
    };
    await append(dir, intent, true);
    let finished = false;
    const finish = async (outcome: 'completed' | 'failed', code: string | null, after?: Record<string, unknown> | null) => {
        if (finished) return;
        finished = true;
        await append(dir, { v: 1, phase: 'outcome', operationId, at: Date.now(), outcome, code, after: redact(after) });
    };
    return {
        operationId,
        complete: (after?: Record<string, unknown> | null) => finish('completed', null, after),
        fail: (code: string) => finish('failed', code.slice(0, 80)),
    };
}

/**
 * Bounded, newest-first read with simple filters. The cursor is the
 * operation ID of the last item returned. Reads only the newest window of the file.
 */
export async function readAdminActivity(input: {
    limit: number; cursor?: string | null; actor?: string; action?: string; targetId?: string; since?: number; until?: number;
}, dir = resolveAdminDataDir()): Promise<{ items: ActivityItem[]; nextCursor: string | null; coverageStart: number | null; truncated: boolean }> {
    let text = '';
    let truncated = false;
    try {
        const file = await open(join(dir, FILE), 'r');
        try {
            const { size } = await file.stat();
            const length = Math.min(size, MAX_SCAN_BYTES);
            truncated = size > MAX_SCAN_BYTES;
            const buffer = Buffer.alloc(length);
            await file.read(buffer, 0, length, size - length);
            text = buffer.toString('utf8');
            if (truncated) text = text.slice(text.indexOf('\n') + 1);
        } finally { await file.close(); }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const operations = new Map<string, ActivityItem>();
    for (const raw of text.split('\n')) {
        if (!raw) continue;
        let line: IntentLine | OutcomeLine;
        try { line = JSON.parse(raw) as IntentLine | OutcomeLine; } catch { continue; } // A torn final write never hides earlier records.
        if (line.phase === 'intent') {
            operations.set(line.operationId, {
                operationId: line.operationId, source: 'admin', at: line.at, actor: line.actor, action: line.action, target: line.target,
                reason: line.reason, before: line.before, after: null, outcome: 'incomplete', code: null, completedAt: null,
            });
        } else {
            const item = operations.get(line.operationId);
            if (item) Object.assign(item, { outcome: line.outcome, code: line.code, after: line.after, completedAt: line.at });
        }
    }
    const all = [...operations.values()].sort((a, b) => b.at - a.at || (a.operationId < b.operationId ? 1 : -1));
    const filtered = all.filter(item => (!input.actor || item.actor === input.actor) && (!input.action || item.action === input.action) &&
        (!input.targetId || item.target.id === input.targetId) && (input.since === undefined || item.at >= input.since) && (input.until === undefined || item.at <= input.until));
    const cursorIndex = input.cursor ? filtered.findIndex(item => item.operationId === input.cursor) : -1;
    if (input.cursor && cursorIndex < 0) throw createError({ statusCode: 400, statusMessage: 'Activity cursor is no longer available. Reload the first page.' });
    const start = cursorIndex + 1;
    const limit = Math.max(1, Math.min(input.limit, 100));
    const items = filtered.slice(start, start + limit);
    return {
        items,
        nextCursor: start + limit < filtered.length ? items.at(-1)!.operationId : null,
        coverageStart: all.length ? all.at(-1)!.at : null,
        truncated,
    };
}

/**
 * Records an existing administrative mutation without changing its semantics:
 * intent before, outcome after. If the intent cannot be written the mutation does not run.
 */
export async function withAdminJournal<T>(input: {
    actor: string; action: string; target: JournalTarget; reason?: string | null; before?: Record<string, unknown> | null; operationId?: string;
}, mutation: () => Promise<T>, after?: (result: T) => Record<string, unknown> | null): Promise<T> {
    const op = await beginAdminOperation({ ...input, operationId: input.operationId ?? randomUUID() });
    let result: T;
    try { result = await mutation(); }
    catch (error) {
        await op.fail((error as { statusCode?: number }).statusCode ? `http_${(error as { statusCode: number }).statusCode}` : 'failed').catch(() => {});
        throw error;
    }
    // A post-change receipt failure leaves the operation visible as incomplete rather than unrecorded.
    await op.complete(after?.(result) ?? null).catch(() => {});
    return result;
}
