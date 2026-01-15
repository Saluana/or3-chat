import { describe, it, expect } from 'bun:test';

// Simulation of the server-side pagination logic
function paginate(
    allItems: number[], // server_versions
    startCursor: number,
    batchSize: number,
    minCursor: number // The GC cutoff
) {
    // Simulates:
    // .gt('server_version', startCursor)
    // .lt('server_version', minCursor)
    // .take(batchSize + 1)

    const candidates = allItems
        .filter(v => v > startCursor && v < minCursor)
        .slice(0, batchSize + 1);

    const hasMore = candidates.length > batchSize;
    const batch = hasMore ? candidates.slice(0, -1) : candidates;

    let nextCursor = startCursor;
    // Simulate processing the batch
    for (const item of batch) {
        nextCursor = item;
    }

    return { batch, nextCursor, hasMore };
}

describe('GC Pagination Logic', () => {
    it('correctly paginates through a list of versions', () => {
        const allItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const batchSize = 3;
        const gcCutoff = 11; // Delete everything up to 10

        // Pass 1
        let cursor = 0;
        let result = paginate(allItems, cursor, batchSize, gcCutoff);

        expect(result.batch).toEqual([1, 2, 3]);
        expect(result.nextCursor).toBe(3);
        expect(result.hasMore).toBe(true);
        cursor = result.nextCursor;

        // Pass 2
        result = paginate(allItems, cursor, batchSize, gcCutoff);
        expect(result.batch).toEqual([4, 5, 6]);
        expect(result.nextCursor).toBe(6);
        expect(result.hasMore).toBe(true);
        cursor = result.nextCursor;

        // Pass 3
        result = paginate(allItems, cursor, batchSize, gcCutoff);
        expect(result.batch).toEqual([7, 8, 9]);
        expect(result.nextCursor).toBe(9);
        expect(result.hasMore).toBe(true);
        cursor = result.nextCursor;

        // Pass 4 (Last partial batch)
        result = paginate(allItems, cursor, batchSize, gcCutoff);
        expect(result.batch).toEqual([10]);
        expect(result.nextCursor).toBe(10);
        expect(result.hasMore).toBe(false);
    });

    it('handles empty result correctly', () => {
        const allItems: number[] = [];
        const result = paginate(allItems, 0, 5, 100);
        expect(result.batch).toEqual([]);
        expect(result.nextCursor).toBe(0);
        expect(result.hasMore).toBe(false);
    });

    it('handles case where items exactly match batch size', () => {
        const allItems = [1, 2, 3];
        const batchSize = 3;
        const result = paginate(allItems, 0, batchSize, 10);

        // take(4) returns [1, 2, 3]
        // hasMore is false (3 is not > 3)
        // batch is [1, 2, 3]

        expect(result.batch).toEqual([1, 2, 3]);
        expect(result.nextCursor).toBe(3);
        expect(result.hasMore).toBe(false);
    });

    it('respects minCursor (GC cutoff)', () => {
        const allItems = [1, 2, 3, 4, 5];
        const batchSize = 2;
        const gcCutoff = 4; // Should only process 1, 2, 3. 4 is not < 4.

        // Pass 1
        let cursor = 0;
        let result = paginate(allItems, cursor, batchSize, gcCutoff);
        expect(result.batch).toEqual([1, 2]);
        expect(result.nextCursor).toBe(2);
        expect(result.hasMore).toBe(true);
        cursor = result.nextCursor;

        // Pass 2
        result = paginate(allItems, cursor, batchSize, gcCutoff);
        // candidates: gt(2) and lt(4) -> [3]
        // take(3) -> [3]
        expect(result.batch).toEqual([3]);
        expect(result.nextCursor).toBe(3);
        expect(result.hasMore).toBe(false);
    });
});
