import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullResponse, SyncChange, SyncScope } from '~~/shared/sync/types';
import { createGatewaySyncProvider } from '../providers/gateway-sync-provider';

function makeOkResponse(body: unknown) {
    return {
        ok: true,
        status: 200,
        text: vi.fn(async () => JSON.stringify(body)),
    } as unknown as Response;
}

function change(version: number, opId: string): SyncChange {
    return {
        serverVersion: version,
        tableName: 'messages',
        pk: `m-${version}`,
        op: 'put',
        payload: {
            id: `m-${version}`,
            thread_id: 't1',
            role: 'user',
            index: 0,
            order_key: `0000000000${version}:0000:node`,
            deleted: false,
            created_at: version,
            updated_at: version,
            clock: 1,
        },
        stamp: {
            clock: 1,
            hlc: `0000000000${version}:0000:node`,
            deviceId: 'device-1',
            opId,
        },
    };
}

describe('GatewaySyncProvider', () => {
    let originalFetch: unknown;

    beforeEach(() => {
        vi.useFakeTimers();
        originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    });

    it('subscribe resolves immediately (does not await initial poll)', async () => {
        // Never resolves; if subscribe awaited the initial poll, this test would hang.
        (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
            async () => new Promise(() => {})
        );

        const provider = createGatewaySyncProvider({ pollIntervalMs: 10 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        let resolved = false;
        const p = provider.subscribe(scope, ['messages'], () => undefined, {
            cursor: 0,
            limit: 10,
        });
        void p.then(() => {
            resolved = true;
        });

        await Promise.resolve();
        expect(resolved).toBe(true);
    });

    it('awaits async onChanges handler before continuing polling', async () => {
        // Make jitter deterministic so timer assertions don't flake.
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const pulls: PullResponse[] = [
            { changes: [change(1, 'op-1')], nextCursor: 1, hasMore: false },
            { changes: [change(2, 'op-2')], nextCursor: 2, hasMore: false },
        ];

        const fetchMock = vi.fn(async () => {
            const next = pulls.shift() ?? { changes: [], nextCursor: 2, hasMore: false };
            return makeOkResponse(next);
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 10 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        let release: (() => void) | null = null;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });

        const onChanges = vi.fn(async (changes: SyncChange[]) => {
            // Block the first apply so we can assert no additional polls happen.
            if (changes[0]?.serverVersion === 1) {
                await barrier;
            }
        });

        const unsubscribe = await provider.subscribe(scope, ['messages'], onChanges, {
            cursor: 0,
            limit: 10,
        });

        // Start initial run
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Even if time passes, we should not poll again while onChanges is awaiting.
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        release?.();
        for (let i = 0; i < 25; i++) {
            await Promise.resolve();
        }

        // Next poll should happen on the interval after the barrier releases.
        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

        unsubscribe();
    });
});
