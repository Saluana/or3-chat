import { describe, expect, it } from 'vitest';
import {
    compareSyncRevision,
    incomingRevisionWins,
    type SyncRevision,
} from '../revision';

const revisions: SyncRevision[] = [
    { clock: 1, hlc: '1000:0000:a', opId: 'op-a' },
    { clock: 1, hlc: '1000:0000:a', opId: 'op-b' },
    { clock: 1, hlc: '1000:0001:a', opId: 'op-a' },
    { clock: 2, hlc: '0000:0000:a', opId: 'op-a' },
];

describe('sync revision comparator', () => {
    it('orders by clock, then HLC, then operation ID', () => {
        expect([...revisions].sort(compareSyncRevision)).toEqual(revisions);
        expect(compareSyncRevision(revisions[0]!, revisions[0]!)).toBe(0);
    });

    it.each([
        ['put', 'put'],
        ['put', 'delete'],
        ['delete', 'put'],
        ['delete', 'delete'],
    ] as const)('uses the same winner for %s versus %s', (_incomingKind, _currentKind) => {
        expect(incomingRevisionWins(revisions[3]!, revisions[2]!)).toBe(true);
        expect(incomingRevisionWins(revisions[1]!, revisions[2]!)).toBe(false);
        expect(incomingRevisionWins(revisions[1]!, revisions[0]!)).toBe(true);
    });

    it('is antisymmetric across every fixture pair', () => {
        for (const left of revisions) {
            for (const right of revisions) {
                expect(
                    compareSyncRevision(left, right) +
                        compareSyncRevision(right, left)
                ).toBe(0);
            }
        }
    });

    it('is transitive across every ordered fixture triple', () => {
        for (const a of revisions) {
            for (const b of revisions) {
                for (const c of revisions) {
                    if (
                        compareSyncRevision(a, b) <= 0 &&
                        compareSyncRevision(b, c) <= 0
                    ) {
                        expect(compareSyncRevision(a, c)).toBeLessThanOrEqual(0);
                    }
                }
            }
        }
    });

    it('returns equality only for the exact same tuple', () => {
        const same = { ...revisions[0]! };
        expect(compareSyncRevision(revisions[0]!, same)).toBe(0);
        expect(incomingRevisionWins(revisions[0]!, same)).toBe(false);
    });
});
