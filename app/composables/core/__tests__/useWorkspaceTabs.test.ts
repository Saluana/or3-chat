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

    it('preserves an active blank tab when explicitly opening a duplicate tab', async () => {
        const fake = createHost();
        const tabs = useWorkspaceTabs({
            host: fake.host,
            paneLimit: computed(() => 3),
            isMobile: ref(false),
            workspaceId: () => 'local',
            profileId: () => 'standard',
            storage: null,
        });

        await tabs.openResource(
            { kind: 'chat', threadId: 'chat-a' },
            { allowDuplicate: true, reuseActiveBlank: false }
        );

        expect(tabs.tabs.value).toHaveLength(2);
        expect(tabs.tabs.value[0]?.resource).toEqual({
            kind: 'chat',
            threadId: null,
        });
        expect(tabs.tabs.value[1]?.resource).toEqual({
            kind: 'chat',
            threadId: 'chat-a',
        });
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

        const newTab = await tabs.newTab();
        expect(newTab.status).toBe('activated');
        expect(tabs.tabs.value).toHaveLength(2);
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'chat', threadId: null });

        const split = await tabs.newSplit();
        expect(split.status).toBe('activated');
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
        const { tabId } = await tabs.openResource({ kind: 'chat', threadId: 'chat-a' });

        await expect(
            tabs.openInSplit(
                { kind: 'chat', threadId: 'chat-a' },
                { allowDuplicate: false }
            )
        ).resolves.toEqual({ status: 'activated', tabId });
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
        const { tabId: splitTabId } = await tabs.newSplit();
        await tabs.closeSplit('pane-b');
        expect(tabs.tabs.value.some((tab) => tab.id === splitTabId)).toBe(true);
        await tabs.closeTab(splitTabId!);

        const again = await tabs.newSplit();
        expect(again.status).toBe('activated');
        await tabs.closeTab(again.tabId!);
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

        await expect(tabs.reopenClosedTab()).resolves.toEqual({
            status: 'failed',
            tabId: null,
        });
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
        const { tabId: hiddenId } = await tabs.openResource(
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

interface Gate {
    promise: Promise<void>;
    resolve(): void;
    reject(reason?: unknown): void;
}

function deferred(): Gate {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Lets an in-flight activation reach its held host bind. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createTabs(
    fake: ReturnType<typeof createHost>,
    extra: Partial<Parameters<typeof useWorkspaceTabs>[0]> = {}
) {
    return useWorkspaceTabs({
        host: fake.host,
        paneLimit: computed(() => 3),
        isMobile: ref(false),
        workspaceId: () => 'workspace-a',
        profileId: () => 'standard',
        storage: null,
        ...extra,
    });
}

function tabIdFor(tabs: ReturnType<typeof useWorkspaceTabs>, threadId: string) {
    const tab = tabs.tabs.value.find(
        (entry) =>
            entry.resource.kind === 'chat' && entry.resource.threadId === threadId
    );
    if (!tab) throw new Error(`No tab for ${threadId}`);
    return tab.id;
}

/** Holds the host bind for one chat until the returned gate settles. */
function holdBind(fake: ReturnType<typeof createHost>, threadId: string) {
    const gate = deferred();
    const original = fake.host.bindResourceToPane;
    fake.host.bindResourceToPane = async (paneId, resource, activation) => {
        if (resource.kind === 'chat' && resource.threadId === threadId) {
            await gate.promise;
        }
        return original(paneId, resource, activation);
    };
    return gate;
}

function workspaceBStorage() {
    const entries = new Map<string, string>([
        [
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
            }),
        ],
    ]);
    return {
        entries,
        storage: {
            getItem: (key: string) => entries.get(key) ?? null,
            setItem: (key: string, value: string) => entries.set(key, value),
        },
    };
}

describe('useWorkspaceTabs concurrent operations', () => {
    it.each([false, true])('waits for outgoing activation before closing its tab (save succeeds: %s)', async (saveSucceeds) => {
        const fake = createHost();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
            onError: vi.fn(),
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');
        const b = tabIdFor(tabs, 'b');

        gate = deferred();
        const activating = tabs.activateTab(b);
        const closing = tabs.closeTab(a);
        await flush();
        expect(tabs.tabs.value.some((tab) => tab.id === a)).toBe(true);

        if (saveSucceeds) gate.resolve();
        else gate.reject(new Error('disk full'));
        await expect(activating).resolves.toBe(saveSucceeds);
        await expect(closing).resolves.toBe(saveSucceeds);
        expect(tabs.state.value.paneBindings.get('pane-a')).toBe(saveSucceeds ? b : a);
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'chat', threadId: saveSucceeds ? 'b' : 'a' });
        expect(tabs.tabs.value.some((tab) => tab.id === a)).toBe(!saveSucceeds);
    });

    it('keeps tab changes made while a closing tab is being saved', async () => {
        const fake = createHost();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        await tabs.openResource({ kind: 'chat', threadId: 'c' }, { target: 'background' });
        const [a, b, c] = ['a', 'b', 'c'].map((id) => tabIdFor(tabs, id)) as [
            string,
            string,
            string,
        ];

        gate = deferred();
        const closing = tabs.closeTab(a);
        tabs.updateCachedTitle(b, 'Renamed');
        await tabs.closeTab(c);
        await tabs.openResource({ kind: 'chat', threadId: 'd' }, { target: 'background' });
        const d = tabIdFor(tabs, 'd');
        gate.resolve();

        await expect(closing).resolves.toBe(true);
        expect(tabs.tabs.value.map((tab) => tab.id).sort()).toEqual([b, d].sort());
        expect(tabs.tabs.value.find((tab) => tab.id === b)?.cachedTitle).toBe('Renamed');
        expect(tabs.state.value.recentlyClosed.map((entry) => entry.tab.id).sort()).toEqual(
            [a, c].sort()
        );
        expect([b, d]).toContain(tabs.state.value.paneBindings.get('pane-a'));
    });

    it('keeps a split opened while the visible tab is being saved for close', async () => {
        const fake = createHost();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');
        const b = tabIdFor(tabs, 'b');

        gate = deferred();
        const closing = tabs.closeTab(a);
        await tabs.newSplit();
        const splitTab = tabs.state.value.paneBindings.get('pane-b');
        gate.resolve();
        await closing;

        expect(fake.panes).toEqual(['pane-a', 'pane-b']);
        expect(splitTab).toBeTruthy();
        expect(tabs.state.value.paneBindings.get('pane-b')).toBe(splitTab);
        expect(tabs.state.value.paneBindings.get('pane-a')).toBe(b);
        expect(tabs.tabs.value.some((tab) => tab.id === splitTab)).toBe(true);
    });

    it('closes a tab once when close is requested twice during its save', async () => {
        const fake = createHost();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');

        gate = deferred();
        const first = tabs.closeTab(a);
        const second = tabs.closeTab(a);
        gate.resolve();

        expect((await Promise.all([first, second])).sort()).toEqual([false, true]);
        expect(tabs.state.value.recentlyClosed).toHaveLength(1);
        expect(tabs.tabs.value.some((tab) => tab.id === a)).toBe(false);
    });

    it('keeps the tab and concurrent changes when saving fails during close', async () => {
        const fake = createHost();
        const onError = vi.fn();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
            onError,
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');
        const b = tabIdFor(tabs, 'b');

        gate = deferred();
        const closing = tabs.closeTab(a);
        tabs.updateCachedTitle(b, 'Renamed');
        gate.reject(new Error('disk full'));

        await expect(closing).resolves.toBe(false);
        expect(onError).toHaveBeenCalledWith(expect.any(Error), { tabId: a, action: 'close' });
        expect(tabs.tabs.value.map((tab) => tab.id)).toContain(a);
        expect(tabs.tabs.value.find((tab) => tab.id === b)?.cachedTitle).toBe('Renamed');
        expect(tabs.state.value.paneBindings.get('pane-a')).toBe(a);
    });

    it('does not touch the new workspace when a close finishes after a scope switch', async () => {
        const fake = createHost();
        const { entries, storage } = workspaceBStorage();
        let gate: Gate | null = null;
        const tabs = createTabs(fake, {
            storage,
            captureOutgoing: () => gate?.promise ?? Promise.resolve(),
        });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');

        gate = deferred();
        const closing = tabs.closeTab(a);
        await expect(tabs.switchScope('workspace-b', 'standard')).resolves.toBe(true);
        gate.resolve();

        await expect(closing).resolves.toBe(false);
        expect(tabs.tabs.value.map((tab) => tab.id)).toEqual(['workspace-b-tab']);
        expect(tabs.state.value.recentlyClosed).toHaveLength(0);
        expect(fake.bindings.get('pane-a')).toEqual({ kind: 'document', documentId: 'doc-b' });
        const previous = JSON.parse(
            entries.get('or3:workspace-tabs:v1:workspace-a:standard')!
        );
        expect(previous.tabs.map((tab: { id: string }) => tab.id)).toContain(a);
    });

    it('keeps unrelated changes when an activation fails', async () => {
        const fake = createHost();
        const onError = vi.fn();
        const tabs = createTabs(fake, { onError });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const a = tabIdFor(tabs, 'a');
        const b = tabIdFor(tabs, 'b');

        const gate = holdBind(fake, 'b');
        const activating = tabs.activateTab(b, 'pointer');
        await flush();
        tabs.updateCachedTitle(a, 'Renamed A');
        await tabs.openResource({ kind: 'chat', threadId: 'c' }, { target: 'background' });
        gate.reject(new Error('boom'));

        await expect(activating).resolves.toBe(false);
        expect(onError).toHaveBeenCalledWith(expect.any(Error), { tabId: b, action: 'activate' });
        expect(tabs.state.value.paneBindings.get('pane-a')).toBe(a);
        expect(tabs.activeTabId.value).toBe(a);
        expect(tabs.tabs.value.find((tab) => tab.id === a)?.cachedTitle).toBe('Renamed A');
        expect(tabs.tabs.value.some((tab) => tab.id === tabIdFor(tabs, 'c'))).toBe(true);
        expect(tabs.state.value.runtime.get(b)?.status).toBe('error');
    });

    it('does not pull focus back when another pane was focused during a failed activation', async () => {
        const fake = createHost();
        const tabs = createTabs(fake, { onError: vi.fn() });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.newSplit();
        await tabs.openResource(
            { kind: 'chat', threadId: 'h' },
            { target: 'background', reuseActiveBlank: false }
        );
        const a = tabIdFor(tabs, 'a');
        const h = tabIdFor(tabs, 'h');
        const splitTab = tabs.state.value.paneBindings.get('pane-b')!;

        const gate = holdBind(fake, 'h');
        const activating = tabs.activateTab(h, 'pointer');
        await flush();
        await expect(tabs.activateTab(a, 'pointer')).resolves.toBe(true);
        gate.reject(new Error('boom'));

        await expect(activating).resolves.toBe(false);
        expect(tabs.state.value.paneBindings.get('pane-b')).toBe(splitTab);
        expect(tabs.activePaneId.value).toBe('pane-a');
        expect(tabs.activeTabId.value).toBe(a);
    });

    it('ignores a late activation failure after the workspace changed', async () => {
        const fake = createHost();
        const onError = vi.fn();
        const { storage } = workspaceBStorage();
        const tabs = createTabs(fake, { storage, onError });
        await tabs.openResource({ kind: 'chat', threadId: 'a' });
        await tabs.openResource({ kind: 'chat', threadId: 'b' }, { target: 'background' });
        const b = tabIdFor(tabs, 'b');

        const gate = holdBind(fake, 'b');
        const activating = tabs.activateTab(b, 'pointer');
        await flush();
        await expect(tabs.switchScope('workspace-b', 'standard')).resolves.toBe(true);
        gate.reject(new Error('late'));

        await expect(activating).resolves.toBe(false);
        expect(onError).not.toHaveBeenCalled();
        expect(tabs.tabs.value.map((tab) => tab.id)).toEqual(['workspace-b-tab']);
        expect(tabs.state.value.runtime.get('workspace-b-tab')?.status ?? 'idle').toBe('idle');
    });
});

describe('useWorkspaceTabs navigation outcomes', () => {
    it('distinguishes activated and created tabs', async () => {
        const tabs = createTabs(createHost());

        const activated = await tabs.openResource({ kind: 'chat', threadId: 'a' });
        const created = await tabs.openResource(
            { kind: 'chat', threadId: 'b' },
            { target: 'background' }
        );

        expect(activated).toEqual({ status: 'activated', tabId: tabIdFor(tabs, 'a') });
        expect(created).toEqual({ status: 'created', tabId: tabIdFor(tabs, 'b') });
    });

    it.each([
        ['openResource', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            breakHost();
            return tabs.openResource({ kind: 'chat', threadId: 'x' });
        }],
        ['newTab', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            breakHost();
            return tabs.newTab();
        }],
        ['newSplit', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            breakHost();
            return tabs.newSplit();
        }],
        ['openInSplit', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            breakHost();
            return tabs.openInSplit({ kind: 'chat', threadId: 'x' });
        }],
        ['openTabInSplit', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            await tabs.openResource({ kind: 'chat', threadId: 'a' });
            await tabs.openResource({ kind: 'chat', threadId: 'y' }, { target: 'background' });
            breakHost();
            return tabs.openTabInSplit(tabIdFor(tabs, 'y'));
        }],
        ['reopenClosedTab', async (tabs: ReturnType<typeof useWorkspaceTabs>, breakHost: () => void) => {
            await tabs.openResource({ kind: 'chat', threadId: 'y' });
            await tabs.closeTab(tabIdFor(tabs, 'y'));
            breakHost();
            return tabs.reopenClosedTab();
        }],
    ])('%s reports failure instead of a tab id when activation fails', async (_name, run) => {
        const fake = createHost();
        const onError = vi.fn();
        const tabs = createTabs(fake, { onError });
        let broken = false;
        const original = fake.host.bindResourceToPane;
        fake.host.bindResourceToPane = (paneId, resource, activation) => {
            if (broken) return Promise.reject(new Error('bind failed'));
            return original(paneId, resource, activation);
        };

        const result = await run(tabs, () => {
            broken = true;
        });

        expect(result).toMatchObject({ status: 'failed' });
        expect(onError).toHaveBeenCalled();
    });

    it('reports failure without a tab when no pane can be added', async () => {
        const fake = createHost();
        fake.host.addPane = () => null;
        const tabs = createTabs(fake);

        await expect(tabs.newSplit()).resolves.toEqual({ status: 'failed', tabId: null });
        await expect(
            tabs.openInSplit({ kind: 'chat', threadId: 'x' })
        ).resolves.toEqual({ status: 'failed', tabId: null });
        expect(tabs.tabs.value).toHaveLength(1);
    });

    it('reports a superseded navigation without an error or a stuck loading tab', async () => {
        const fake = createHost();
        const onError = vi.fn();
        const tabs = createTabs(fake, { onError });
        const gate = holdBind(fake, 'a');

        const first = tabs.openResource({ kind: 'chat', threadId: 'a' });
        const second = await tabs.openResource({ kind: 'chat', threadId: 'b' });
        gate.resolve();
        const superseded = await first;

        expect(second.status).toBe('activated');
        expect(superseded).toEqual({ status: 'superseded', tabId: tabIdFor(tabs, 'a') });
        expect(onError).not.toHaveBeenCalled();
        expect(tabs.statusByTabId.value.get(tabIdFor(tabs, 'a'))).not.toBe('loading');
    });
});
