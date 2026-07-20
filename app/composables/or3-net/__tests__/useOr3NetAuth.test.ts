import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { testRuntimeConfig } from '~~/tests/setup';

const fetchMock = vi.fn();
const activeWorkspaceId = ref<string | null>('ws-1');

vi.mock('ofetch', () => ({
    $fetch: fetchMock,
}));

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId }),
}));

describe('useOr3NetAuth', () => {
    beforeEach(() => {
        vi.resetModules();
        fetchMock.mockReset();
        activeWorkspaceId.value = 'ws-1';
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                ssrAuthEnabled: true,
                or3Net: {
                    enabled: true,
                    hostUrl: 'https://net.test',
                },
            },
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('exchanges a token through the local SSR adapter', async () => {
        fetchMock.mockResolvedValue({
            token: 'token-1',
            workspace_id: 'ws-1',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: ['jobs:read', 'jobs:write'],
        });

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        const response = await auth.refresh();

        expect(response?.token).toBe('token-1');
        expect(fetchMock).toHaveBeenCalledWith('/api/or3-net/exchange', {
            method: 'POST',
            body: { workspace_id: 'ws-1' },
            cache: 'no-store',
        });
        expect(auth.token.value).toBe('token-1');
        expect(auth.workspaceId.value).toBe('ws-1');
    });

    it('invalidates the cached token when the workspace changes', async () => {
        fetchMock.mockResolvedValue({
            token: 'token-1',
            workspace_id: 'ws-1',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: ['jobs:read'],
        });

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        await auth.refresh();

        activeWorkspaceId.value = 'ws-2';
        await nextTick();

        expect(auth.token.value).toBeNull();
        expect(auth.workspaceId.value).toBeNull();
    });

    it('ignores stale exchange responses after a workspace switch', async () => {
        type ExchangePayload = {
            token: string;
            workspace_id: string;
            expires_at: string;
            scopes: string[];
        };

        const deferred: { resolve?: (value: ExchangePayload) => void } = {};

        fetchMock.mockImplementationOnce(
            () =>
                new Promise<ExchangePayload>((resolve) => {
                    deferred.resolve = (value) => {
                        resolve(value);
                    };
                })
        );
        fetchMock.mockResolvedValueOnce({
            token: 'token-2',
            workspace_id: 'ws-2',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: ['jobs:read'],
        });

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        const firstRequest = auth.refresh().catch(() => null);

        activeWorkspaceId.value = 'ws-2';
        await nextTick();
        await auth.refresh();

        deferred.resolve?.({
                token: 'token-1',
                workspace_id: 'ws-1',
                expires_at: '2099-01-01T00:00:00.000Z',
                scopes: ['jobs:read'],
            });
        await firstRequest;

        expect(auth.token.value).toBe('token-2');
        expect(auth.workspaceId.value).toBe('ws-2');
    });

    it('refreshes tokens that are close to expiry', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
        fetchMock
            .mockResolvedValueOnce({
                token: 'token-1',
                workspace_id: 'ws-1',
                expires_at: '2026-04-01T00:00:10.000Z',
                scopes: ['jobs:read'],
            })
            .mockResolvedValueOnce({
                token: 'token-2',
                workspace_id: 'ws-1',
                expires_at: '2026-04-01T00:01:00.000Z',
                scopes: ['jobs:read'],
            });

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        await auth.refresh();

        await expect(auth.getAccessToken()).resolves.toBe('token-2');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(auth.token.value).toBe('token-2');
    });

    it('clears pending state immediately when the workspace changes mid-exchange', async () => {
        type ExchangePayload = {
            token: string;
            workspace_id: string;
            expires_at: string;
            scopes: string[];
        };

        const deferred: { resolve?: (value: ExchangePayload) => void } = {};
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<ExchangePayload>((resolve) => {
                    deferred.resolve = resolve;
                })
        );

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        const pendingRequest = auth.refresh();

        expect(auth.pending.value).toBe(true);

        activeWorkspaceId.value = 'ws-2';
        await nextTick();

        expect(auth.pending.value).toBe(false);

        deferred.resolve?.({
            token: 'token-1',
            workspace_id: 'ws-1',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: ['jobs:read'],
        });

        await expect(pendingRequest).resolves.toBeNull();
        expect(auth.pending.value).toBe(false);
    });

    it('stays inactive when OR3 Net is disabled', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                or3Net: {
                    enabled: false,
                    hostUrl: '',
                },
            },
        };

        const { useOr3NetAuth } = await import('../useOr3NetAuth');
        const auth = useOr3NetAuth();
        await expect(auth.getAccessToken()).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
