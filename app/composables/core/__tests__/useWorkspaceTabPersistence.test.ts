import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef, type EffectScope } from 'vue';
import type { WorkspaceTabsState } from '~/core/workspace-tabs/types';
import {
    createWorkspaceTabsSnapshot,
    getWorkspaceTabsStorageKey,
    readCorruptWorkspaceTabsBackup,
    readWorkspaceTabsSnapshot,
    useWorkspaceTabPersistence,
    writeWorkspaceTabsSnapshot,
    type WorkspaceTabStorage,
} from '../useWorkspaceTabPersistence';

function state(): WorkspaceTabsState {
    return {
        tabs: [
            {
                id: 'tab-1',
                resource: { kind: 'chat', threadId: 'thread-1' },
                cachedTitle: 'One',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
            {
                id: 'tab-2',
                resource: { kind: 'document', documentId: 'doc-1' },
                cachedTitle: 'Two',
                createdAt: 1,
                lastActivatedAt: 3,
                ephemeral: false,
            },
        ],
        activeTabId: 'tab-2',
        activePaneId: 'pane-b',
        paneBindings: new Map([
            ['pane-a', 'tab-1'],
            ['pane-b', 'tab-2'],
        ]),
        runtime: new Map(),
        recentlyClosed: [],
    };
}

const KEY = getWorkspaceTabsStorageKey('workspace-a', 'standard');
const scopes: EffectScope[] = [];

/** In-memory storage whose failure modes can be switched on per test. */
function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const faults = { read: false, write: false, backup: false };
    const storage: WorkspaceTabStorage = {
        getItem: (key) => {
            if (faults.read) throw new DOMException('Access denied', 'SecurityError');
            return data.get(key) ?? null;
        },
        setItem: (key, value) => {
            if (faults.write || (faults.backup && key.endsWith(':corrupt'))) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            data.set(key, value);
        },
        removeItem: (key) => {
            data.delete(key);
        },
    };
    return { data, faults, storage };
}

function setup(storage: WorkspaceTabStorage | null, onIssue = vi.fn()) {
    const scope = effectScope();
    scopes.push(scope);
    const tabs = shallowRef<WorkspaceTabsState>(state());
    const persistence = scope.run(() =>
        useWorkspaceTabPersistence({
            state: tabs,
            paneIds: () => ['pane-a', 'pane-b'],
            workspaceId: () => 'workspace-a',
            profileId: () => 'standard',
            storage,
            debounceMs: 50,
            onIssue,
        })
    )!;
    return { persistence, tabs, onIssue };
}

/** Changes the active tab and schedules a save, as a committed tab change does. */
function changeLayout(env: ReturnType<typeof setup>, activeTabId: string): void {
    env.tabs.value = { ...state(), activeTabId };
    env.persistence.schedule();
}

describe('workspace tab persistence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        for (const scope of scopes.splice(0)) scope.stop();
        vi.useRealTimers();
    });

    it('scopes local state by workspace and profile', () => {
        expect(getWorkspaceTabsStorageKey('workspace/a', 'writing')).toBe(
            'or3:workspace-tabs:v1:workspace%2Fa:writing'
        );
        expect(getWorkspaceTabsStorageKey(null, null)).toBe(
            'or3:workspace-tabs:v1:local:default'
        );
    });

    it('persists only the tab manifest and restores a valid snapshot', () => {
        const memory = new Map<string, string>();
        const storage = {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => memory.set(key, value),
        };
        const snapshot = createWorkspaceTabsSnapshot(
            state(),
            ['pane-a', 'pane-b'],
            7
        );
        expect(snapshot).toMatchObject({
            activeTabId: 'tab-2',
            visibleTabIds: ['tab-1', 'tab-2'],
            activeVisibleIndex: 1,
            savedAt: 7,
        });
        expect(writeWorkspaceTabsSnapshot(storage, 'tabs', snapshot)).toBe(true);
        expect(readWorkspaceTabsSnapshot(storage, 'tabs')).toEqual({ status: 'ok', snapshot });
    });

    it('safely reports corrupt local storage instead of treating it as missing', () => {
        const storage = { getItem: () => '{not valid JSON' };
        expect(readWorkspaceTabsSnapshot(storage, 'tabs')).toEqual({
            status: 'corrupt',
            reason: 'invalid_json',
            raw: '{not valid JSON',
        });
    });

    it('classifies missing, invalid schema and unreadable storage separately', () => {
        const values: Record<string, string> = {
            schema: JSON.stringify({ schemaVersion: 1, tabs: [] }),
        };
        const storage = { getItem: (key: string) => values[key] ?? null };
        expect(readWorkspaceTabsSnapshot(storage, 'missing')).toEqual({ status: 'missing' });
        expect(readWorkspaceTabsSnapshot(storage, 'schema')).toEqual({
            status: 'corrupt',
            reason: 'invalid_schema',
            raw: values.schema,
        });
        const blocked = {
            getItem: () => {
                throw new DOMException('Access denied', 'SecurityError');
            },
        };
        expect(readWorkspaceTabsSnapshot(blocked, 'tabs')).toMatchObject({ status: 'unavailable' });
    });

    it('treats blocked storage as unavailable without throwing', () => {
        const { storage, faults } = memoryStorage();
        faults.read = true;
        faults.write = true;
        const env = setup(storage);
        expect(env.persistence.restore()).toBeNull();
        expect(() => changeLayout(env, 'tab-1')).not.toThrow();
        expect(env.persistence.flush()).toBe(false);
        expect(env.persistence.status.value).toBe('unavailable');
        expect(env.onIssue).toHaveBeenCalledTimes(1);
        expect(env.onIssue).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'unavailable', key: KEY })
        );
    });

    it('stays usable when reading window.localStorage itself throws', () => {
        vi.stubGlobal('window', {
            get localStorage(): Storage {
                throw new DOMException('The operation is insecure.', 'SecurityError');
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        try {
            const env = setup(undefined as unknown as null);
            expect(env.persistence.restore()).toBeNull();
            expect(() => env.persistence.schedule()).not.toThrow();
            expect(env.persistence.flush()).toBe(false);
            expect(env.persistence.status.value).toBe('unavailable');
            expect(env.onIssue).toHaveBeenCalledTimes(1);
            expect(env.onIssue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unavailable' }));
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('an explicit flush saves the current layout even when nothing was scheduled', () => {
        // A pane swap changes the visible layout without a tab state commit.
        const { storage, data } = memoryStorage();
        const env = setup(storage);
        env.persistence.restore();
        expect(env.persistence.flush()).toBe(true);
        expect(JSON.parse(data.get(KEY)!)).toMatchObject({ activeTabId: 'tab-2' });
    });

    it('keeps unsaved tabs after a failed write and notifies once per failure episode', () => {
        const { storage, faults } = memoryStorage();
        const env = setup(storage);
        env.persistence.restore();

        faults.write = true;
        changeLayout(env, 'tab-1');
        expect(env.persistence.flush()).toBe(false);
        expect(env.persistence.status.value).toBe('write_failed');
        expect(env.onIssue).toHaveBeenCalledTimes(1);
        expect(env.onIssue).toHaveBeenLastCalledWith(
            expect.objectContaining({ kind: 'write_failed', key: KEY })
        );

        for (const activeTabId of ['tab-2', 'tab-1', 'tab-2']) {
            changeLayout(env, activeTabId);
            vi.advanceTimersByTime(50);
        }
        expect(env.persistence.status.value).toBe('write_failed');
        expect(env.onIssue).toHaveBeenCalledTimes(1);

        // The unsaved layout is still pending, so the next flush after recovery saves it.
        faults.write = false;
        expect(env.persistence.flush()).toBe(true);
        expect(env.persistence.status.value).toBe('ok');
        expect(readWorkspaceTabsSnapshot(storage, KEY)).toMatchObject({
            status: 'ok',
            snapshot: { activeTabId: 'tab-2' },
        });

        // A failure after recovery is a new episode and notifies again.
        faults.write = true;
        changeLayout(env, 'tab-1');
        expect(env.persistence.flush()).toBe(false);
        expect(env.onIssue).toHaveBeenCalledTimes(2);
    });

    it('retry re-attempts the pending write and clears the failure once storage recovers', () => {
        const { storage, faults } = memoryStorage();
        const env = setup(storage);
        env.persistence.restore();
        faults.write = true;
        changeLayout(env, 'tab-1');
        expect(env.persistence.retry()).toBe(false);
        faults.write = false;
        expect(env.persistence.retry()).toBe(true);
        expect(env.persistence.status.value).toBe('ok');
        expect(readWorkspaceTabsSnapshot(storage, KEY)).toMatchObject({
            status: 'ok',
            snapshot: { activeTabId: 'tab-1' },
        });
    });

    it('does not swallow a failed debounced write', () => {
        const { storage, faults } = memoryStorage();
        const env = setup(storage);
        env.persistence.restore();
        faults.write = true;
        changeLayout(env, 'tab-1');
        vi.advanceTimersByTime(50);
        expect(env.persistence.status.value).toBe('write_failed');
        expect(env.onIssue).toHaveBeenCalledTimes(1);

        faults.write = false;
        changeLayout(env, 'tab-2');
        vi.advanceTimersByTime(50);
        expect(env.persistence.status.value).toBe('ok');
        expect(readWorkspaceTabsSnapshot(storage, KEY)).toMatchObject({
            status: 'ok',
            snapshot: { activeTabId: 'tab-2' },
        });
    });

    it.each([
        ['invalid JSON', '{not valid JSON'],
        ['schema-invalid data', JSON.stringify({ schemaVersion: 1, tabs: [] })],
    ])('treats %s as corrupt, keeps the original, and reports it once', (_label, raw) => {
        const { storage, data } = memoryStorage({ [KEY]: raw });
        const env = setup(storage);
        expect(env.persistence.restore()).toBeNull();
        expect(env.persistence.status.value).toBe('corrupt');
        expect(env.onIssue).toHaveBeenCalledTimes(1);
        expect(env.onIssue).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'corrupt_layout', key: KEY, backupKept: true })
        );
        expect(readCorruptWorkspaceTabsBackup(storage, KEY)).toBe(raw);
        expect(data.get(KEY)).toBe(raw);

        // The original stays until a successful write replaces it; the backup remains.
        changeLayout(env, 'tab-1');
        vi.advanceTimersByTime(50);
        expect(env.persistence.status.value).toBe('ok');
        expect(readWorkspaceTabsSnapshot(storage, KEY).status).toBe('ok');
        expect(readCorruptWorkspaceTabsBackup(storage, KEY)).toBe(raw);
    });

    it('exposes the preserved original for inspection and discard', () => {
        const raw = '{not valid JSON';
        const { storage, data } = memoryStorage({ [KEY]: raw });
        const env = setup(storage);
        env.persistence.restore();
        expect(env.persistence.getCorruptBackup()).toBe(raw);
        env.persistence.discardCorruptBackup();
        expect(env.persistence.getCorruptBackup()).toBeNull();
        expect(data.get(KEY)).toBe(raw);
    });

    it('reads and discards a backup by the key its notice was raised for, even after the scope changed', () => {
        const raw = '{not valid JSON';
        const otherKey = getWorkspaceTabsStorageKey('workspace-b', 'standard');
        const { storage, data } = memoryStorage({ [KEY]: raw, [`${otherKey}:corrupt`]: 'someone else' });
        const env = setup(storage);
        env.persistence.restore();
        expect(data.get(`${KEY}:corrupt`)).toBe(raw);

        // The user moves to another workspace before acting on the notice.
        env.persistence.switchScope('workspace-b', 'standard');
        expect(env.persistence.key()).toBe(otherKey);
        expect(env.persistence.getCorruptBackup()).toBe('someone else');
        expect(env.persistence.getCorruptBackup(KEY)).toBe(raw);

        env.persistence.discardCorruptBackup(KEY);
        expect(data.has(`${KEY}:corrupt`)).toBe(false);
        expect(data.get(`${otherKey}:corrupt`)).toBe('someone else');
    });

    it('never replaces a corrupt layout that could not be copied aside', () => {
        const raw = '{not valid JSON';
        const { storage, data, faults } = memoryStorage({ [KEY]: raw });
        faults.backup = true;
        const env = setup(storage);
        expect(env.persistence.restore()).toBeNull();
        expect(env.persistence.status.value).toBe('corrupt');
        // Nothing was copied aside, so the UI must not offer to export or discard a backup.
        expect(env.onIssue).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'corrupt_layout', backupKept: false })
        );

        changeLayout(env, 'tab-1');
        vi.advanceTimersByTime(50);
        expect(env.persistence.flush()).toBe(false);
        expect(data.get(KEY)).toBe(raw);
        expect(env.persistence.status.value).toBe('corrupt');
        expect(env.onIssue).toHaveBeenCalledTimes(1);

        faults.backup = false;
        expect(env.persistence.retry()).toBe(true);
        expect(readCorruptWorkspaceTabsBackup(storage, KEY)).toBe(raw);
        expect(readWorkspaceTabsSnapshot(storage, KEY).status).toBe('ok');
        expect(env.persistence.status.value).toBe('ok');
    });

    it('treats a missing layout as missing, not as an issue', () => {
        const { storage } = memoryStorage();
        expect(readWorkspaceTabsSnapshot(storage, KEY)).toEqual({ status: 'missing' });
        const env = setup(storage);
        expect(env.persistence.restore()).toBeNull();
        expect(env.persistence.status.value).toBe('ok');
        expect(env.onIssue).not.toHaveBeenCalled();
    });

    it('switchScope moves to the new scope without throwing on blocked storage', () => {
        const { storage, faults } = memoryStorage();
        faults.read = true;
        faults.write = true;
        const env = setup(storage);
        env.persistence.restore();
        expect(() => env.persistence.switchScope('workspace-b', 'standard')).not.toThrow();
        expect(env.persistence.key()).toBe(getWorkspaceTabsStorageKey('workspace-b', 'standard'));
    });

    it('keeps persistence working when the issue handler throws', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { storage, faults } = memoryStorage();
        faults.write = true;
        const env = setup(
            storage,
            vi.fn(() => {
                throw new Error('Toast host unavailable');
            })
        );
        env.persistence.restore();
        changeLayout(env, 'tab-1');
        expect(env.persistence.flush()).toBe(false);
        expect(env.persistence.status.value).toBe('write_failed');
        expect(consoleError).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });
});
