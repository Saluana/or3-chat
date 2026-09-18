import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue';
import { useLibraryLink, type LibraryLinkStatus } from '../useLibraryLink';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

interface TestSession {
    session: { user: { id: string } } | null;
}

const sessionHolder = vi.hoisted(() => ({ ref: null as unknown as Ref<TestSession> }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => {
        sessionHolder.ref ??= ref<TestSession>({ session: { user: { id: 'user-1' } } });
        return { data: sessionHolder.ref };
    },
}));

function setUser(id: string): void {
    // The mocked composable creates its ref on first use; the helper may run
    // before any component has called it.
    if (!sessionHolder.ref) {
        sessionHolder.ref = ref<TestSession>({ session: { user: { id } } });
        return;
    }
    sessionHolder.ref.value = { session: { user: { id } } };
}

function status(overrides: Partial<LibraryLinkStatus> = {}): LibraryLinkStatus {
    return { configured: true, state: 'unlinked', ...overrides };
}

function linkedStatus(): LibraryLinkStatus {
    return status({
        state: 'linked',
        link: {
            id: 'lnk_1',
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
            scopes: ['library:read', 'downloads:acquire'],
            expiresAt: '2026-12-16T00:00:00.000Z',
        },
    });
}

/**
 * An effect scope must stay alive for the duration of the test: stopping it
 * immediately (as a naive helper would) marks the composable disposed and
 * cancels every request, which is exactly the teardown behaviour one of these
 * tests asserts.
 */
const liveScopes: EffectScope[] = [];
beforeEach(() => {
    setUser('user-1');
});
afterEach(() => {
    for (const scope of liveScopes.splice(0)) scope.stop();
});

function withScope<T>(run: () => T): T {
    const scope = effectScope();
    liveScopes.push(scope);
    return scope.run(run) as T;
}

describe('useLibraryLink', () => {
    it('loads the caller’s own link state and keeps credential fields out of state', async () => {
        fetchMock.mockReset().mockResolvedValue({
            ...linkedStatus(),
            // A compromised or buggy server must not leak these into the UI.
            token: 'lkl_should_never_matter',
            secret: 'pss_should_never_matter',
        });

        const library = withScope(() => useLibraryLink());
        await library.load();

        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/library/link');
        expect(library.state.value).toBe('linked');
        expect(library.link.value?.label).toBe('or3.example.test');
        expect(JSON.stringify(library.status.value)).not.toContain('lkl_');
        expect(JSON.stringify(library.status.value)).not.toContain('pss_');
    });

    it('polls a pending pairing on the interval the server reported, then stops when terminal', async () => {
        vi.useFakeTimers();
        try {
            fetchMock.mockReset();
            fetchMock
                .mockResolvedValueOnce(
                    status({
                        state: 'pending',
                        pairing: {
                            code: 'ABCD-EFGH',
                            verificationUrl: 'https://marketplace.example.test/link?code=ABCD-EFGH',
                            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                            retryAfterMs: 5_000,
                        },
                    })
                )
                .mockResolvedValueOnce(status({ state: 'unlinked' }));

            const library = withScope(() => useLibraryLink());
            await library.load();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(4_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1_100);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(library.state.value).toBe('unlinked');

            await vi.advanceTimersByTimeAsync(60_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps retrying an unconfirmed revocation while the page is open', async () => {
        vi.useFakeTimers();
        try {
            fetchMock.mockReset();
            fetchMock
                .mockResolvedValueOnce(status({ state: 'revoked', centralRevokePending: true }))
                .mockResolvedValueOnce(status({ state: 'revoked' }));

            const library = withScope(() => useLibraryLink());
            await library.load();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // Disconnect stopped the pairing schedule, but the revocation is
            // still open, so "retried automatically" must stay true.
            await vi.advanceTimersByTimeAsync(59_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(2_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(library.status.value?.centralRevokePending).toBeUndefined();

            await vi.advanceTimersByTimeAsync(120_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('resets state and discards in-flight responses when the local user changes', async () => {
        fetchMock.mockReset();
        let resolveFirst: (value: unknown) => void = () => undefined;
        fetchMock
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce(status({ state: 'unlinked' }));

        const library = withScope(() => useLibraryLink());
        const inFlight = library.load();

        // The first user's response is still in flight when the session switches
        // to another local user on the same workspace.
        setUser('user-2');
        await nextTick();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        resolveFirst(linkedStatus());
        await inFlight;
        await nextTick();

        // The previous user's link must never be displayed for the new user.
        expect(library.state.value).toBe('unlinked');
        expect(library.link.value).toBeNull();
    });

    it('stops scheduling once the page is disposed, even mid-request', async () => {
        vi.useFakeTimers();
        try {
            fetchMock.mockReset();
            let resolveSecond: (value: unknown) => void = () => undefined;
            fetchMock
                .mockResolvedValueOnce(status({ state: 'unlinked' }))
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveSecond = resolve;
                        })
                );

            const scope = effectScope();
            liveScopes.push(scope);
            const library = scope.run(() => useLibraryLink())!;
            await library.load();

            const inFlight = library.load();
            scope.stop();
            resolveSecond(
                status({
                    state: 'pending',
                    pairing: {
                        code: 'ABCD-EFGH',
                        verificationUrl: 'https://marketplace.example.test/link?code=ABCD-EFGH',
                        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                        retryAfterMs: 1_000,
                    },
                })
            );
            await inFlight;

            await vi.advanceTimersByTimeAsync(30_000);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('surfaces a structured failure without dropping the last known state', async () => {
        fetchMock.mockReset().mockRejectedValue({
            data: { error: { code: 'central-unreachable', message: 'down', retryable: true } },
        });
        const library = withScope(() => useLibraryLink());
        await library.load();
        expect(library.failure.value).toEqual({
            code: 'central-unreachable',
            message: 'down',
            retryable: true,
        });
    });

    it('connects and disconnects through the local server only', async () => {
        fetchMock.mockReset().mockResolvedValue(status({ state: 'pending' }));
        const library = withScope(() => useLibraryLink());
        await library.connect();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/plugins/library/link', {
            method: 'POST',
        });

        fetchMock.mockResolvedValue(status({ state: 'revoked', centralRevokePending: true }));
        await library.disconnect();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/plugins/library/link/disconnect', {
            method: 'POST',
        });
        expect(library.state.value).toBe('revoked');
        expect(library.status.value?.centralRevokePending).toBe(true);
    });
});
