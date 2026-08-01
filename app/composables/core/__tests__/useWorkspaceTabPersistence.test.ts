import { describe, expect, it } from 'vitest';
import type { WorkspaceTabsState } from '~/core/workspace-tabs/types';
import {
    createWorkspaceTabsSnapshot,
    getWorkspaceTabsStorageKey,
    readWorkspaceTabsSnapshot,
    writeWorkspaceTabsSnapshot,
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

describe('workspace tab persistence', () => {
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
        expect(readWorkspaceTabsSnapshot(storage, 'tabs')).toEqual(snapshot);
    });

    it('safely ignores corrupt local storage', () => {
        const storage = { getItem: () => '{not valid JSON' };
        expect(readWorkspaceTabsSnapshot(storage, 'tabs')).toBeNull();
    });
});
