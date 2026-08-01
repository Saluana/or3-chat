import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceResource } from '~/core/workspace-tabs/types';
import type { PaneActivation, WorkspaceTabHost } from '../useWorkspaceTabHost';
import { useWorkspaceTabs } from '../useWorkspaceTabs';

function createHost(): {
    host: WorkspaceTabHost;
    bindings: Map<string, WorkspaceResource>;
    panes: string[];
} {
    const panes = ['pane-a'];
    const bindings = new Map<string, WorkspaceResource>([
        ['pane-a', { kind: 'chat', threadId: null }],
    ]);
    let active = 'pane-a';
    return {
        panes,
        bindings,
        host: {
            paneIds: () => [...panes],
            activePaneId: () => active,
            focusPane: (paneId) => {
                active = paneId;
            },
            addPane: () => {
                const paneId = `pane-${String.fromCharCode(97 + panes.length)}`;
                panes.push(paneId);
                bindings.set(paneId, { kind: 'chat', threadId: null });
                active = paneId;
                return paneId;
            },
            closePane: async (paneId) => {
                const index = panes.indexOf(paneId);
                if (index >= 0) panes.splice(index, 1);
                bindings.delete(paneId);
                active = panes[0] ?? '';
            },
            bindResourceToPane: async (
                paneId: string,
                resource: WorkspaceResource,
                activation: PaneActivation
            ) => {
                if (activation.isCurrent()) bindings.set(paneId, resource);
            },
        },
    };
}

describe('useWorkspaceTabs', () => {
    it('creates a distinct blank tab for every explicit New tab command', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 3),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });

        await tabs.newTab();
        await tabs.newTab();

        expect(tabs.tabs.value).toHaveLength(3);
        expect(new Set(tabs.tabs.value.map((tab) => tab.id))).toHaveLength(3);
    });

    it('routes open/new/split actions through one tab session and host', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 3),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });
        await tabs.openResource({ kind: 'chat', threadId: 'chat-a' });
        expect(tabs.tabs.value).toHaveLength(1);
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'chat', threadId: 'chat-a' });

        const newTabId = await tabs.newTab();
        expect(newTabId).toBeTruthy();
        expect(tabs.tabs.value).toHaveLength(2);
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'chat', threadId: null });

        const splitTabId = await tabs.newSplit();
        expect(splitTabId).toBeTruthy();
        expect(fake.panes).toHaveLength(2);
        expect(tabs.visibleTabIds.value.size).toBe(2);
    });

    it('focuses an existing resource instead of leaving an empty split', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 3),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });
        const tabId = await tabs.openResource({ kind: 'chat', threadId: 'chat-a' });

        await expect(
            tabs.openInSplit(
                { kind: 'chat', threadId: 'chat-a' },
                { allowDuplicate: false }
            )
        ).resolves.toBe(tabId);
        expect(fake.panes).toEqual(['pane-a']);
        expect(tabs.tabs.value).toHaveLength(1);
    });

    it('rejects a stale A → B activation after B wins', async () => {
        const fake = createHost();
        const pending = new Map<string, () => void>();
        fake.host.bindResourceToPane = (paneId, resource, activation) =>
            new Promise<void>((resolve) => {
                pending.set(String((resource as { threadId?: string }).threadId), () => {
                    if (activation.isCurrent()) fake.bindings.set(paneId, resource);
                    resolve();
                });
            });
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 2),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });
        const first = tabs.openResource({ kind: 'chat', threadId: 'a' });
        const second = tabs.openResource({ kind: 'chat', threadId: 'b' });
        await Promise.resolve();
        pending.get('b')?.();
        await second;
        pending.get('a')?.();
        await first;
        expect(tabs.tabs.value.find((tab) => tab.id === tabs.activeTabId.value)?.resource).toEqual({
            kind: 'chat',
            threadId: 'b',
        });
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'chat', threadId: 'b' });
    });

    it('retains a tab when closing a split and closes an empty extra split after a tab close', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 3),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        const splitTabId = await tabs.newSplit();
        await tabs.closeSplit('pane-b');
        expect(tabs.tabs.value.some((tab) => tab.id === splitTabId)).toBe(true);
        await tabs.closeTab(splitTabId!);

        const again = await tabs.newSplit();
        expect(again).toBeTruthy();
        await tabs.closeTab(again!);
        expect(fake.panes).toEqual(['pane-a']);
    });

    it('does not reactivate the current tab when there is nothing to reopen', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 2),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });
        const original = tabs.state.value;

        await expect(tabs.reopenClosedTab()).resolves.toBeNull();
        expect(tabs.state.value).toBe(original);
    });

    it('restores replacement view state after closing the visible tab', async () => {
        const fake = createHost();
        const restoreIncoming = vi.fn(async () => undefined);
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 2),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
            restoreIncoming,
        });
        await tabs.openResource({ kind: 'chat', threadId: 'visible' });
        const hiddenId = await tabs.openResource(
            { kind: 'chat', threadId: 'hidden' },
            { target: 'background' }
        );

        await tabs.closeTab(tabs.activeTabId.value);

        expect(hiddenId).toBeTruthy();
        expect(restoreIncoming).toHaveBeenCalledWith(
            hiddenId,
            'pane-a',
            expect.objectContaining({ paneId: 'pane-a' })
        );
    });

    it('drops unavailable resources before restoring their panes', async () => {
        const fake = createHost();
        const storage = new Map<string, string>();
        storage.set(
            'or3:workspace-tabs:v1:local:standard',
            JSON.stringify({
                schemaVersion: 1,
                tabs: [
                    {
                        id: 'gone',
                        resource: { kind: 'chat', threadId: 'gone' },
                        cachedTitle: 'Gone',
                        createdAt: 1,
                        lastActivatedAt: 1,
                        ephemeral: false,
                    },
                    {
                        id: 'kept',
                        resource: { kind: 'document', documentId: 'kept' },
                        cachedTitle: 'Kept',
                        createdAt: 2,
                        lastActivatedAt: 2,
                        ephemeral: false,
                    },
                ],
                activeTabId: 'gone',
                visibleTabIds: ['gone'],
                activeVisibleIndex: 0,
                savedAt: 3,
            })
        );
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 2),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: {
                getItem: (key) => storage.get(key) ?? null,
                setItem: (key, value) => storage.set(key, value),
            },
            filterRestoredTabs: async (entries) =>
                entries
                    .filter((entry) => entry.id === 'kept')
                    .map((entry) => entry.id),
        });

        await expect(tabs.restore()).resolves.toBe(true);
        expect(tabs.tabs.value.map((tab) => tab.id)).toEqual(['kept']);
        expect(fake.bindings.get('pane-a')).toEqual({
            kind: 'document',
            documentId: 'kept',
        });
    });

    it('flushes the old workspace and replaces visible panes when scope changes', async () => {
        const fake = createHost();
        const storage = new Map<string, string>();
        storage.set(
            'or3:workspace-tabs:v1:workspace-b:standard',
            JSON.stringify({
                schemaVersion: 1,
                tabs: [
                    {
                        id: 'workspace-b-tab',
                        resource: { kind: 'document', documentId: 'doc-b' },
                        cachedTitle: 'Workspace B',
                        createdAt: 1,
                        lastActivatedAt: 2,
                        ephemeral: false,
                    },
                ],
                activeTabId: 'workspace-b-tab',
                visibleTabIds: ['workspace-b-tab'],
                activeVisibleIndex: 0,
                savedAt: 3,
            })
        );
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 2),
            isMobile: ref(false),
            workspaceId: () => 'workspace-a',
            profileId: () => 'standard',
            storage: {
                getItem: (key) => storage.get(key) ?? null,
                setItem: (key, value) => storage.set(key, value),
            },
        });
        await tabs.openResource({ kind: 'chat', threadId: 'chat-a' });

        await expect(
            tabs.switchScope('workspace-b', 'standard')
        ).resolves.toBe(true);

        expect(
            JSON.parse(
                storage.get('or3:workspace-tabs:v1:workspace-a:standard')!
            ).tabs[0].resource
        ).toEqual({ kind: 'chat', threadId: 'chat-a' });
        expect(tabs.activeTabId.value).toBe('workspace-b-tab');
        expect(fake.bindings.get('pane-a')).toEqual({
            kind: 'document',
            documentId: 'doc-b',
        });
    });
});
