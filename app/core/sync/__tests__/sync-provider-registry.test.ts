import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    _clearProviders,
    getActiveSyncProvider,
    getAllSyncProviders,
    getSyncProvider,
    registerSyncProvider,
    setActiveSyncProvider,
    unregisterSyncProvider,
} from '../sync-provider-registry';

function makeProvider(id: string) {
    return {
        id,
        mode: 'gateway' as const,
        subscribe: vi.fn(async () => vi.fn()),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
    };
}

describe('sync-provider-registry', () => {
    beforeEach(() => {
        _clearProviders();
    });

    it('registers providers and warns on overwrite', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        registerSyncProvider(makeProvider('a') as any);
        registerSyncProvider(makeProvider('a') as any);

        expect(warnSpy).toHaveBeenCalledWith('[SyncProviderRegistry] Overwriting provider: a');
    });

    it('sets and gets active provider', () => {
        const a = makeProvider('a');
        const b = makeProvider('b');
        registerSyncProvider(a as any);
        registerSyncProvider(b as any);

        setActiveSyncProvider('b');

        expect(getActiveSyncProvider()).toBe(b);
        expect(getSyncProvider('a')).toBe(a);
    });

    it('falls back to first provider when active is not set', () => {
        const a = makeProvider('a');
        const b = makeProvider('b');
        registerSyncProvider(a as any);
        registerSyncProvider(b as any);

        expect(getActiveSyncProvider()).toBe(a);
    });

    it('throws when setting unknown active provider', () => {
        expect(() => setActiveSyncProvider('missing')).toThrow('Unknown provider');
    });

    it('unregister clears active provider when removed', () => {
        const a = makeProvider('a');
        registerSyncProvider(a as any);
        setActiveSyncProvider('a');

        unregisterSyncProvider('a');

        expect(getActiveSyncProvider()).toBeNull();
    });

    it('_clearProviders resets all global state', () => {
        registerSyncProvider(makeProvider('a') as any);
        registerSyncProvider(makeProvider('b') as any);
        setActiveSyncProvider('a');

        _clearProviders();

        expect(getAllSyncProviders()).toEqual([]);
        expect(getActiveSyncProvider()).toBeNull();
    });
});
