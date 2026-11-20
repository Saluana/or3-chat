import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const fetchMock = vi.hoisted(() => vi.fn());
const recoverClientSessionMock = vi.hoisted(() => vi.fn(async () => false));
const sessionState = ref<unknown>(null);

type TestPayload = {
    session: null | {
        authenticated: boolean;
        workspace: { id: string };
    };
    appAccessAllowed: boolean;
};

vi.mock('ofetch', () => ({
    $fetch: fetchMock,
}));

vi.mock('~/composables/auth/useClientSessionRecovery', () => ({
    recoverClientSession: recoverClientSessionMock,
}));

vi.mock('nuxt/app', () => ({
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: true } }),
    useState: () => sessionState,
    useFetch: vi.fn(),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('useSessionContext refresh generations', () => {
    beforeEach(() => {
        vi.resetModules();
        fetchMock.mockReset();
        recoverClientSessionMock.mockReset().mockResolvedValue(false);
        sessionState.value = { session: null, appAccessAllowed: false };
    });

    it('shares overlapping startup validation across session consumers', async () => {
        const response = deferred<TestPayload>();
        fetchMock.mockRejectedValueOnce(new Error('offline')).mockReturnValue(response.promise);
        const { useSessionContext } = await import('../useSessionContext');
        const first = useSessionContext({ autoLoad: false });
        const second = useSessionContext({ autoLoad: false });
        await expect(second.refresh()).rejects.toThrow('offline');
        const startup = first.refresh({ dedupe: 'defer' });
        const lockPage = second.refresh({ dedupe: 'defer' });
        expect(second.pending.value).toBe(true);
        expect(second.error.value).toBeNull();
        const payload = { session: null, appAccessAllowed: false };
        response.resolve(payload);

        await expect(Promise.all([startup, lockPage])).resolves.toEqual([payload, payload]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(second.pending.value).toBe(false);
        expect(second.error.value).toBeNull();
        expect(second.data.value).toEqual(payload);
    });

    it('keeps a reload-bound session out of the shared state', async () => {
        const payload = {
            session: { authenticated: true, workspace: { id: 'signed-in' } },
            appAccessAllowed: true,
        };
        fetchMock.mockResolvedValue(payload);
        const { useSessionContext } = await import('../useSessionContext');
        const context = useSessionContext();

        await expect(context.refresh({ shouldCommit: () => false })).resolves.toEqual(payload);
        expect(context.data.value?.session).toBeNull();
    });

    it('ignores an older response that completes after a newer workspace refresh', async () => {
        const older = deferred<TestPayload>();
        const newer = deferred<TestPayload>();
        fetchMock
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const { useSessionContext } = await import('../useSessionContext');
        const context = useSessionContext();
        const olderRefresh = context.refresh();
        const newerRefresh = context.refresh();

        newer.resolve({
            session: { authenticated: true, workspace: { id: 'workspace-new' } },
            appAccessAllowed: true,
        });
        await newerRefresh;
        older.resolve({
            session: { authenticated: true, workspace: { id: 'workspace-old' } },
            appAccessAllowed: true,
        });

        await expect(olderRefresh).resolves.toBeUndefined();
        expect(context.data.value?.session?.workspace?.id).toBe('workspace-new');
    });

    it('does not let a stale authenticated response overwrite a newer sign-out', async () => {
        const signedIn = deferred<TestPayload>();
        const signedOut = deferred<TestPayload>();
        fetchMock
            .mockReturnValueOnce(signedIn.promise)
            .mockReturnValueOnce(signedOut.promise);

        const { useSessionContext } = await import('../useSessionContext');
        const context = useSessionContext();
        const staleRefresh = context.refresh();
        const signOutRefresh = context.refresh();

        signedOut.resolve({ session: null, appAccessAllowed: false });
        await signOutRefresh;
        signedIn.resolve({
            session: { authenticated: true, workspace: { id: 'workspace-old' } },
            appAccessAllowed: true,
        });
        await staleRefresh;

        expect(context.data.value).toEqual({
            session: null,
            appAccessAllowed: false,
        });
        expect(context.pending.value).toBe(false);
    });

    it('does not publish an error from a superseded request', async () => {
        const older = deferred<TestPayload>();
        const newer = deferred<TestPayload>();
        fetchMock
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const { useSessionContext } = await import('../useSessionContext');
        const context = useSessionContext();
        const staleRefresh = context.refresh();
        const currentRefresh = context.refresh();

        newer.resolve({ session: null, appAccessAllowed: false });
        await currentRefresh;
        older.reject(Object.assign(new Error('Too many requests'), { status: 429 }));
        await expect(staleRefresh).resolves.toBeUndefined();

        expect(context.error.value).toBeNull();
        expect(context.pending.value).toBe(false);
    });

    it('lets a deferred validation follow the refresh that superseded it', async () => {
        const older = deferred<TestPayload>();
        const newer = deferred<TestPayload>();
        fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const { useSessionContext } = await import('../useSessionContext');
        const guard = useSessionContext();
        const validation = guard.refresh({ dedupe: 'defer' });
        const winner = useSessionContext().refresh();
        older.resolve({ session: { authenticated: true, workspace: { id: 'old' } }, appAccessAllowed: true });
        const payload = { session: null, appAccessAllowed: false };
        newer.resolve(payload);

        await expect(validation).resolves.toEqual(payload);
        await winner;
        expect(guard.pending.value).toBe(false);
    });

    it('retries session fetch after successful provider recovery', async () => {
        recoverClientSessionMock.mockResolvedValue(true);
        fetchMock
            .mockResolvedValueOnce({ session: null, appAccessAllowed: false })
            .mockResolvedValueOnce({
                session: {
                    authenticated: true,
                    workspace: { id: 'workspace-recovered' },
                },
                appAccessAllowed: true,
            });

        const { useSessionContext } = await import('../useSessionContext');
        const context = useSessionContext();
        await context.refresh();

        expect(recoverClientSessionMock).toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(context.data.value?.session?.workspace?.id).toBe('workspace-recovered');
    });
});
