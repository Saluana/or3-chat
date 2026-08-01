import { createRuntimeUuid } from '~~/shared/runtime-id';
import {
    getCanonicalResourceKey,
    isValidWorkspaceResource,
} from '~/core/workspace-tabs/resource-key';
import type {
    ClosedTabSnapshot,
    WorkspaceResource,
    WorkspaceTab,
    WorkspaceTabOpenOptions,
    WorkspaceTabsSnapshotV1,
    WorkspaceTabsState,
} from '~/core/workspace-tabs/types';

const MAX_RECENTLY_CLOSED = 10;

export interface TransitionFactory {
    createId?: () => string;
    now?: () => number;
}

export interface OpenTabResult {
    state: WorkspaceTabsState;
    tabId: string | null;
    existing: boolean;
    reusedBlank: boolean;
}

export interface CloseTabResult {
    state: WorkspaceTabsState;
    paneToClose: string | null;
    closed: boolean;
}

function createId(factory?: TransitionFactory): string {
    return factory?.createId?.() ?? createRuntimeUuid();
}

function now(factory?: TransitionFactory, override?: number): number {
    return override ?? factory?.now?.() ?? Date.now();
}

function cloneResource(resource: WorkspaceResource): WorkspaceResource {
    return { ...resource } as WorkspaceResource;
}

function cloneTab(tab: WorkspaceTab): WorkspaceTab {
    return { ...tab, resource: cloneResource(tab.resource) };
}

function cloneState(state: WorkspaceTabsState): WorkspaceTabsState {
    return {
        tabs: state.tabs.map(cloneTab),
        activeTabId: state.activeTabId,
        activePaneId: state.activePaneId,
        paneBindings: new Map(state.paneBindings),
        runtime: new Map(state.runtime),
        recentlyClosed: state.recentlyClosed.map((snapshot) => ({
            ...snapshot,
            tab: cloneTab(snapshot.tab),
        })),
    };
}

function blankTab(id: string, timestamp: number): WorkspaceTab {
    return {
        id,
        resource: { kind: 'chat', threadId: null },
        cachedTitle: 'New chat',
        createdAt: timestamp,
        lastActivatedAt: timestamp,
        ephemeral: true,
    };
}

function defaultTitle(resource: WorkspaceResource): string {
    if (resource.kind === 'chat') return resource.threadId ? 'Chat' : 'New chat';
    if (resource.kind === 'document') return 'Untitled document';
    return resource.appId;
}

function isBlankChat(tab: WorkspaceTab | undefined): boolean {
    return Boolean(
        tab?.ephemeral &&
            tab.resource.kind === 'chat' &&
            tab.resource.threadId === null
    );
}

function findPaneForTab(state: WorkspaceTabsState, tabId: string): string | null {
    for (const [paneId, boundTabId] of state.paneBindings) {
        if (boundTabId === tabId) return paneId;
    }
    return null;
}

function removeTabBindings(state: WorkspaceTabsState, tabId: string): void {
    for (const [paneId, boundTabId] of state.paneBindings) {
        if (boundTabId === tabId) state.paneBindings.delete(paneId);
    }
}

function nearestHiddenTab(state: WorkspaceTabsState, fromIndex: number): WorkspaceTab | undefined {
    const visible = new Set(state.paneBindings.values());
    return state.tabs
        .filter((tab) => !visible.has(tab.id))
        .sort((a, b) => {
            const aDistance = Math.abs(state.tabs.indexOf(a) - fromIndex);
            const bDistance = Math.abs(state.tabs.indexOf(b) - fromIndex);
            return aDistance - bDistance || state.tabs.indexOf(a) - state.tabs.indexOf(b);
        })[0];
}

function repairState(state: WorkspaceTabsState, factory?: TransitionFactory): WorkspaceTabsState {
    const repaired = cloneState(state);
    const seen = new Set<string>();
    repaired.tabs = repaired.tabs.filter((tab) => {
        if (!tab.id || seen.has(tab.id) || !isValidWorkspaceResource(tab.resource)) {
            return false;
        }
        seen.add(tab.id);
        return true;
    });
    if (!repaired.tabs.length) {
        const timestamp = now(factory);
        let id = createId(factory);
        while (seen.has(id)) id = createId(factory);
        repaired.tabs.push(blankTab(id, timestamp));
        seen.add(id);
    }

    const uniqueBindings = new Map<string, string>();
    const boundTabs = new Set<string>();
    for (const [paneId, tabId] of repaired.paneBindings) {
        if (!paneId || !seen.has(tabId) || boundTabs.has(tabId)) continue;
        uniqueBindings.set(paneId, tabId);
        boundTabs.add(tabId);
    }
    repaired.paneBindings = uniqueBindings;
    for (const tabId of [...repaired.runtime.keys()]) {
        if (!seen.has(tabId)) repaired.runtime.delete(tabId);
    }

    if (
        repaired.activePaneId &&
        !repaired.paneBindings.has(repaired.activePaneId)
    ) {
        repaired.activePaneId = repaired.paneBindings.keys().next().value ?? null;
    }
    if (!repaired.activePaneId && repaired.paneBindings.size) {
        repaired.activePaneId = repaired.paneBindings.keys().next().value ?? null;
    }
    const activePaneTab = repaired.activePaneId
        ? repaired.paneBindings.get(repaired.activePaneId)
        : undefined;
    if (activePaneTab) repaired.activeTabId = activePaneTab;
    else if (!seen.has(repaired.activeTabId)) repaired.activeTabId = repaired.tabs[0]!.id;
    return repaired;
}

export function createInitialState(
    options: { paneId?: string; tabId?: string; now?: number } = {},
    factory?: TransitionFactory
): WorkspaceTabsState {
    const timestamp = now(factory, options.now);
    const tab = blankTab(options.tabId ?? createId(factory), timestamp);
    const paneId = options.paneId ?? 'pane-0';
    return {
        tabs: [tab],
        activeTabId: tab.id,
        activePaneId: paneId,
        paneBindings: new Map([[paneId, tab.id]]),
        runtime: new Map(),
        recentlyClosed: [],
    };
}

export function bindTabToPane(
    input: WorkspaceTabsState,
    paneId: string,
    tabId: string,
    factory?: TransitionFactory
): WorkspaceTabsState {
    if (!paneId) return repairState(input, factory);
    const state = repairState(input, factory);
    if (!state.tabs.some((tab) => tab.id === tabId)) return state;
    removeTabBindings(state, tabId);
    state.paneBindings.set(paneId, tabId);
    state.activePaneId = paneId;
    state.activeTabId = tabId;
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (tab) tab.lastActivatedAt = now(factory);
    return repairState(state, factory);
}

export function unbindPane(
    input: WorkspaceTabsState,
    paneId: string,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const state = repairState(input, factory);
    state.paneBindings.delete(paneId);
    if (state.activePaneId === paneId) {
        state.activePaneId = state.paneBindings.keys().next().value ?? null;
        const active = state.activePaneId
            ? state.paneBindings.get(state.activePaneId)
            : undefined;
        if (active) state.activeTabId = active;
    }
    return repairState(state, factory);
}

/** Click semantics: visible tabs focus their pane; hidden tabs replace active pane. */
export function activateTab(
    input: WorkspaceTabsState,
    tabId: string,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const state = repairState(input, factory);
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (!tab) return state;
    const visiblePane = findPaneForTab(state, tabId);
    if (visiblePane) {
        state.activePaneId = visiblePane;
        state.activeTabId = tabId;
    } else {
        const paneId = state.activePaneId ?? state.paneBindings.keys().next().value;
        if (paneId) {
            removeTabBindings(state, tabId);
            state.paneBindings.set(paneId, tabId);
            state.activePaneId = paneId;
        }
        state.activeTabId = tabId;
    }
    tab.lastActivatedAt = now(factory);
    return repairState(state, factory);
}

export function openTab(
    input: WorkspaceTabsState,
    resource: WorkspaceResource,
    options: WorkspaceTabOpenOptions = {},
    factory?: TransitionFactory
): OpenTabResult {
    const state = repairState(input, factory);
    if (!isValidWorkspaceResource(resource)) {
        return { state, tabId: null, existing: false, reusedBlank: false };
    }
    const timestamp = now(factory, options.now);
    if (!options.allowDuplicate && !(resource.kind === 'chat' && resource.threadId === null)) {
        const key = getCanonicalResourceKey(resource);
        const existing = state.tabs.find(
            (tab) => getCanonicalResourceKey(tab.resource, tab.id) === key
        );
        if (existing) {
            return {
                state: activateTab(state, existing.id, factory),
                tabId: existing.id,
                existing: true,
                reusedBlank: false,
            };
        }
    }

    const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
    const active = state.tabs[activeIndex];
    if (
        options.reuseActiveBlank !== false &&
        isBlankChat(active) &&
        !(resource.kind === 'chat' && resource.threadId === null)
    ) {
        active!.resource = cloneResource(resource);
        active!.cachedTitle = defaultTitle(resource);
        active!.ephemeral = false;
        active!.lastActivatedAt = timestamp;
        return {
            state: repairState(state, factory),
            tabId: active!.id,
            existing: false,
            reusedBlank: true,
        };
    }

    let id = options.id ?? createId(factory);
    while (state.tabs.some((tab) => tab.id === id)) id = createId(factory);
    const tab: WorkspaceTab = {
        id,
        resource: cloneResource(resource),
        cachedTitle: defaultTitle(resource),
        createdAt: timestamp,
        lastActivatedAt: timestamp,
        ephemeral: resource.kind === 'chat' && resource.threadId === null,
    };
    state.tabs.splice(Math.max(0, activeIndex + 1), 0, tab);
    state.activeTabId = tab.id;
    return { state: repairState(state, factory), tabId: tab.id, existing: false, reusedBlank: false };
}

export function newBlankTab(
    input: WorkspaceTabsState,
    options: WorkspaceTabOpenOptions = {},
    factory?: TransitionFactory
): OpenTabResult {
    const state = repairState(input, factory);
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (options.reuseActiveBlank !== false && isBlankChat(active)) {
        return { state, tabId: active!.id, existing: true, reusedBlank: true };
    }
    return openTab(state, { kind: 'chat', threadId: null }, options, factory);
}

export function closeTab(
    input: WorkspaceTabsState,
    tabId: string,
    factory?: TransitionFactory
): CloseTabResult {
    const state = repairState(input, factory);
    const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);
    const tab = state.tabs[tabIndex];
    if (!tab) return { state, paneToClose: null, closed: false };

    const paneId = findPaneForTab(state, tabId);
    const snapshot: ClosedTabSnapshot = {
        tab: cloneTab(tab),
        tabIndex,
        runtime: state.runtime.get(tabId),
        closedAt: now(factory),
    };
    state.tabs.splice(tabIndex, 1);
    state.runtime.delete(tabId);
    removeTabBindings(state, tabId);
    state.recentlyClosed.unshift(snapshot);
    state.recentlyClosed = state.recentlyClosed.slice(0, MAX_RECENTLY_CLOSED);

    let paneToClose: string | null = null;
    if (paneId) {
        const replacement = nearestHiddenTab(state, tabIndex);
        if (replacement) {
            state.paneBindings.set(paneId, replacement.id);
            state.activePaneId = paneId;
            state.activeTabId = replacement.id;
        } else if (state.paneBindings.size > 0) {
            paneToClose = paneId;
            state.activePaneId = state.paneBindings.keys().next().value ?? null;
            const active = state.activePaneId
                ? state.paneBindings.get(state.activePaneId)
                : undefined;
            if (active) state.activeTabId = active;
        }
    }

    if (!state.tabs.length) {
        const fallback = blankTab(createId(factory), now(factory));
        state.tabs.push(fallback);
        state.activeTabId = fallback.id;
        if (paneId) {
            state.paneBindings.set(paneId, fallback.id);
            state.activePaneId = paneId;
            paneToClose = null;
        }
    }
    return { state: repairState(state, factory), paneToClose, closed: true };
}

/** Closing a split unbinds its tab but never removes that tab from the session. */
export function closeSplit(
    input: WorkspaceTabsState,
    paneId: string,
    factory?: TransitionFactory
): WorkspaceTabsState {
    return unbindPane(input, paneId, factory);
}

export function reorderTab(
    input: WorkspaceTabsState,
    tabId: string,
    destinationIndex: number,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const state = repairState(input, factory);
    const from = state.tabs.findIndex((tab) => tab.id === tabId);
    if (from < 0 || !Number.isFinite(destinationIndex)) return state;
    const [tab] = state.tabs.splice(from, 1);
    if (!tab) return state;
    const target = Math.max(0, Math.min(state.tabs.length, Math.trunc(destinationIndex)));
    state.tabs.splice(target, 0, tab);
    return repairState(state, factory);
}

export function promoteBlankChat(
    input: WorkspaceTabsState,
    tabId: string,
    threadId: string,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const state = repairState(input, factory);
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (!tab || !isBlankChat(tab) || !threadId.trim()) return state;
    tab.resource = { kind: 'chat', threadId: threadId.trim() };
    tab.ephemeral = false;
    tab.cachedTitle = 'Chat';
    tab.lastActivatedAt = now(factory);
    return repairState(state, factory);
}

export function markResourceDeleted(
    input: WorkspaceTabsState,
    resource: WorkspaceResource,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const key = getCanonicalResourceKey(resource);
    if (!key) return repairState(input, factory);
    let state = repairState(input, factory);
    for (const tab of [...state.tabs]) {
        if (getCanonicalResourceKey(tab.resource, tab.id) !== key) continue;
        const closed = closeTab(state, tab.id, factory);
        state = closed.state;
        state.recentlyClosed = state.recentlyClosed.filter(
            (snapshot) => snapshot.tab.id !== tab.id
        );
    }
    return repairState(state, factory);
}

export function reopenClosedTab(
    input: WorkspaceTabsState,
    factory?: TransitionFactory
): WorkspaceTabsState {
    const state = repairState(input, factory);
    const snapshot = state.recentlyClosed.shift();
    if (!snapshot) return state;
    const tab = cloneTab(snapshot.tab);
    if (state.tabs.some((entry) => entry.id === tab.id)) tab.id = createId(factory);
    const index = Math.max(0, Math.min(state.tabs.length, snapshot.tabIndex));
    state.tabs.splice(index, 0, tab);
    if (snapshot.runtime) state.runtime.set(tab.id, snapshot.runtime);
    return activateTab(state, tab.id, factory);
}

export function restoreSnapshot(
    snapshot: WorkspaceTabsSnapshotV1,
    options: { paneIds: string[]; paneLimit: number; isMobile?: boolean },
    factory?: TransitionFactory
): WorkspaceTabsState {
    const paneIds = options.paneIds.filter(Boolean);
    const initial = createInitialState(
        { paneId: paneIds[0] ?? 'pane-0' },
        factory
    );
    const state: WorkspaceTabsState = {
        ...initial,
        tabs: snapshot.tabs.map(cloneTab),
        activeTabId: snapshot.activeTabId,
        paneBindings: new Map(),
        runtime: new Map(),
        recentlyClosed: [],
    };
    const limit = options.isMobile ? 1 : Math.max(1, options.paneLimit);
    const visible = snapshot.visibleTabIds.slice(0, limit);
    for (const [index, tabId] of visible.entries()) {
        const paneId = paneIds[index];
        if (paneId) state.paneBindings.set(paneId, tabId);
    }
    const activePaneId = paneIds[Math.min(snapshot.activeVisibleIndex, visible.length - 1)];
    state.activePaneId = activePaneId ?? paneIds[0] ?? null;
    const activeVisible = state.activePaneId
        ? state.paneBindings.get(state.activePaneId)
        : undefined;
    if (activeVisible) state.activeTabId = activeVisible;
    const repaired = repairState(state, factory);
    // A valid persisted manifest may have no visible tabs (for example after
    // inaccessible resources are filtered during restore). Reattach the active
    // tab to the first available pane so the workspace never restores blank.
    if (paneIds[0] && !repaired.paneBindings.size) {
        return bindTabToPane(repaired, paneIds[0], repaired.activeTabId, factory);
    }
    return repaired;
}

/** Keeps legacy plugin pane mutations compatible with the tab session. */
export function reconcilePaneResource(
    input: WorkspaceTabsState,
    paneId: string,
    resource: WorkspaceResource,
    options: { allowDuplicate?: boolean } = {},
    factory?: TransitionFactory
): OpenTabResult {
    const opened = openTab(input, resource, {
        allowDuplicate: options.allowDuplicate,
        reuseActiveBlank: false,
    }, factory);
    if (!opened.tabId) return opened;
    return {
        ...opened,
        state: bindTabToPane(opened.state, paneId, opened.tabId, factory),
    };
}
