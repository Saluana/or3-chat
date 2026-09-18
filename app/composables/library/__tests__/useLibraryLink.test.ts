import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useLibraryLink, type LibraryLinkStatus } from '../useLibraryLink';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

function status(overrides: Partial<LibraryLinkStatus> = {}): LibraryLinkStatus {
    return { configured: true, state: 'unlinked', ...overrides };
}

function withScope<T>(run: () => T): T {
    const scope = effectScope();
    try {
        return scope.run(run) as T;
    } finally {
        scope.stop();
    }
}

describe('useLibraryLink', () => {
    it('loads the caller’s own link state and keeps credential fields out of state', async () => {
        fetchMock.mockReset().mockResolvedValue(
            status({
                state: 'linked',
                link: {
                    id: 'lnk_1',
                    label: 'or3.example.test',
                    origin: 'https://or3.example.test',
                    scopes: ['library:read', 'downloads:acquire'],
                    expiresAt: '2026-12-16T00:00:00.000Z',
                },
                // A compromised or buggy server must not leak these into the UI.
                token: 'lkl_should_never_matter',
                secret: 'pss_should_never_matter',
            } as unknown as LibraryLinkStatus)
        );

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

            // Terminal states schedule nothing further.
            await vi.advanceTimersByTimeAsync(60_000);
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
