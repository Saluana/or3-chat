import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginAdminOperation, readAdminActivity } from '../activity/journal';

/*
 * Failure inventory (tasks 1.3 / 2.6):
 * - concurrent appends from overlapping operations must stay line-intact and parseable;
 * - a crash after the intent (no outcome) must read back as "incomplete", never success;
 * - an operation ID can only begin once, so a retry consults the recorded result instead of replaying;
 * - secrets and oversized values never reach the journal, even when a caller passes them;
 * - a corrupt trailing line (torn write) does not hide earlier records.
 *
 * Operation-ID index (no per-mutation full scan):
 * - IDs already in the file when the process starts are refused;
 * - IDs appended by another process after this one indexed are refused;
 * - a line straddling a read-chunk boundary and multibyte text keep byte offsets exact;
 * - a reason quoting `"operationId":"x"` does not reserve x;
 * - a replaced or truncated journal (restore) rebuilds the index instead of trusting stale IDs;
 * - a torn trailing line from a crashed writer must not swallow the next intent.
 */
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'or3-admin-journal-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('admin activity journal', () => {
    it('keeps concurrent appends intact and pairs outcomes', async () => {
        const ops = await Promise.all(Array.from({ length: 20 }, (_, index) =>
            beginAdminOperation({ operationId: `op-${index}`, actor: 'admin', action: 'pause.update', target: { kind: 'deployment', id: 'uploads' }, reason: 'maintenance' }, dir)));
        await Promise.all(ops.map((op, index) => index % 2 ? op.complete({ enabled: true }) : op.fail('validation_failed')));
        const lines = readFileSync(join(dir, 'activity-journal.jsonl'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(40);
        lines.forEach(line => expect(() => JSON.parse(line)).not.toThrow());
        const page = await readAdminActivity({ limit: 50 }, dir);
        expect(page.items).toHaveLength(20);
        expect(page.items.filter(item => item.outcome === 'completed')).toHaveLength(10);
        expect(page.items.filter(item => item.outcome === 'failed')).toHaveLength(10);
    });

    it('reports an operation without an outcome as incomplete and refuses replay', async () => {
        await beginAdminOperation({ operationId: 'crash', actor: 'admin', action: 'workspace.delete', target: { kind: 'workspace', id: 'ws-1' } }, dir);
        const page = await readAdminActivity({ limit: 10 }, dir);
        expect(page.items[0]).toMatchObject({ operationId: 'crash', outcome: 'incomplete' });
        await expect(beginAdminOperation({ operationId: 'crash', actor: 'admin', action: 'workspace.delete', target: { kind: 'workspace', id: 'ws-1' } }, dir))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('redacts secret-like and oversized values', async () => {
        const op = await beginAdminOperation({
            operationId: 'redact', actor: 'admin', action: 'config.save', target: { kind: 'config', id: 'site' },
            before: { OR3_API_TOKEN: 'abc', password: 'p', name: 'x'.repeat(1000), limit: 5 },
        }, dir);
        await op.complete({ secretKey: 'sk_live_1', limit: 6 });
        const raw = readFileSync(join(dir, 'activity-journal.jsonl'), 'utf8');
        expect(raw).not.toContain('abc');
        expect(raw).not.toContain('sk_live_1');
        expect(raw).not.toContain('x'.repeat(300));
        const [item] = (await readAdminActivity({ limit: 1 }, dir)).items;
        expect(item).toMatchObject({ before: { limit: 5 }, after: { limit: 6 } });
    });

    it('filters bounded pages and survives a torn trailing line', async () => {
        for (let i = 0; i < 5; i++) {
            const op = await beginAdminOperation({ operationId: `f-${i}`, actor: i % 2 ? 'alice' : 'bob', action: 'quota.update', target: { kind: 'account', id: `u-${i}` } }, dir);
            await op.complete();
        }
        const { appendFileSync } = await import('node:fs');
        appendFileSync(join(dir, 'activity-journal.jsonl'), '{"v":1,"phase":"inte');
        const alice = await readAdminActivity({ limit: 10, actor: 'alice' }, dir);
        expect(alice.items.map(item => item.operationId).sort()).toEqual(['f-1', 'f-3']);
        const first = await readAdminActivity({ limit: 2 }, dir);
        expect(first.items).toHaveLength(2);
        expect(first.nextCursor).toBeTruthy();
        const second = await readAdminActivity({ limit: 10, cursor: first.nextCursor! }, dir);
        expect(second.items).toHaveLength(3);
        expect(new Set([...first.items, ...second.items].map(item => item.operationId)).size).toBe(5);
        await expect(readAdminActivity({ limit: 2, cursor: 'missing' }, dir)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses IDs from earlier processes, other writers and chunk-straddling lines', async () => {
        const file = join(dir, 'activity-journal.jsonl');
        const intent = (operationId: string, reason = 'r') => JSON.stringify({ v: 1, phase: 'intent', operationId, at: 1, actor: 'a', action: 'x', target: { kind: 'k', id: 'i' }, reason, before: null }) + '\n';
        // Multibyte filler ends 40 bytes before the 1 MiB read boundary, so the next line straddles it.
        const first = intent('before-start', 'é'.repeat(250));
        const fillerChars = Math.floor((1024 * 1024 - 40 - Buffer.byteLength(first) - '{"filler":""}\n'.length) / 2);
        writeFileSync(file, first + `{"filler":"${'ü'.repeat(fillerChars)}"}\n` + intent('straddles'));
        const begin = (operationId: string, reason?: string) => beginAdminOperation({ operationId, actor: 'admin', action: 'pause.uploads', target: { kind: 'deployment', id: 'uploads' }, reason }, dir);
        await begin('fresh', 'quoting "operationId":"quoted"');
        await expect(begin('before-start')).rejects.toMatchObject({ statusCode: 409 });
        await expect(begin('straddles')).rejects.toMatchObject({ statusCode: 409 });
        await expect(begin('fresh')).rejects.toMatchObject({ statusCode: 409 });
        await begin('quoted');
        // Another process appends after this one has indexed the file.
        appendFileSync(file, intent('other-process'));
        await expect(begin('other-process')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rebuilds the index after a restore and never swallows an intent after a torn line', async () => {
        const file = join(dir, 'activity-journal.jsonl');
        const begin = (operationId: string) => beginAdminOperation({ operationId, actor: 'admin', action: 'workspace.restore', target: { kind: 'workspace', id: 'ws' } }, dir);
        await begin('old-1');
        await begin('old-2');
        // Restore an older journal by replacing the file (new inode, smaller size).
        writeFileSync(`${file}.restore`, readFileSync(file, 'utf8').split('\n')[0] + '\n');
        renameSync(`${file}.restore`, file);
        await expect(begin('old-1')).rejects.toMatchObject({ statusCode: 409 });
        await begin('old-2');
        // A crashed writer left a partial line; the next intent starts on its own line.
        appendFileSync(file, '{"v":1,"phase":"intent","operationId":"torn');
        const op = await begin('after-torn');
        await op.complete();
        const items = (await readAdminActivity({ limit: 10 }, dir)).items;
        expect(items.find(item => item.operationId === 'after-torn')).toMatchObject({ outcome: 'completed' });
        expect(items.map(item => item.operationId)).not.toContain('torn');
    });
});
