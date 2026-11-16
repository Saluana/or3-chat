import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRecentOpId, markRecentOpId, unmarkRecentOpId } from '../recent-op-cache';

describe('recent-op-cache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('marks and detects recent opIds', () => {
        expect(isRecentOpId('op-1')).toBe(false);
        markRecentOpId('op-1');
        expect(isRecentOpId('op-1')).toBe(true);
    });

    it('does not suppress an authoritative UUID reused in another workspace or history', () => {
        markRecentOpId('shared-uuid', { dbName: 'workspace-a', historyIncarnation: 'I' });
        expect(isRecentOpId('shared-uuid', { dbName: 'workspace-a', historyIncarnation: 'I' })).toBe(true);
        expect(isRecentOpId('shared-uuid', { dbName: 'workspace-a', historyIncarnation: 'J' })).toBe(false);
        expect(isRecentOpId('shared-uuid', { dbName: 'workspace-b', historyIncarnation: 'I' })).toBe(false);
    });

    it('expires opIds after TTL', () => {
        markRecentOpId('op-2');
        expect(isRecentOpId('op-2')).toBe(true);

        vi.advanceTimersByTime(61_000);
        expect(isRecentOpId('op-2')).toBe(false);
    });

    it('unmarks an opId so a later winner echo can apply', () => {
        markRecentOpId('op-3');
        expect(isRecentOpId('op-3')).toBe(true);
        unmarkRecentOpId('op-3');
        expect(isRecentOpId('op-3')).toBe(false);
    });
});
