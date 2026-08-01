import { describe, expect, it } from 'vitest';
import type { WorkspaceTabsSnapshotV1 } from '~/core/workspace-tabs/types';
import {
    activateTab,
    bindTabToPane,
    closeSplit,
    closeTab,
    createInitialState,
    markResourceDeleted,
    newBlankTab,
    openTab,
    promoteBlankChat,
    reconcilePaneResource,
    reorderTab,
    restoreSnapshot,
} from '../workspace-tab-transitions';

function factory() {
    let index = 0;
    return {
        createId: () => `tab-${++index}`,
        now: () => 1_000 + index,
    };
}

describe('workspace tab transitions', () => {
    it('creates one blank tab bound to the initial pane', () => {
        const state = createInitialState({ paneId: 'pane-a' }, factory());
        expect(state.tabs).toHaveLength(1);
        expect(state.tabs[0]?.resource).toEqual({ kind: 'chat', threadId: null });
        expect(state.paneBindings.get('pane-a')).toBe(state.activeTabId);
    });

    it('reuses an untouched blank when a resource is opened', () => {
        const f = factory();
        const state = createInitialState({ paneId: 'pane-a' }, f);
        const opened = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f);
        expect(opened.reusedBlank).toBe(true);
        expect(opened.state.tabs).toHaveLength(1);
        expect(opened.state.tabs[0]?.id).toBe(state.tabs[0]?.id);
        expect(opened.state.tabs[0]?.resource).toEqual({ kind: 'chat', threadId: 'a' });
    });

    it('inserts a new tab immediately after the active one and dedupes canonical resources', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const doc = openTab(state, { kind: 'document', documentId: 'doc-a' }, {}, f);
        expect(doc.state.tabs.map((tab) => tab.resource.kind)).toEqual(['chat', 'document']);
        const deduped = openTab(doc.state, { kind: 'chat', threadId: 'a' }, {}, f);
        expect(deduped.existing).toBe(true);
        expect(deduped.state.tabs).toHaveLength(2);
        expect(deduped.state.activeTabId).toBe(state.tabs[0]?.id);
    });

    it('allows an explicit duplicate and keeps independent IDs', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const duplicate = openTab(
            state,
            { kind: 'chat', threadId: 'a' },
            { allowDuplicate: true },
            f
        );
        expect(duplicate.state.tabs).toHaveLength(2);
        expect(new Set(duplicate.state.tabs.map((tab) => tab.id)).size).toBe(2);
    });

    it('activates a hidden tab in the active pane and focuses a tab visible elsewhere', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const second = newBlankTab(state, {}, f);
        state = bindTabToPane(second.state, 'pane-b', second.tabId!, f);
        const hidden = newBlankTab(state, {}, f);
        state = activateTab(hidden.state, hidden.tabId!, f);
        expect(state.paneBindings.get('pane-b')).toBe(hidden.tabId);
        const firstTabId = state.tabs[0]!.id;
        state = activateTab(state, firstTabId, f);
        expect(state.activePaneId).toBe('pane-a');
        expect(state.activeTabId).toBe(firstTabId);
    });

    it('closes a hidden tab, fills a visible tab from hidden state, and collapses an extra pane', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const hidden = newBlankTab(state, {}, f);
        let result = closeTab(hidden.state, hidden.tabId!, f);
        expect(result.closed).toBe(true);
        expect(result.state.tabs).toHaveLength(1);

        const replacement = newBlankTab(result.state, {}, f);
        result = closeTab(replacement.state, result.state.activeTabId, f);
        expect(result.paneToClose).toBeNull();
        expect(result.state.paneBindings.get('pane-a')).toBe(replacement.tabId);

        state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'split-source' }, {}, f).state;
        const split = newBlankTab(state, {}, f);
        state = bindTabToPane(split.state, 'pane-b', split.tabId!, f);
        result = closeTab(state, split.tabId!, f);
        expect(result.paneToClose).toBe('pane-b');
        expect(result.state.tabs.length).toBeGreaterThan(0);
    });

    it('keeps tabs when a split closes and creates a blank fallback after last tab closes', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        const tabId = state.activeTabId;
        state = closeSplit(state, 'pane-a', f);
        expect(state.tabs[0]?.id).toBe(tabId);
        expect(state.paneBindings.size).toBe(0);

        state = createInitialState({ paneId: 'pane-a' }, f);
        const result = closeTab(state, state.activeTabId, f);
        expect(result.state.tabs).toHaveLength(1);
        expect(result.state.tabs[0]?.resource).toEqual({ kind: 'chat', threadId: null });
        expect(result.state.paneBindings.get('pane-a')).toBe(result.state.activeTabId);
    });

    it('reorders and promotes a blank without changing its tab ID', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        const second = newBlankTab(state, {}, f);
        state = reorderTab(second.state, second.tabId!, 0, f);
        expect(state.tabs[0]?.id).toBe(second.tabId);
        state = promoteBlankChat(state, second.tabId!, 'thread-a', f);
        expect(state.tabs[0]?.id).toBe(second.tabId);
        expect(state.tabs[0]?.resource).toEqual({ kind: 'chat', threadId: 'thread-a' });
    });

    it('deletes active and hidden resources without leaving an invalid binding', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const doc = openTab(state, { kind: 'document', documentId: 'doc-a' }, {}, f);
        state = markResourceDeleted(doc.state, { kind: 'document', documentId: 'doc-a' }, f);
        expect(state.tabs.some((tab) => tab.resource.kind === 'document')).toBe(false);
        state = markResourceDeleted(state, { kind: 'chat', threadId: 'a' }, f);
        expect(state.tabs).toHaveLength(1);
        expect(state.paneBindings.get('pane-a')).toBe(state.activeTabId);
    });

    it('restores safely with lower pane limits and a one-pane mobile policy', () => {
        const snapshot: WorkspaceTabsSnapshotV1 = {
            schemaVersion: 1,
            tabs: [
                {
                    id: 'one',
                    resource: { kind: 'chat', threadId: 'a' },
                    cachedTitle: 'A',
                    createdAt: 1,
                    lastActivatedAt: 1,
                    ephemeral: false,
                },
                {
                    id: 'two',
                    resource: { kind: 'document', documentId: 'd' },
                    cachedTitle: 'D',
                    createdAt: 1,
                    lastActivatedAt: 1,
                    ephemeral: false,
                },
            ],
            activeTabId: 'two',
            visibleTabIds: ['one', 'two'],
            activeVisibleIndex: 1,
            savedAt: 1,
        };
        const desktop = restoreSnapshot(snapshot, {
            paneIds: ['a', 'b'],
            paneLimit: 1,
        });
        expect([...desktop.paneBindings.values()]).toEqual(['one']);
        const mobile = restoreSnapshot(snapshot, {
            paneIds: ['a', 'b'],
            paneLimit: 2,
            isMobile: true,
        });
        expect(mobile.paneBindings.size).toBe(1);
        expect(mobile.activeTabId).toBe('one');
    });

    it('binds the active fallback when a restored manifest has no visible tab', () => {
        const state = restoreSnapshot(
            {
                schemaVersion: 1,
                tabs: [
                    {
                        id: 'tab-a',
                        resource: { kind: 'chat', threadId: 'chat-a' },
                        cachedTitle: 'Chat',
                        createdAt: 1,
                        lastActivatedAt: 1,
                        ephemeral: false,
                    },
                ],
                activeTabId: 'tab-a',
                visibleTabIds: [],
                activeVisibleIndex: 0,
                savedAt: 1,
            },
            { paneIds: ['pane-a'], paneLimit: 1 }
        );
        expect(state.activePaneId).toBe('pane-a');
        expect(state.paneBindings.get('pane-a')).toBe('tab-a');
    });

    it('repairs an invalid active pane so it matches the active tab', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = newBlankTab(state, {}, f).state;
        state.activePaneId = 'missing-pane';
        state.activeTabId = state.tabs.at(-1)!.id;

        state = reorderTab(state, 'missing-tab', 0, f);

        expect(state.activePaneId).toBe('pane-a');
        expect(state.activeTabId).toBe(state.paneBindings.get('pane-a'));
    });

    it('reconciles a direct plugin mutation without displacing a visible duplicate', () => {
        const f = factory();
        let state = createInitialState({ paneId: 'pane-a' }, f);
        state = openTab(state, { kind: 'chat', threadId: 'a' }, {}, f).state;
        const reconciled = reconcilePaneResource(
            state,
            'pane-b',
            { kind: 'chat', threadId: 'a' },
            { allowDuplicate: true },
            f
        );
        expect(reconciled.state.paneBindings.size).toBe(2);
        expect(reconciled.state.tabs).toHaveLength(2);
    });
});
