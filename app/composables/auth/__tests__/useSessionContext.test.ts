import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    afterEach(() => {
        vi.useRealTimers();
        delete (window as unknown as { __or3BootSession?: unknown }).__or3BootSession;
    });
    beforeEach(() => {
        vi.resetModules();
        fetchMock.mockReset();
        recoverClientSessionMock.mockReset().mockResolvedValue(false);
        sessionState.value = { session: null, appAccessAllowed: false };
    });
    it.each(['boot', 'fetch', 'recovery', 'recovered-fetch'] as const)(
        'bounds the entire session check when %s stalls and preserves the cached account',
        async (stage) => {
            vi.useFakeTimers();
            const cached = { session: { authenticated: true, workspace: { id: 'workspace-cached' } }, appAccessAllowed: true };
            sessionState.value = cached;
            const stalled = deferred<TestPayload>();
            const recovery = deferred<boolean>();
            const bootController = new AbortController();
            if (stage === 'boot') {
                (window as unknown as { __or3BootSession?: unknown }).__or3BootSession = {
                    at: Date.now(), response: stalled.promise, controller: bootController,
                };
            } else if (stage === 'fetch') fetchMock.mockReturnValue(stalled.promise);
            else {
                fetchMock.mockImplementationOnce(async () => {
                    await new Promise(resolve => setTimeout(resolve, 4_000));
                    return { session: null, appAccessAllowed: false };
                });
                if (stage === 'recovery') recoverClientSessionMock.mockReturnValue(recovery.promise);
                else {
                    recoverClientSessionMock.mockImplementationOnce(async () => {
                        await new Promise(resolve => setTimeout(resolve, 4_000));
                        return true;
                    });
                    fetchMock.mockReturnValueOnce(stalled.promise);
                }
            }
            const { useSessionContext } = await import('../useSessionContext');
            const context = useSessionContext({ autoLoad: false });
            let failure: unknown;
            let settled = false;
            const refresh = context.refresh().catch(error => { failure = error; }).finally(() => { settled = true; });
            await vi.advanceTimersByTimeAsync(9_999);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe(true);
            await refresh;
            expect(failure).toMatchObject({ name: 'TimeoutError' });
            expect(context.error.value).toBe(failure);
            expect(context.pending.value).toBe(false);
            expect(context.data.value).toEqual(cached);
            if (stage === 'boot') expect(bootController.signal.aborted).toBe(true);
            else expect(fetchMock.mock.calls.at(-1)?.[1].signal.aborted).toBe(true);
            const callsAtDeadline = fetchMock.mock.calls.length;
            stalled.resolve({ session: null, appAccessAllowed: false });
            recovery.resolve(true);
            await vi.advanceTimersByTimeAsync(1);
            expect(context.data.value).toEqual(cached);
            expect(fetchMock).toHaveBeenCalledTimes(callsAtDeadline);
            fetchMock.mockResolvedValue({ session: { authenticated: true, workspace: { id: 'workspace-retry' } }, appAccessAllowed: true });
            await context.refresh();
            expect(context.data.value?.session?.workspace?.id).toBe('workspace-retry');
        }
    );

    it('bounds the head session prefetch even before application initialization', async () => {
        vi.useFakeTimers();
        let requestSignal: AbortSignal | undefined;
        const nativeFetch = vi.fn((_url, init) => {
            requestSignal = init.signal;
            return new Promise<Response>((_resolve, reject) => {
                requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
            });
        });
        const { BOOT_SESSION_SCRIPT, takeBootSession } = await import('~/utils/boot-session');
        new Function('fetch', BOOT_SESSION_SCRIPT)(nativeFetch);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(requestSignal?.aborted).toBe(true);
        await expect(takeBootSession()).resolves.toBeNull();
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

    it.each(['refresh', 'head prefetch'] as const)(
        'retains the workspace and respects Retry-After from %s',
        async (initial) => {
            vi.useFakeTimers();
            const cached = { session: { authenticated: true, workspace: { id: 'accepted' } }, appAccessAllowed: true };
            sessionState.value = cached;
            const response = new Response(null, { status: 429, headers: { 'Retry-After': '7' } });
            let requestsBeforeRetry = 1;
            if (initial === 'head prefetch') {
                const { BOOT_SESSION_SCRIPT } = await import('~/utils/boot-session');
                new Function('fetch', BOOT_SESSION_SCRIPT)(async () => response);
                requestsBeforeRetry = 0;
            } else {
                fetchMock.mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
                    status: 429,
                    response,
                }));
            }
            fetchMock.mockResolvedValue(cached);
            const { useSessionContext } = await import('../useSessionContext');
            const context = useSessionContext({ autoLoad: false });

            await expect(context.refresh()).rejects.toMatchObject({ response: { headers: response.headers } });
            await vi.advanceTimersByTimeAsync(6_999);
            await expect(context.refresh()).rejects.toMatchObject({ response: { headers: response.headers } });
            expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeRetry);
            expect(context.data.value).toEqual(cached);
            await vi.advanceTimersByTimeAsync(1);
            await expect(context.refresh()).resolves.toEqual(cached);
            expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeRetry + 1);
        }
    );

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
