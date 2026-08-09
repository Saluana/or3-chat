import { computed, shallowRef, type ComputedRef, type Ref } from 'vue';
import type {
    WorkspaceResource,
    WorkspaceTab,
    WorkspaceTabRuntime,
    WorkspaceTabsState,
} from '~/core/workspace-tabs/types';
import {
    activateTab as transitionActivateTab,
    bindTabToPane,
    closeSplit as transitionCloseSplit,
    closeTab as transitionCloseTab,
    createInitialState,
    newBlankTab,
    openTab,
    promoteBlankChat as transitionPromoteBlankChat,
    reconcilePaneResource as transitionReconcilePaneResource,
    reopenClosedTab as transitionReopenClosedTab,
    reorderTab as transitionReorderTab,
    restoreSnapshot,
} from './workspace-tab-transitions';
import {
    useWorkspaceTabPersistence,
    type WorkspaceTabStorage,
} from './useWorkspaceTabPersistence';
import {
    createPaneActivationCoordinator,
    type PaneActivation,
    type WorkspaceTabHost,
} from './useWorkspaceTabHost';

type ActivationReason = 'pointer' | 'keyboard' | 'restore' | 'command';

function measureWorkspaceTabAction(action: string): () => void {
    if (
        !import.meta.dev ||
        typeof performance === 'undefined' ||
        typeof performance.mark !== 'function' ||
        typeof performance.measure !== 'function'
    ) {
        return () => undefined;
    }
    const id = `workspace-tabs:${action}:${Math.random().toString(36).slice(2)}`;
    performance.mark(`${id}:start`);
    return () => {
        performance.mark(`${id}:end`);
        performance.measure(`workspace-tabs:${action}`, `${id}:start`, `${id}:end`);
    };
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function resourceEqual(a: WorkspaceResource, b: WorkspaceResource): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'chat' && b.kind === 'chat') return a.threadId === b.threadId;
    if (a.kind === 'document' && b.kind === 'document') {
        return a.documentId === b.documentId;
    }
    if (a.kind === 'app' && b.kind === 'app') {
        return (
            a.appId === b.appId &&
            a.recordId === b.recordId &&
            a.instanceKey === b.instanceKey
        );
    }
    return false;
}

export interface WorkspaceTabsOptions {
    host: WorkspaceTabHost;
    paneLimit: Ref<number> | ComputedRef<number>;
    isMobile: Ref<boolean> | ComputedRef<boolean>;
    workspaceId: () => string | null | undefined;
    profileId: () => string | null | undefined;
    storage?: WorkspaceTabStorage | null;
    /** Capture should make the outgoing view locally safe, never remotely block. */
    captureOutgoing?: (
        tabId: string,
        paneId: string,
        activation: PaneActivation
    ) => Promise<void>;
    restoreIncoming?: (
        tabId: string,
        paneId: string,
        activation: PaneActivation
    ) => Promise<void>;
    /** Removes records deleted or no longer accessible before pane binding. */
    filterRestoredTabs?: (
        tabs: readonly WorkspaceTab[]
    ) => Promise<readonly string[]>;
    onError?: (error: unknown, context: { tabId: string; action: string }) => void;
}

/**
 * Reactive orchestration for the local tab session. The host adapter owns the
 * mounted panes; this composable owns only the tab manifest and activation
 * transaction.
 */
export function useWorkspaceTabs(options: WorkspaceTabsOptions) {
    const firstPaneId = options.host.activePaneId() ?? options.host.paneIds()[0] ?? 'pane-0';
    const state = shallowRef<WorkspaceTabsState>(
        createInitialState({ paneId: firstPaneId })
    );
    const coordinator = createPaneActivationCoordinator();
    let scopeGeneration = 0;
    let persistenceSuspensions = 0;
    const persistence = useWorkspaceTabPersistence({
        state,
        paneIds: options.host.paneIds,
        workspaceId: options.workspaceId,
        profileId: options.profileId,
        storage: options.storage,
    });

    function commit(next: WorkspaceTabsState): void {
        state.value = next;
        if (!persistenceSuspensions) persistence.schedule();
    }

    function tabById(tabId: string) {
        return state.value.tabs.find((tab) => tab.id === tabId);
    }

    function updateRuntime(
        tabId: string,
        patch: Partial<WorkspaceTabRuntime>
    ): void {
        if (!tabById(tabId)) return;
        const runtime = new Map(state.value.runtime);
        runtime.set(tabId, {
            status: 'idle',
            ...runtime.get(tabId),
            ...patch,
        });
        commit({ ...state.value, runtime });
    }

    function updateCachedTitle(tabId: string, title: string): void {
        const normalized = title.trim().slice(0, 300);
        const current = tabById(tabId);
        if (!current || !normalized || current.cachedTitle === normalized) return;
        commit({
            ...state.value,
            tabs: state.value.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, cachedTitle: normalized } : tab
            ),
        });
    }

    async function bindResourceToPane(
        paneId: string,
        resource: WorkspaceResource,
        activation: PaneActivation
    ): Promise<void> {
        const finishMeasure = measureWorkspaceTabAction('bind');
        try {
            await options.host.bindResourceToPane(paneId, resource, activation);
        } finally {
            finishMeasure();
        }
    }

    async function activateTab(
        tabId: string,
        reason: ActivationReason = 'pointer',
        forceBind = false
    ): Promise<boolean> {
        const finishMeasure = measureWorkspaceTabAction('activate');
        try {
            const before = state.value;
            const target = before.tabs.find((tab) => tab.id === tabId);
            if (!target) return false;
            const visiblePane = [...before.paneBindings.entries()].find(
                ([, boundTabId]) => boundTabId === tabId
            )?.[0];
            const next = transitionActivateTab(before, tabId);
            const paneId = next.activePaneId;
            if (!paneId) return false;
            const activation = coordinator.begin(paneId);
            commit(next);
            options.host.focusPane(paneId);

            // A tab visible in another split already owns its component tree.
            if (visiblePane === paneId && !forceBind) return true;

            updateRuntime(tabId, { status: 'loading', errorMessage: undefined });

            const outgoingTabId = before.paneBindings.get(paneId);
            try {
                if (outgoingTabId && outgoingTabId !== tabId) {
                    await options.captureOutgoing?.(outgoingTabId, paneId, activation);
                    if (!activation.isCurrent()) return false;
                }
                await bindResourceToPane(
                    paneId,
                    target.resource,
                    activation
                );
                if (!activation.isCurrent()) return false;
                await options.restoreIncoming?.(tabId, paneId, activation);
                if (!activation.isCurrent()) return false;
                updateRuntime(tabId, { status: 'idle' });
                return true;
            } catch (error) {
                if (isAbortError(error) || !activation.isCurrent()) return false;
                commit(before);
                updateRuntime(tabId, {
                    status: 'error',
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : 'Unable to open tab',
                });
                options.onError?.(error, { tabId, action: 'activate' });
                return false;
            }
        } finally {
            finishMeasure();
        }
    }

    async function openResource(
        resource: WorkspaceResource,
        options_: {
            target?: 'active' | 'background' | 'split';
            allowDuplicate?: boolean;
            reuseActiveBlank?: boolean;
        } = {}
    ): Promise<string | null> {
        const finishMeasure = measureWorkspaceTabAction('open');
        try {
        if (options_.target === 'split') return openInSplit(resource, options_);
        const opened = openTab(state.value, resource, {
            allowDuplicate: options_.allowDuplicate,
            reuseActiveBlank: options_.reuseActiveBlank,
        });
        commit(opened.state);
        if (!opened.tabId || options_.target === 'background') return opened.tabId;
        await activateTab(opened.tabId, 'command', true);
        return opened.tabId;
        } finally {
            finishMeasure();
        }
    }

    async function newTab(): Promise<string | null> {
        const finishMeasure = measureWorkspaceTabAction('new');
        try {
        // A user explicitly pressed New tab: do not reuse the current blank
        // composer, even when it has not received any text yet.
        const opened = newBlankTab(state.value, { reuseActiveBlank: false });
        commit(opened.state);
        if (opened.tabId) await activateTab(opened.tabId, 'command');
        return opened.tabId;
        } finally {
            finishMeasure();
        }
    }

    async function newSplit(): Promise<string | null> {
        const paneId = options.host.addPane();
        if (!paneId) return null;
        const opened = newBlankTab(state.value, { reuseActiveBlank: false });
        if (!opened.tabId) return null;
        commit(bindTabToPane(opened.state, paneId, opened.tabId));
        await activateTab(opened.tabId, 'command', true);
        return opened.tabId;
    }

    async function openInSplit(
        resource: WorkspaceResource,
        options_: { allowDuplicate?: boolean } = {}
    ): Promise<string | null> {
        const opened = openTab(state.value, resource, {
            allowDuplicate: options_.allowDuplicate ?? true,
            reuseActiveBlank: false,
        });
        if (!opened.tabId) return null;
        if (opened.existing) {
            commit(opened.state);
            await activateTab(opened.tabId, 'command');
            return opened.tabId;
        }
        const paneId = options.host.addPane();
        if (!paneId) return null;
        commit(bindTabToPane(opened.state, paneId, opened.tabId));
        await activateTab(opened.tabId, 'command', true);
        return opened.tabId;
    }

    async function closeTab(tabId: string): Promise<boolean> {
        const finishMeasure = measureWorkspaceTabAction('close');
        try {
        const before = state.value;
        const paneId = [...before.paneBindings.entries()].find(
            ([, boundTabId]) => boundTabId === tabId
        )?.[0];
        const activation = paneId ? coordinator.begin(paneId) : null;
        try {
            if (paneId && activation) {
                await options.captureOutgoing?.(tabId, paneId, activation);
                if (!activation.isCurrent()) return false;
            }
        } catch (error) {
            if (!isAbortError(error)) options.onError?.(error, { tabId, action: 'close' });
            return false;
        }

        const closed = transitionCloseTab(before, tabId);
        if (!closed.closed) return false;
        commit(closed.state);
        if (closed.paneToClose) {
            coordinator.cancel(closed.paneToClose);
            await options.host.closePane(closed.paneToClose);
            return true;
        }
        if (paneId) {
            const replacementId = closed.state.paneBindings.get(paneId);
            const replacement = replacementId
                ? closed.state.tabs.find((tab) => tab.id === replacementId)
                : undefined;
            if (replacement) {
                // Keep restore and failure behavior identical to a direct tab
                // switch after the close has committed.
                await activateTab(replacement.id, 'command', true);
            }
        }
        return true;
        } finally {
            finishMeasure();
        }
    }

    async function closeSplit(paneId = state.value.activePaneId): Promise<boolean> {
        if (!paneId || options.host.paneIds().length <= 1) return false;
        const tabId = state.value.paneBindings.get(paneId);
        const activation = coordinator.begin(paneId);
        try {
            if (tabId) await options.captureOutgoing?.(tabId, paneId, activation);
            if (!activation.isCurrent()) return false;
            commit(transitionCloseSplit(state.value, paneId));
            coordinator.cancel(paneId);
            await options.host.closePane(paneId);
            return true;
        } catch (error) {
            if (!isAbortError(error) && tabId) {
                options.onError?.(error, { tabId, action: 'close-split' });
            }
            return false;
        }
    }

    async function reopenClosedTab(): Promise<string | null> {
        const previous = state.value;
        if (!previous.recentlyClosed.length) return null;
        const next = transitionReopenClosedTab(previous);
        const tabId = next.activeTabId;
        if (next === previous || !next.tabs.some((tab) => tab.id === tabId)) return null;
        commit(next);
        await activateTab(tabId, 'command', true);
        return tabId;
    }

    function reorderTab(tabId: string, index: number): void {
        const finishMeasure = measureWorkspaceTabAction('reorder');
        commit(transitionReorderTab(state.value, tabId, index));
        finishMeasure();
    }

    function promoteBlankChat(tabId: string, threadId: string): void {
        commit(transitionPromoteBlankChat(state.value, tabId, threadId));
    }

    function paneClosedExternally(paneId: string): void {
        coordinator.cancel(paneId);
        commit(transitionCloseSplit(state.value, paneId));
    }

    async function applySnapshot(
        snapshot: ReturnType<typeof persistence.restore>,
        generation: number
    ): Promise<boolean> {
        if (!snapshot || generation !== scopeGeneration) return false;
        if (options.filterRestoredTabs) {
            try {
                const available = new Set(
                    await options.filterRestoredTabs(snapshot.tabs)
                );
                if (generation !== scopeGeneration) return false;
                const tabs = snapshot.tabs.filter((tab) => available.has(tab.id));
                if (tabs.length !== snapshot.tabs.length) {
                    const visibleTabIds = snapshot.visibleTabIds.filter((tabId) =>
                        available.has(tabId)
                    );
                    snapshot = {
                        ...snapshot,
                        tabs,
                        activeTabId:
                            available.has(snapshot.activeTabId)
                                ? snapshot.activeTabId
                                : tabs[0]?.id ?? snapshot.activeTabId,
                        visibleTabIds,
                        activeVisibleIndex: Math.min(
                            snapshot.activeVisibleIndex,
                            Math.max(0, visibleTabIds.length - 1)
                        ),
                    };
                }
            } catch (error) {
                // Local metadata may be unavailable while the shell starts.
                // Keep a validated snapshot rather than discarding a session.
                options.onError?.(error, {
                    tabId: snapshot.activeTabId,
                    action: 'filter-restore',
                });
            }
        }
        if (generation !== scopeGeneration) return false;
        const wantedPaneCount = Math.max(
            1,
            Math.min(
                snapshot.visibleTabIds.length,
                options.isMobile.value ? 1 : Math.max(1, options.paneLimit.value)
            )
        );
        while (options.host.paneIds().length > wantedPaneCount) {
            const paneId = options.host.paneIds().at(-1);
            if (!paneId) break;
            coordinator.cancel(paneId);
            await options.host.closePane(paneId);
            if (generation !== scopeGeneration) return false;
        }
        while (options.host.paneIds().length < wantedPaneCount) {
            if (!options.host.addPane()) break;
        }
        const restored = restoreSnapshot(snapshot, {
            paneIds: options.host.paneIds(),
            paneLimit: options.paneLimit.value,
            isMobile: options.isMobile.value,
        });
        commit(restored);
        if (restored.activePaneId) options.host.focusPane(restored.activePaneId);
        for (const [paneId, tabId] of restored.paneBindings) {
            const tab = restored.tabs.find((entry) => entry.id === tabId);
            if (!tab) continue;
            const activation = coordinator.begin(paneId);
            await bindResourceToPane(paneId, tab.resource, activation);
            if (!activation.isCurrent() || generation !== scopeGeneration) return false;
        }
        return true;
    }

    async function resetScope(generation: number): Promise<boolean> {
        while (options.host.paneIds().length > 1) {
            const paneId = options.host.paneIds().at(-1);
            if (!paneId) break;
            coordinator.cancel(paneId);
            await options.host.closePane(paneId);
            if (generation !== scopeGeneration) return false;
        }
        const paneId = options.host.paneIds()[0] ?? options.host.addPane();
        if (!paneId || generation !== scopeGeneration) return false;
        const next = createInitialState({ paneId });
        commit(next);
        options.host.focusPane(paneId);
        const activation = coordinator.begin(paneId);
        await bindResourceToPane(paneId, next.tabs[0]!.resource, activation);
        return activation.isCurrent() && generation === scopeGeneration;
    }

    async function restore(): Promise<boolean> {
        const finishMeasure = measureWorkspaceTabAction('restore');
        const generation = ++scopeGeneration;
        try {
            return applySnapshot(persistence.restore(), generation);
        } finally {
            finishMeasure();
        }
    }

    async function switchScope(
        workspaceId: string | null | undefined,
        profileId: string | null | undefined
    ): Promise<boolean> {
        const generation = ++scopeGeneration;
        persistenceSuspensions += 1;
        try {
            const snapshot = persistence.switchScope(workspaceId, profileId);
            // Clear mounted content before any asynchronous metadata lookup so
            // the previous workspace can never remain visible in the new one.
            const paneIds = options.host.paneIds();
            const firstPaneId = paneIds[0] ?? options.host.addPane();
            if (!firstPaneId) return false;
            const blank = createInitialState({ paneId: firstPaneId });
            commit(blank);
            options.host.focusPane(firstPaneId);
            const clearing = options.host.paneIds().map(async (paneId) => {
                const activation = coordinator.begin(paneId);
                await bindResourceToPane(
                    paneId,
                    { kind: 'chat', threadId: null },
                    activation
                );
                return activation.isCurrent();
            });
            if (!(await Promise.all(clearing)).every(Boolean)) return false;
            if (generation !== scopeGeneration) return false;
            return snapshot
                ? await applySnapshot(snapshot, generation)
                : await resetScope(generation);
        } finally {
            persistenceSuspensions -= 1;
            if (!persistenceSuspensions && generation === scopeGeneration) {
                persistence.schedule();
            }
        }
    }

    /** Adopt an existing external pane mutation without rebinding it. */
    function reconcilePaneResource(
        paneId: string,
        resource: WorkspaceResource,
        options_: {
            allowDuplicate?: boolean;
            replaceCurrent?: boolean;
        } = {}
    ): string | null {
        const currentTabId = state.value.paneBindings.get(paneId);
        const current = currentTabId ? tabById(currentTabId) : undefined;
        if (current && resourceEqual(current.resource, resource)) return current.id;
        if (
            current?.ephemeral &&
            current.resource.kind === 'chat' &&
            current.resource.threadId === null
        ) {
            const focused = transitionActivateTab(state.value, current.id);
            const opened = openTab(focused, resource, { reuseActiveBlank: true });
            if (opened.tabId) {
                commit(bindTabToPane(opened.state, paneId, opened.tabId));
            }
            return opened.tabId;
        }
        const alreadyVisibleElsewhere = state.value.tabs.some((tab) => {
            if (!resourceEqual(tab.resource, resource)) return false;
            const boundPane = [...state.value.paneBindings.entries()].find(
                ([, tabId]) => tabId === tab.id
            )?.[0];
            return boundPane !== undefined && boundPane !== paneId;
        });
        const existingTarget = state.value.tabs.find((tab) =>
            resourceEqual(tab.resource, resource)
        );
        if (options_.replaceCurrent && current && !existingTarget) {
            commit({
                ...state.value,
                tabs: state.value.tabs.map((tab) =>
                    tab.id === current.id
                        ? {
                              ...tab,
                              resource: { ...resource } as WorkspaceResource,
                              cachedTitle:
                                  resource.kind === 'app'
                                      ? resource.appId
                                      : tab.cachedTitle,
                              ephemeral: false,
                              lastActivatedAt: Date.now(),
                          }
                        : tab
                ),
                activeTabId: current.id,
            });
            return current.id;
        }
        const reconciled = transitionReconcilePaneResource(
            state.value,
            paneId,
            resource,
            {
                allowDuplicate:
                    options_.allowDuplicate ?? alreadyVisibleElsewhere,
            }
        );
        if (import.meta.dev) {
            console.debug('[workspace-tabs] reconciled external pane resource', {
                paneId,
                tabId: reconciled.tabId,
                resource,
            });
        }
        commit(reconciled.state);
        return reconciled.tabId;
    }

    return {
        state,
        tabs: computed(() => state.value.tabs),
        activeTabId: computed(() => state.value.activeTabId),
        activePaneId: computed(() => state.value.activePaneId),
        visibleTabIds: computed(() => new Set(state.value.paneBindings.values())),
        statusByTabId: computed(
            () => new Map(
                [...state.value.runtime].map(([tabId, runtime]) => [
                    tabId,
                    runtime.status,
                ])
            )
        ),
        canCloseSplit: computed(() => options.host.paneIds().length > 1),
        openResource,
        newTab,
        activateTab,
        closeTab,
        reopenClosedTab,
        reorderTab,
        promoteBlankChat,
        newSplit,
        closeSplit,
        openInSplit,
        restore,
        switchScope,
        reconcilePaneResource,
        paneClosedExternally,
        updateRuntime,
        updateCachedTitle,
        flushPersistence: persistence.flush,
    };
}
