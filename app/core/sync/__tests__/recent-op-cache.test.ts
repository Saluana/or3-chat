import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRecentOpId, markRecentOpId } from '../recent-op-cache';

describe('recent-op-cache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('marks and detects recent opIds', () => {
        expect(isRecentOpId('op-1')).toBe(false);
        markRecentOpId('op-1');
        expect(isRecentOpId('op-1')).toBe(true);
    });

    it('expires opIds after TTL', () => {
        markRecentOpId('op-2');
        expect(isRecentOpId('op-2')).toBe(true);

        vi.advanceTimersByTime(61_000);
        expect(isRecentOpId('op-2')).toBe(false);
    });
});
