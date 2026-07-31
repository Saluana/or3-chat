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
        const staleRefresh = context.refresh().catch(() => undefined);
        const currentRefresh = context.refresh();

        newer.resolve({ session: null, appAccessAllowed: false });
        await currentRefresh;
        older.reject(new Error('stale failure'));
        await staleRefresh;

        expect(context.error.value).toBeNull();
        expect(context.pending.value).toBe(false);
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
