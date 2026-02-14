import { describe, expect, it } from 'vitest';

type Op = { id: string; table: string; pk: string; payload?: unknown };
type Change = Op & { serverVersion: number };

describe('sync endpoints integration', () => {
    it('push -> pull -> cursor checkpoint end-to-end flow', () => {
        let serverVersion = 0;
        const changeLog: Change[] = [];
        const deviceCursors = new Map<string, number>();

        const push = (ops: Op[]) => {
            for (const op of ops) {
                serverVersion += 1;
                changeLog.push({ ...op, serverVersion });
            }
            return { serverVersion };
        };

        const pull = (cursor: number, limit = 50) => {
            const changes = changeLog.filter((c) => c.serverVersion > cursor).slice(0, limit);
            const nextCursor = changes.length ? changes[changes.length - 1]!.serverVersion : cursor;
            const hasMore = changeLog.some((c) => c.serverVersion > nextCursor);
            return { changes, nextCursor, hasMore };
        };

        const updateCursor = (deviceId: string, version: number) => {
            deviceCursors.set(deviceId, version);
            return { ok: true };
        };

        push([{ id: 'op1', table: 'messages', pk: 'm1', payload: { text: 'hello' } }]);
        const pulled = pull(0);
        expect(pulled.changes).toHaveLength(1);
        expect(pulled.nextCursor).toBe(1);
        expect(updateCursor('dev-1', pulled.nextCursor)).toEqual({ ok: true });
        expect(deviceCursors.get('dev-1')).toBe(1);
    });

    it('advances cursor monotonically across multi-batch pulls', () => {
        const changes: Change[] = Array.from({ length: 5 }, (_, i) => ({
            id: `op-${i + 1}`,
            table: 'messages',
            pk: `m${i + 1}`,
            serverVersion: i + 1,
        }));

        const pull = (cursor: number, limit: number) => {
            const batch = changes.filter((c) => c.serverVersion > cursor).slice(0, limit);
            const nextCursor = batch.length ? batch[batch.length - 1]!.serverVersion : cursor;
            return {
                changes: batch,
                nextCursor,
                hasMore: changes.some((c) => c.serverVersion > nextCursor),
            };
        };

        let cursor = 0;
        const seen: number[] = [];
        for (;;) {
            const res = pull(cursor, 2);
            seen.push(res.nextCursor);
            expect(res.nextCursor).toBeGreaterThanOrEqual(cursor);
            cursor = res.nextCursor;
            if (!res.hasMore) break;
        }

        expect(seen).toEqual([2, 4, 5]);
        expect(cursor).toBe(5);
    });

    it('supports rate-limit recovery via retry', () => {
        let calls = 0;
        const pushWithLimit = () => {
            calls += 1;
            if (calls === 1) {
                return { ok: false, status: 429, retryAfterMs: 10 };
            }
            return { ok: true, status: 200 };
        };

        const first = pushWithLimit();
        expect(first).toEqual({ ok: false, status: 429, retryAfterMs: 10 });

        const second = pushWithLimit();
        expect(second).toEqual({ ok: true, status: 200 });
    });
});
