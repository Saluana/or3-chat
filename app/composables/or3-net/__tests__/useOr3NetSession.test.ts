import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, reactive, ref } from 'vue';

const activeWorkspaceId = ref<string | null>('ws-1');
const route = reactive({ params: { id: 'thread-1' } });
const listSessionsMock = vi.fn();

vi.mock('#imports', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#imports')>();
    return {
        ...actual,
        useRoute: () => route,
    };
});

vi.mock('../useOr3NetAuth', () => ({
    useOr3NetAuth: () => ({
        isConfigured: computed(() => true),
    }),
}));

vi.mock('../useOr3NetClient', () => ({
    useOr3NetClient: () => ({
        listSessions: listSessionsMock,
    }),
}));

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId }),
}));

describe('useOr3NetSession', () => {
    beforeEach(() => {
        vi.resetModules();
        listSessionsMock.mockReset();
        activeWorkspaceId.value = 'ws-1';
        route.params.id = 'thread-1';
    });

    it('resolves the persisted network session for the active chat thread', async () => {
        listSessionsMock.mockResolvedValue({
            items: [
                {
                    network_session_id: 'sess-1',
                    workspace_id: 'ws-1',
                    client_kind: 'chat',
                    client_session_id: 'thread-1',
                    intern_session_key: 'svc:sess-1',
                    status: 'active',
                    created_at: '2026-04-01T00:00:00.000Z',
                    updated_at: '2026-04-01T00:00:00.000Z',
                    last_activity_at: '2026-04-01T00:00:00.000Z',
                },
            ],
        });

        const { useOr3NetSession } = await import('../useOr3NetSession');
        const session = useOr3NetSession();
        const resolved = await session.refresh({ force: true });

        expect(resolved?.network_session_id).toBe('sess-1');
        expect(session.networkSessionId.value).toBe('sess-1');
        expect(listSessionsMock).toHaveBeenCalledWith(
            'ws-1',
            expect.any(URLSearchParams)
        );
    });

    it('invalidates the bound session when the active thread changes', async () => {
        listSessionsMock.mockResolvedValue({
            items: [
                {
                    network_session_id: 'sess-1',
                    workspace_id: 'ws-1',
                    client_kind: 'chat',
                    client_session_id: 'thread-1',
                    intern_session_key: 'svc:sess-1',
                    status: 'active',
                    created_at: '2026-04-01T00:00:00.000Z',
                    updated_at: '2026-04-01T00:00:00.000Z',
                    last_activity_at: '2026-04-01T00:00:00.000Z',
                },
            ],
        });

        const { useOr3NetSession } = await import('../useOr3NetSession');
        const session = useOr3NetSession();
        await session.refresh({ force: true });

        route.params.id = 'thread-2';
        await nextTick();

        expect(session.networkSessionId.value).toBeNull();
        expect(session.session.value).toBeNull();
    });

    it('uses filtered session queries and ignores stale thread responses', async () => {
        type SessionListPayload = {
            items: Array<{
                network_session_id: string;
                workspace_id: string;
                client_kind: string;
                client_session_id: string;
                intern_session_key: string;
                status: string;
                created_at: string;
                updated_at: string;
                last_activity_at: string;
            }>;
        };

        const deferred: { resolve?: (value: SessionListPayload) => void } = {};

        listSessionsMock
            .mockImplementationOnce(
                () =>
                    new Promise<SessionListPayload>((resolve) => {
                        deferred.resolve = (value) => {
                            resolve(value);
                        };
                    })
            )
            .mockResolvedValueOnce({
                items: [
                    {
                        network_session_id: 'sess-2',
                        workspace_id: 'ws-1',
                        client_kind: 'chat',
                        client_session_id: 'thread-2',
                        intern_session_key: 'svc:sess-2',
                        status: 'active',
                        created_at: '2026-04-01T00:00:00.000Z',
                        updated_at: '2026-04-01T00:00:00.000Z',
                        last_activity_at: '2026-04-01T00:00:00.000Z',
                    },
                ],
            });

        const { useOr3NetSession } = await import('../useOr3NetSession');
        const session = useOr3NetSession();
        const firstRequest = session.refresh({ force: true }).catch(() => null);

        route.params.id = 'thread-2';
        await nextTick();
        await session.refresh({ force: true });

        deferred.resolve?.({
                items: [
                    {
                        network_session_id: 'sess-1',
                        workspace_id: 'ws-1',
                        client_kind: 'chat',
                        client_session_id: 'thread-1',
                        intern_session_key: 'svc:sess-1',
                        status: 'active',
                        created_at: '2026-04-01T00:00:00.000Z',
                        updated_at: '2026-04-01T00:00:00.000Z',
                        last_activity_at: '2026-04-01T00:00:00.000Z',
                    },
                ],
            });
        await firstRequest;

        expect((listSessionsMock.mock.calls[0]?.[1] as URLSearchParams).get('client_session_id')).toBe('thread-1');
        expect((listSessionsMock.mock.calls[1]?.[1] as URLSearchParams).get('client_session_id')).toBe('thread-2');
        expect(session.networkSessionId.value).toBe('sess-2');
    });
});
