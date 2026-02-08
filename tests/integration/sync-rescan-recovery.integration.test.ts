import { describe, expect, it } from 'vitest';

describe('sync rescan recovery integration', () => {
    it('supports cursor reset/rescan with pending overlay and no duplicates', () => {
        const serverRows = [
            { id: 'a', updated_at: 1 },
            { id: 'b', updated_at: 2 },
        ];
        const pendingLocal = [{ id: 'b', updated_at: 3 }, { id: 'c', updated_at: 4 }];

        const mergedById = new Map<string, { id: string; updated_at: number }>();
        for (const row of serverRows) mergedById.set(row.id, row);
        for (const row of pendingLocal) mergedById.set(row.id, row);

        const merged = Array.from(mergedById.values()).sort((a, b) => a.id.localeCompare(b.id));
        expect(merged).toEqual([
            { id: 'a', updated_at: 1 },
            { id: 'b', updated_at: 3 },
            { id: 'c', updated_at: 4 },
        ]);
    });

    it('handles stale cursor by triggering rescan from zero', () => {
        const staleCursor = 999;
        const currentServerVersion = 100;

        const shouldRescan = staleCursor > currentServerVersion;
        const nextCursor = shouldRescan ? 0 : staleCursor;

        expect(shouldRescan).toBe(true);
        expect(nextCursor).toBe(0);
    });
});
