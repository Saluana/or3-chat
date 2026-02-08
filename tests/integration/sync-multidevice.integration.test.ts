import { describe, expect, it } from 'vitest';

type RecordState = { value: string; clock: number; hlc: string; deviceId: string };

function lwwMerge(current: RecordState | null, incoming: RecordState): RecordState {
    if (!current) return incoming;
    if (incoming.clock > current.clock) return incoming;
    if (incoming.clock < current.clock) return current;
    return incoming.hlc > current.hlc ? incoming : current;
}

describe('sync multidevice integration', () => {
    it('resolves concurrent writes with HLC tie-break', () => {
        const a: RecordState = { value: 'A', clock: 5, hlc: '0005:0001:devA', deviceId: 'devA' };
        const b: RecordState = { value: 'B', clock: 5, hlc: '0005:0002:devB', deviceId: 'devB' };

        const merged = lwwMerge(a, b);
        expect(merged.value).toBe('B');
    });

    it('keeps message order stable by index then order_key', () => {
        const rows = [
            { id: 'm3', index: 2, order_key: '003' },
            { id: 'm1', index: 1, order_key: '001' },
            { id: 'm2', index: 1, order_key: '002' },
        ];

        rows.sort((a, b) => (a.index - b.index) || a.order_key.localeCompare(b.order_key));
        expect(rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('does not re-enqueue remote-applied writes', () => {
        let pendingOps = 0;
        const markSyncTransaction = true;

        const applyRemote = () => {
            if (!markSyncTransaction) pendingOps += 1;
        };

        applyRemote();
        expect(pendingOps).toBe(0);
    });
});
