import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    activeDbName: 'or3-db-a',
    kvByDb: new Map([['or3-db-b', 'theme-b']]),
    resolvers: new Map(),
    setCalls: [],
}));

vi.mock('~/db/client', () => ({
    getDb: () => ({ name: state.activeDbName }),
}));

vi.mock('~/db/kv', () => ({
    getKvByName: vi.fn(async (key: string, db?: { name: string }) => {
        const dbName = db?.name ?? state.activeDbName;
        if (dbName === 'or3-db-a' && !state.kvByDb.has('or3-db-a')) {
            // Delayed first load for A; resolves when the test releases it.
            await new Promise<any>((resolve) => {
                state.resolvers.set('load-a', resolve);
            });
        }
        const value = state.kvByDb.get(dbName);
        return value ? { value } : undefined;
    }),
    setKvByName: vi.fn(async (key: string, value: string | null, db?: { name: string }) => {
        state.setCalls.push({ key, value, dbName: db?.name ?? state.activeDbName });
        return { id: `kv:${key}` };
    }),
}));

import {
    __resetThemeSelectionForTests,
    useThemeSelection,
} from '../useThemeSelection';

describe('useThemeSelection workspace ownership', () => {
    beforeEach(() => {
        state.activeDbName = 'or3-db-a';
        state.kvByDb = new Map([['or3-db-b', 'theme-b']]);
        state.resolvers.clear();
        state.setCalls.length = 0;
        vi.clearAllMocks();
        __resetThemeSelectionForTests();
    });

    it('discards a stale load from A after B becomes active', async () => {
        const api = useThemeSelection();
        // Start A's load (pends on the deferred resolver).
        const loadA = api.ensureLoaded();
        await Promise.resolve();
        // Switch to B before A resolves; B loads immediately.
        state.activeDbName = 'or3-db-b';
        await api.ensureLoaded();
        expect(api.selectedTheme.value).toBe('theme-b');

        // A's delayed read finally completes with a conflicting value.
        state.kvByDb.set('or3-db-a', 'theme-a');
        state.resolvers.get('load-a')?.({ value: 'theme-a' });
        await loadA;
        await Promise.resolve();

        // B's selection must survive the stale completion.
        expect(api.selectedTheme.value).toBe('theme-b');
    });

    it('saves to the captured database instead of the newly active one', async () => {
        const api = useThemeSelection();
        // Admit the save while A is active; its load pends.
        state.activeDbName = 'or3-db-a';
        const save = api.setSelectedTheme('theme-a-new');
        await Promise.resolve();
        // Switch before the queued write executes.
        state.activeDbName = 'or3-db-b';
        state.resolvers.get('load-a')?.(undefined);
        await save;

        const themeWrites = state.setCalls.filter((c) => c.key === 'theme_selection');
        expect(themeWrites.length).toBeGreaterThan(0);
        for (const write of themeWrites) {
            expect(write.dbName).toBe('or3-db-a');
        }
        expect(
            themeWrites.some((w) => w.dbName === 'or3-db-b')
        ).toBe(false);
    });
});
