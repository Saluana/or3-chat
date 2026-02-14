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

function makeErrorResponse(
    status: number,
    body: unknown,
    headers?: Record<string, string>
) {
    return {
        ok: false,
        status,
        text: vi.fn(async () =>
            typeof body === 'string' ? body : JSON.stringify(body)
        ),
        headers: {
            get: (name: string) => headers?.[name] ?? headers?.[name.toLowerCase()] ?? null,
        },
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

    it('sends credentials on gateway requests', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () =>
            makeOkResponse({ changes: [], nextCursor: 0, hasMore: false })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 1 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        const unsubscribe = await provider.subscribe(scope, ['messages'], () => undefined, {
            cursor: 0,
            limit: 10,
        });

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/sync/pull',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
            })
        );

        unsubscribe();
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

        let release: (() => void) | undefined;
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

        // Start initial run (first poll fires after pollIntervalMs + jitter)
        await vi.advanceTimersByTimeAsync(10);
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

    it('breaks polling loop when hasMore is true and cursor does not advance', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () =>
            makeOkResponse({ changes: [], nextCursor: 0, hasMore: true })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 1000 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        const unsubscribe = await provider.subscribe(scope, ['messages'], () => undefined, {
            cursor: 0,
            limit: 10,
        });

        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();

        // Without the loop guard this would spin inside one poll cycle.
        expect(fetchMock).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('delays first poll by pollInterval instead of firing immediately', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () =>
            makeOkResponse({ changes: [], nextCursor: 0, hasMore: false })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 500 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        const unsubscribe = await provider.subscribe(scope, ['messages'], () => undefined, {
            cursor: 0,
            limit: 10,
        });

        // Should NOT have polled yet at t=0
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(0);

        // Should NOT have polled at t=250 (half the interval)
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(0);

        // Should poll at t=500 (pollIntervalMs with jitter=0)
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('stops polling and emits sync-session-invalid event on auth/permission failures', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const fetchMock = vi.fn(async () =>
            makeErrorResponse(403, { statusMessage: 'Forbidden' })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const sessionInvalidSpy = vi.fn();
        window.addEventListener('or3:sync-session-invalid', sessionInvalidSpy);

        const provider = createGatewaySyncProvider({ pollIntervalMs: 100 });
        const scope: SyncScope = { workspaceId: 'ws-1' };

        const unsubscribe = await provider.subscribe(scope, ['messages'], () => undefined, {
            cursor: 0,
            limit: 10,
        });

        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sessionInvalidSpy).toHaveBeenCalledTimes(1);

        // Provider should stop scheduling polls after 401/403.
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        unsubscribe();
        window.removeEventListener('or3:sync-session-invalid', sessionInvalidSpy);
    });

    it('surfaces retry-after metadata on 429 push failures', async () => {
        const fetchMock = vi.fn(async () =>
            makeErrorResponse(
                429,
                { statusMessage: 'Rate limit exceeded. Retry after 4s' },
                { 'Retry-After': '4' }
            )
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider();

        await expect(
            provider.push({
                scope: { workspaceId: 'ws-1' },
                ops: [],
            })
        ).rejects.toMatchObject({
            status: 429,
            retryAfterMs: 4000,
        });
    });
});
