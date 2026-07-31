import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullResponse, SnapshotResponse, SyncChange, SyncScope } from '~~/shared/sync/types';
import { createGatewaySyncProvider } from '../providers/gateway-sync-provider';
import { OutboxManager } from '../outbox-manager';
import { createMockDb, createPendingOpsTable } from './sync-test-utils';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
    }),
}));

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
    const normalizedOpId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        opId
    )
        ? opId
        : `00000000-0000-4000-8000-${String(version).padStart(12, '0')}`;
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
            opId: normalizedOpId,
        },
    };
}

function pushBatch() {
    return {
        scope: { workspaceId: 'ws-1' },
        ops: [
            {
                id: 'pending-1',
                tableName: 'messages',
                operation: 'delete' as const,
                pk: 'message-1',
                stamp: {
                    deviceId: 'device-1',
                    opId: 'a1b2c3d4-5678-4abc-8def-123456789001',
                    hlc: '1:0:device-1',
                    clock: 1,
                },
                createdAt: 1,
                attempts: 0,
                status: 'pending' as const,
            },
        ],
    };
}

describe('GatewaySyncProvider', () => {
    let originalFetch: unknown;

    beforeEach(() => {
        vi.useFakeTimers();
        originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
        hookState.doAction.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    });

    it.each([
        [{ message: 'Readable sync failure' }, 'Readable sync failure'],
        [{ error: 'Fallback sync failure' }, 'Fallback sync failure'],
        [{ error: { message: 'Nested sync failure' } }, 'Nested sync failure'],
    ])('extracts user-facing JSON errors from failed requests', async (body, expected) => {
        (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
            makeErrorResponse(500, body)
        );

        await expect(
            createGatewaySyncProvider().pull({
                scope: { workspaceId: 'ws-1' },
                cursor: 0,
                limit: 10,
            })
        ).rejects.toThrow(expected);
    });

    it('removes stack and source-location lines from failed requests', async () => {
        (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
            makeErrorResponse(
                500,
                'Sync failed\n    at pull (/app/sync.ts:42:7)\n/app/provider.js:9:2\nRetry later'
            )
        );

        await expect(
            createGatewaySyncProvider().pull({
                scope: { workspaceId: 'ws-1' },
                cursor: 0,
                limit: 10,
            })
        ).rejects.toThrow(
            '[gateway-sync] /api/sync/pull failed (500): Sync failed Retry later'
        );
    });

    it('redacts credentials before exposing failed request text', async () => {
        const secrets = [
            'Bearer header.payload.signature',
            'sk-or-v1-abcdefghijklmno',
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
            'password=hunter2',
            'apiKey:super-secret-key',
            'Authorization: Basic dXNlcjpwYXNz',
        ];
        (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
            makeErrorResponse(500, { message: secrets.join(' ') })
        );

        const request = createGatewaySyncProvider().pull({
            scope: { workspaceId: 'ws-1' },
            cursor: 0,
            limit: 10,
        });
        const error = await request.catch((reason: unknown) => reason);
        const message = error instanceof Error ? error.message : String(error);

        expect(message).toContain('[REDACTED]');
        for (const secret of secrets) {
            expect(message).not.toContain(secret);
        }
        expect(message).not.toContain('dXNlcjpwYXNz');
    });

    it('truncates sanitized failed request text to 200 characters', async () => {
        const longMessage = 'x'.repeat(250);
        (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
            makeErrorResponse(500, { message: longMessage })
        );

        await expect(
            createGatewaySyncProvider().pull({
                scope: { workspaceId: 'ws-1' },
                cursor: 0,
                limit: 10,
            })
        ).rejects.toThrow(
            `[gateway-sync] /api/sync/pull failed (500): ${'x'.repeat(200)}`
        );
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

    it('requests bounded materialized snapshot pages through the gateway', async () => {
        const response: SnapshotResponse = {
            workspaceId: 'ws-1',
            snapshotId: 'snapshot-1',
            highWatermark: 42,
            items: [],
            nextPageToken: null,
        };
        const fetchMock = vi.fn(async () => makeOkResponse(response));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const provider = createGatewaySyncProvider({ baseUrl: 'https://sync.example.test' });

        await expect(provider.snapshot?.({
            scope: { workspaceId: 'ws-1' },
            pageSize: 50,
            pageToken: 'opaque-page',
            tables: ['messages'],
        })).resolves.toEqual(response);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://sync.example.test/api/sync/snapshot',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                body: JSON.stringify({
                    scope: { workspaceId: 'ws-1' },
                    pageSize: 50,
                    pageToken: 'opaque-page',
                    tables: ['messages'],
                }),
            })
        );
    });

    it('honors Retry-After seconds before the next subscription pull', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                makeErrorResponse(429, 'rate limited', { 'Retry-After': '4' })
            )
            .mockResolvedValue(
                makeOkResponse({ changes: [], nextCursor: 0, hasMore: false })
            );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 100 });
        const unsubscribe = await provider.subscribe(
            { workspaceId: 'ws-1' },
            ['messages'],
            () => undefined,
            { cursor: 0, limit: 10 }
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        unsubscribe();
    });

    it('recovers polling after a transient Convex gateway outage', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onChanges = vi.fn();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                makeErrorResponse(503, 'Convex temporarily unavailable')
            )
            .mockResolvedValueOnce(
                makeOkResponse({
                    changes: [change(1, 'op-1')],
                    nextCursor: 1,
                    hasMore: false,
                })
            );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 100 });
        const unsubscribe = await provider.subscribe(
            { workspaceId: 'ws-1' },
            ['messages'],
            onChanges,
            { cursor: 0, limit: 10 }
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onChanges).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onChanges).toHaveBeenCalledWith([
            expect.objectContaining({ serverVersion: 1 }),
        ]);
        unsubscribe();
    });

    it('honors Retry-After HTTP dates and caps excessive delays', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const retryAt = new Date(Date.now() + 60_000).toUTCString();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                makeErrorResponse(429, 'rate limited', { 'Retry-After': retryAt })
            )
            .mockResolvedValue(
                makeOkResponse({ changes: [], nextCursor: 0, hasMore: false })
            );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({
            pollIntervalMs: 100,
            maxRetryAfterMs: 2000,
        });
        const unsubscribe = await provider.subscribe(
            { workspaceId: 'ws-1' },
            ['messages'],
            () => undefined,
            { cursor: 0, limit: 10 }
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        unsubscribe();
    });

    it('cancels a pending Retry-After delay on unsubscribe', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const fetchMock = vi.fn(async () =>
            makeErrorResponse(429, 'rate limited', { 'Retry-After': '4' })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const provider = createGatewaySyncProvider({ pollIntervalMs: 100 });
        const unsubscribe = await provider.subscribe(
            { workspaceId: 'ws-1' },
            ['messages'],
            () => undefined,
            { cursor: 0, limit: 10 }
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        unsubscribe();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            'malformed shape',
            { changes: 'invalid', nextCursor: 1, hasMore: false },
        ],
        [
            'missing operation ID',
            {
                changes: [
                    {
                        ...change(2, 'op-2'),
                        stamp: {
                            clock: 1,
                            hlc: '2:0:device-1',
                            deviceId: 'device-1',
                        },
                    },
                ],
                nextCursor: 2,
                hasMore: false,
            },
        ],
        [
            'regressing cursor',
            { changes: [], nextCursor: 0, hasMore: false },
        ],
        [
            'non-advancing hasMore cursor',
            { changes: [], nextCursor: 1, hasMore: true },
        ],
        [
            'unordered changes',
            {
                changes: [change(3, 'op-3'), change(2, 'op-2')],
                nextCursor: 3,
                hasMore: false,
            },
        ],
    ])('rejects successful pull responses with %s', async (_label, body) => {
        const fetchMock = vi.fn(async () => makeOkResponse(body));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const provider = createGatewaySyncProvider();

        await expect(
            provider.pull({
                scope: { workspaceId: 'ws-1' },
                cursor: 1,
                limit: 10,
            })
        ).rejects.toThrow('invalid response');
    });

    it('does not deliver malformed subscription pulls to onChanges', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const fetchMock = vi.fn(async () =>
            makeOkResponse({
                changes: [change(2, 'op-2'), change(1, 'op-1')],
                nextCursor: 2,
                hasMore: false,
            })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const onChanges = vi.fn();
        const provider = createGatewaySyncProvider({ pollIntervalMs: 10 });
        const unsubscribe = await provider.subscribe(
            { workspaceId: 'ws-1' },
            ['messages'],
            onChanges,
            { cursor: 0, limit: 10 }
        );

        await vi.advanceTimersByTimeAsync(10);

        expect(onChanges).not.toHaveBeenCalled();
        unsubscribe();
    });

    it.each([
        ['missing', { results: [], serverVersion: 1 }],
        [
            'duplicate',
            {
                results: [
                    {
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789001',
                        success: true,
                        serverVersion: 1,
                    },
                    {
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789001',
                        success: true,
                        serverVersion: 1,
                    },
                ],
                serverVersion: 1,
            },
        ],
    ])('rejects successful push responses with %s operation IDs', async (_label, body) => {
        const fetchMock = vi.fn(async () => makeOkResponse(body));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const provider = createGatewaySyncProvider();

        await expect(provider.push(pushBatch())).rejects.toThrow(
            'invalid response'
        );
    });

    it('keeps an outbox operation pending when a successful gateway push omits its result', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetchMock = vi.fn(async () =>
            makeOkResponse({ results: [], serverVersion: 1 })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const pending = pushBatch().ops[0]!;
        const pendingOps = createPendingOpsTable([pending]);
        const outbox = new OutboxManager(
            createMockDb({ pending_ops: pendingOps }) as never,
            createGatewaySyncProvider(),
            { workspaceId: 'ws-1' },
            { retryDelays: [100, 200] }
        );

        await outbox.flush();

        expect(pendingOps.__rows.get(pending.id)).toMatchObject({
            id: pending.id,
            status: 'retry_wait',
            attempts: 1,
        });
    });

    it.each([
        [
            'wrong workspace',
            {
                workspaceId: 'ws-other',
                snapshotId: 'snapshot-1',
                highWatermark: 1,
                items: [],
                nextPageToken: null,
            },
        ],
        [
            'unordered items',
            {
                workspaceId: 'ws-1',
                snapshotId: 'snapshot-1',
                highWatermark: 1,
                items: [
                    {
                        kind: 'row',
                        tableName: 'threads',
                        pk: 'thread-1',
                        payload: {},
                        revision: {
                            clock: 1,
                            hlc: '1:0:d',
                            opId: 'op-thread',
                        },
                    },
                    {
                        kind: 'row',
                        tableName: 'messages',
                        pk: 'message-1',
                        payload: {},
                        revision: {
                            clock: 1,
                            hlc: '1:0:d',
                            opId: 'op-message',
                        },
                    },
                ],
                nextPageToken: null,
            },
        ],
    ])('rejects successful snapshot responses with %s', async (_label, body) => {
        const fetchMock = vi.fn(async () => makeOkResponse(body));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        const provider = createGatewaySyncProvider();

        await expect(
            provider.snapshot?.({
                scope: { workspaceId: 'ws-1' },
                pageSize: 10,
            })
        ).rejects.toThrow('invalid response');
    });
});
