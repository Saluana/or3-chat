import { describe, expect, it } from 'vitest';
import {
    StreamBudgetLedger,
    StreamOwnershipRegistry,
    parseStreamControlEnvelope,
} from '../stream-protocol';

describe('stream control protocol', () => {
    it('validates opaque controls and copies byte frames', () => {
        const bytes = new Uint8Array([1, 2]);
        const parsed = parseStreamControlEnvelope({
            v: 1,
            kind: 'data',
            streamId: 'stream-1',
            sequence: 3,
            bytes,
        });
        expect(parsed).toMatchObject({ ok: true, value: { kind: 'data', sequence: 3 } });
        if (parsed.ok && parsed.value.kind === 'data') {
            expect(parsed.value.bytes).not.toBe(bytes);
            expect([...parsed.value.bytes]).toEqual([1, 2]);
        }
        expect(parseStreamControlEnvelope({ v: 1, kind: 'data', streamId: 'x', sequence: 0, bytes: new Uint8Array(256 * 1024 + 1) })).toMatchObject({ ok: false });
        expect(parseStreamControlEnvelope({ v: 1, kind: 'open', streamId: '../x', format: 'bytes' })).toMatchObject({ ok: false });
    });

    it('separates cumulative, rolling and queue budgets under fake time', () => {
        let now = 0;
        const ledger = new StreamBudgetLedger(
            {
                maxCumulativeBytes: 10,
                maxCumulativeChunks: 10,
                maxQueuedBytes: 5,
                maxRollingBytes: 5,
                rollingWindowMs: 100,
            },
            { now: () => now }
        );
        expect(ledger.enqueue(3)).toMatchObject({ ok: true });
        expect(ledger.enqueue(3)).toMatchObject({ ok: false, kind: 'queued-bytes' });
        ledger.acknowledge(3);
        expect(ledger.enqueue(3)).toMatchObject({ ok: false, kind: 'rolling-bytes' });
        now = 101;
        ledger.acknowledge(3);
        expect(ledger.enqueue(3)).toMatchObject({ ok: true });
        expect(ledger.snapshot()).toMatchObject({ cumulativeBytes: 9, rollingBytes: 3 });
        expect(ledger.enqueue(2)).toMatchObject({ ok: false, kind: 'cumulative-bytes' });
    });

    it('requires the host owner for every stream lifecycle operation', () => {
        const ownership = new StreamOwnershipRegistry();
        expect(ownership.claim('activation-a', 'stream-1', 'sse')).toBe(true);
        expect(ownership.claim('activation-b', 'stream-1', 'bytes')).toBe(false);
        expect(ownership.owns('activation-b', 'stream-1')).toBe(false);
        expect(ownership.format('activation-a', 'stream-1')).toBe('sse');
        expect(ownership.release('activation-b', 'stream-1')).toBe(false);
        expect(ownership.release('activation-a', 'stream-1')).toBe(true);
        expect(ownership.owns('activation-a', 'stream-1')).toBe(false);
    });
});
