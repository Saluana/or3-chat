<template>
    <resizable-sidebar-layout :collapsed-width="64" ref="layoutRef">
        <template #sidebar-expanded>
            <component
                :is="sidebarExpandedComponent"
                ref="sideNavExpandedRef"
                :active-thread="activeChatThreadId"
                @chat-selected="onSidebarSelected"
                @new-chat="onNewChat"
                @new-document="onNewDocument"
                @document-selected="onDocumentSelected"
                @toggle-dashboard="toggleDashboard"
            />
        </template>
        <template #sidebar-collapsed>
            <component
                :is="sidebarCollapsedComponent"
                :active-thread="activeChatThreadId"
                class="w-[64px]"
                @new-chat="onNewChat"
                @new-document="openCollapsedCreateDocumentModal"
                @new-project="openCollapsedCreateProjectModal"
                @focus-search="openCommandPalette"
                @toggle-dashboard="toggleDashboard"
                @expand-sidebar="expandSidebar"
            />
        </template>
        <div
            class="flex-1 h-dvh w-full relative flex flex-col"
            :class="legacyCompatClasses.height"
            :style="paneChromeClearanceStyle"
            :data-workspace-profile="resolvedProfile.id"
            :data-profile-pane-limit="
                resolvedProfile.workspace.desktopPaneLimit
            "
            :data-profile-mobile-policy="
                resolvedProfile.workspace.mobilePolicy
            "
        >
            <WorkspaceChrome
                v-if="workspaceTabsChromeVisible"
                ref="workspaceChromeRef"
                :tabs="workspaceTabs.tabs.value"
                :active-tab-id="workspaceTabs.activeTabId.value"
                :visible-tab-ids="workspaceTabs.visibleTabIds.value"
                :status-by-tab-id="workspaceTabs.statusByTabId.value"
                :icon-by-tab-id="workspaceTabIcons"
                :can-open-split="canAddPane"
                :can-reopen-closed="workspaceTabs.state.value.recentlyClosed.length > 0"
                :copyable-tab-ids="workspaceCopyableTabIds"
                :mobile="isMobile"
                @activate="onWorkspaceTabActivate"
                @close="onWorkspaceTabClose"
                :can-create-document="documentsEnabled"
                :can-create-workflow="canCreateWorkflowTab"
                :can-create-agent="canCreateAgentTab"
                @new-tab="onWorkspaceNewTab"
                @create-tab="onWorkspaceCreateTab"
                @reorder="onWorkspaceTabReorder"
                @open-in-split="openWorkspaceTabInSplit($event)"
                @close-other="closeOtherWorkspaceTabs($event)"
                @close-right="closeWorkspaceTabsToRight($event)"
                @reopen-closed="workspaceTabs.reopenClosedTab()"
                @copy-link="copyWorkspaceTabLink($event)"
            >
                <template #sidebar>
                    <UTooltip :delay-duration="0" text="Open sidebar">
                        <UButton
                            v-theme="'shell.split-new'"
                            v-bind="sidebarToggleButtonProps"
                            :square="true"
                            aria-label="Open sidebar"
                            title="Open sidebar"
                            :icon="useIcon('ui.menu').value"
                            @click="openMobileSidebar"
                        />
                    </UTooltip>
                </template>
                <template #brand>
                    <span class="px-1 text-sm font-semibold truncate">OR3</span>
                </template>
                <template #actions>
                    <UTooltip
                        v-if="!isMobile"
                        :delay-duration="0"
                        :text="newSplitTooltip"
                    >
                        <UButton
                            v-theme="'shell.split-new'"
                            v-bind="newPaneButtonProps"
                            class="workspace-chrome-action"
                            :square="true"
                            :disabled="!canAddPane"
                            aria-label="New split"
                            title="New split"
                            :icon="useIcon('shell.pane.add').value"
                            @click="workspaceTabs.newSplit()"
                        />
                    </UTooltip>
                    <UTooltip
                        v-if="!isMobile && workspaceTabs.canCloseSplit.value"
                        :delay-duration="0"
                        text="Close split"
                    >
                        <UButton
                            v-bind="paneCloseButtonProps"
                            class="workspace-chrome-action"
                            :square="true"
                            aria-label="Close split"
                            title="Close split"
                            :icon="useIcon('shell.pane.close').value"
                            @click="workspaceTabs.closeSplit()"
                        />
                    </UTooltip>
                    <UTooltip
                        v-if="!isMobile"
                        :delay-duration="0"
                        text="Toggle theme"
                    >
                        <UButton
                            v-bind="themeToggleButtonProps"
                            class="workspace-chrome-action"
                            :square="true"
                            :aria-label="themeAriaLabel"
                            :title="themeAriaLabel"
                            :icon="themeToggleIcon"
                            @click="toggleTheme"
                        />
                    </UTooltip>
                    <NotificationsNotificationBell
                        v-if="showNotificationBell"
                        :button-props="notificationButtonProps"
                        button-class="workspace-chrome-action"
                        compact
                        popover-side="bottom"
                        popover-align="end"
                        tooltip-side="bottom"
                    />
                    <UDropdownMenu
                        v-if="chromeOverflowMenuItems?.length"
                        :items="chromeOverflowMenuItems"
                        :content="{ align: 'end' }"
                    >
                        <UTooltip :delay-duration="0" text="More actions">
                            <UButton
                                v-bind="headerActionButtonProps"
                                class="workspace-chrome-action"
                                :square="true"
                                aria-label="More actions"
                                title="More actions"
                                icon="i-lucide-ellipsis"
                            />
                        </UTooltip>
                    </UDropdownMenu>
                </template>
            </WorkspaceChrome>
            <div
                v-if="!workspaceTabsChromeVisible"
                id="top-nav"
                :class="{
                    'border-(--md-inverse-surface) border-b-[var(--md-border-width)] bg-(--md-surface-variant)/20 backdrop-blur-sm':
                        panes.length > 1 || isMobile,
                    [legacyCompatClasses.borderInverse]:
                        panes.length > 1 || isMobile,
                    [legacyCompatClasses.bgSurfaceVariant20]:
                        panes.length > 1 || isMobile,
                }"
                class="absolute z-50 top-0 w-full h-[46px] inset-0 flex items-center justify-between pr-2 gap-2 pointer-events-none"
            >
                <div
                    class="h-full items-center justify-center px-4 pointer-events-auto md:hidden"
                    :class="{ flex: isMobile, hidden: !isMobile }"
                >
                    <UTooltip :delay-duration="0" text="Open sidebar">
                        <UButton
                            v-bind="sidebarToggleButtonProps"
                            :square="true"
                            aria-label="Open sidebar"
                            title="Open sidebar"
                            :icon="useIcon('ui.menu').value"
                            @click="openMobileSidebar"
                        />
                    </UTooltip>
                </div>
                <div
                    class="h-full items-center justify-center px-4 hidden md:flex"
                >
                    <UTooltip :delay-duration="0" :text="newWindowTooltip">
                        <UButton
                            v-bind="newPaneButtonProps"
                            :square="true"
                            :disabled="!canAddPane"
                            :class="[
                                'backdrop-blur pointer-events-auto mr-2',
                                !canAddPane
                                    ? 'opacity-50 cursor-not-allowed'
                                    : '',
                            ]"
                            aria-label="New window"
                            title="New window"
                            :icon="useIcon('shell.pane.add').value"
                            @click="addPane"
                        />
                    </UTooltip>
                </div>
                <div class="h-full flex items-center justify-center px-4 gap-2">
                    <UTooltip
                        v-if="!isMobile"
                        :delay-duration="0"
                        text="Toggle theme"
                    >
                        <UButton
                            v-bind="themeToggleButtonProps"
                            :square="true"
                            :class="'pointer-events-auto backdrop-blur'"
                            :aria-label="themeAriaLabel"
                            :title="themeAriaLabel"
                            :icon="
                                useIcon(
                                    themeName === 'dark'
                                        ? 'shell.theme.light'
                                        : 'shell.theme.dark'
                                ).value
                            "
                            @click="toggleTheme"
                        />
                    </UTooltip>
                    <NotificationsNotificationBell
                        v-if="showNotificationBell"
                        :button-props="notificationButtonProps"
                        button-class="pointer-events-auto backdrop-blur"
                        popover-side="bottom"
                        popover-align="end"
                        tooltip-side="bottom"
                    />
                    <div
                        v-if="headerActions.length"
                        class="h-full flex items-center gap-1 px-2 pointer-events-auto"
                    >
                        <UTooltip
                            v-for="entry in headerActions"
                            :key="`header-action-${entry.action.id}`"
                            :delay-duration="0"
                            :text="entry.action.tooltip || entry.action.label"
                        >
                            <UButton
                                v-bind="headerActionButtonProps"
                                :color="(entry.action.color || 'neutral') as any"
                                :square="!entry.action.label"
                                :disabled="entry.disabled"
                                :class="[
                                    'pointer-events-auto flex items-center gap-1',
                                    entry.action.label ? 'px-3' : '',
                                ]"
                                :aria-label="
                                    entry.action.tooltip ||
                                    entry.action.label ||
                                    entry.action.id
                                "
                                :icon="
                                    !entry.action.label
                                        ? entry.action.icon
                                        : undefined
                                "
                                :leading-icon="
                                    entry.action.label
                                        ? entry.action.icon
                                        : undefined
                                "
                                @click="() => handleHeaderAction(entry)"
                            >
                                <span
                                    v-if="entry.action.label"
                                    class="text-xs font-medium"
                                >
                                    {{ entry.action.label }}
                                </span>
                            </UButton>
                        </UTooltip>
                    </div>
                </div>
            </div>
            <div
                ref="paneContainerRef"
                :class="[
                    workspaceTabsChromeVisible
                        ? 'pt-0 flex-1 min-h-0'
                        : showTopOffset
                          ? 'pt-[46px] h-full'
                          : 'pt-0 h-full',
                    'flex flex-row gap-0 items-stretch w-full pane-container',
                ]"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    v-show="!isMobile || i === activePaneIndex"
                    class="relative flex flex-col border-l-[var(--md-border-width)] first:border-l-0 outline-none focus-visible:ring-0 overflow-visible"
                    :style="{ width: isMobile ? '100%' : getPaneWidth(i) }"
                    :class="[
                        ...(i === activePaneIndex && panes.length > 1
                            ? [
                                  'pane-active border-(--md-primary) bg-(--md-surface-variant)/10',
                                  legacyCompatClasses.borderPrimary,
                                  legacyCompatClasses.bgSurfaceVariant10,
                              ]
                            : [
                                  'border-(--md-inverse-surface)',
                                  legacyCompatClasses.borderInverse,
                              ]),
                        'transition-colors',
                        panes.length === 1 ? 'min-w-0' : '',
                    ]"
                    tabindex="0"
                    :id="workspaceTabsChromeVisible ? `workspace-pane-${tabIdForPane(pane.id)}` : undefined"
                    :role="workspaceTabsChromeVisible ? 'tabpanel' : 'region'"
                    :aria-labelledby="workspaceTabsChromeVisible ? `workspace-tab-${tabIdForPane(pane.id)}` : undefined"
                    @focus="onPaneFocused(i)"
                    @click="onPaneFocused(i)"
                >
                    <div
                        v-if="!workspaceTabsChromeVisible && panes.length > 1 && !isMobile"
                        class="absolute top-1 right-1 z-30"
                    >
                        <UTooltip :delay-duration="0" text="Close window">
                            <UButton
                                v-bind="paneCloseButtonProps"
                                :square="true"
                                aria-label="Close window"
                                title="Close window"
                                :icon="useIcon('shell.pane.close').value"
                                @click.stop="closePane(i)"
                            />
                        </UTooltip>
                    </div>

                    <component
                        :ref="(instance: any) => setPaneComponentRef(pane.id, instance)"
                        :is="resolvePaneComponent(pane)"
                        v-bind="buildPaneProps(pane, i)"
                        class="flex-1 min-h-0"
                        @thread-selected="
                            pane.mode === 'chat'
                                ? (id: string) => onInternalThreadCreated(id, i)
                                : undefined
                        "
                        @tab-status="
                            (status: WorkspaceTabStatus) => onPaneTabStatus(pane.id, status)
                        "
                        @tab-title="
                            (title: string) => onPaneTabTitle(pane.id, title)
                        "
                    />

                    <!-- Resize handle (only between panes, not after the last one) -->
                    <PaneResizeHandle
                        v-if="!isMobile && i < panes.length - 1"
                        :pane-index="i"
                        :pane-count="panes.length"
                        :is-desktop="!isMobile"
                        @resize-start="onPaneResizeStart"
                        @resize-keydown="onPaneResizeKeydown"
                    />
                </div>
            </div>
        </div>
        <component
            :is="dashboardModalComponent"
            v-if="dashboardEnabled"
            v-model:showModal="showDashboardModal"
        />
        <ClientOnly>
            <component
                :is="systemPromptsModalComponent"
                v-model:showModal="systemPromptsModalOpen"
                :mode="systemPromptsModalRequest?.mode"
                :prompt-id="systemPromptsModalRequest?.promptId"
                :thread-id="systemPromptsModalRequest?.threadId"
                :pane-id="systemPromptsModalRequest?.paneId"
                @selected="notifySystemPromptSelected"
            />
        </ClientOnly>
        <SearchCommandPalette />
    </resizable-sidebar-layout>
</template>
<script setup lang="ts">
// Generic PageShell merging chat + docs functionality.
// Props allow initializing with a thread OR a document and choosing default mode.
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { useMultiPane, type PaneState } from '~/composables/core/useMultiPane';
import { useWorkspaceTabHost } from '~/composables/core/useWorkspaceTabHost';
import { useWorkspaceTabs } from '~/composables/core/useWorkspaceTabs';
import { useWorkspaceTabMetadata } from '~/composables/core/useWorkspaceTabMetadata';
import WorkspaceChrome from '~/components/workspace-tabs/WorkspaceChrome.vue';
import type { WorkspaceNewTabCreateKind } from '~/components/workspace-tabs/WorkspaceNewTabControl.vue';
import { usePaneApps } from '~/composables/core/usePaneApps';
import {
    EXTERNAL_AGENT_LAUNCHER_REF,
    EXTERNAL_AGENT_PANE_APP_ID,
} from '~/core/external-agents/refs';
import { useExternalAgentRuntime } from '~/core/external-agents/runtime';
import { useWorkflowsCrud } from '~/plugins/workflows/composables/useWorkflows';
import {
    getActiveWorkspaceId,
    getDb,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { useHookEffect } from '~/composables/core/useHookEffect';
import {
    flush as flushDocument,
    newDocument as createNewDoc,
} from '~/composables/documents/useDocumentsStore';
import {
    captureDocumentEditor,
    getDocumentEditorSession,
    waitForDocumentEditorSession,
} from '~/composables/documents/useDocumentEditorSessions';
import {
    clearPanePendingPromptAfter,
} from '~/composables/core/usePanePrompt';
import { useWorkspaceTabDrafts } from '~/composables/core/useWorkspaceTabDrafts';
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';
import { useHeaderActions, type HeaderActionEntry } from '#imports';
import type {
    DbDeletePayload,
    ThreadEntity,
    DocumentEntity,
} from '~/core/hooks/hook-types';
import { useMagicKeys, whenever, useEventListener } from '@vueuse/core';
import {
    type Component,
    computed,
    shallowRef,
    markRaw,
    nextTick,
    watch,
} from 'vue';
import PaneUnknown from '~/components/PaneUnknown.vue';
import PaneResizeHandle from '~/components/panes/PaneResizeHandle.vue';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { usePageShellTheme } from '~/composables/core/usePageShellTheme';
import { CORE_APP_COMPONENT_DEFAULTS } from '~/theme/_shared/theme-components-registry';
import {
    validateDbRecordWithRetry,
    type ValidationStatus,
} from '~/composables/core/recordValidation';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { useIcon } from '~/composables/useIcon';
import { useOr3Config } from '~/composables/useOr3Config';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { usePaneResizeController } from '~/composables/core/usePaneResizeController';
import {
    setGlobalSidebarLayoutApi,
    type SidebarLayoutApi,
} from '~/utils/sidebarLayoutApi';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import {
    setPaletteHostContext,
    useCommandPalette,
} from '~/composables/search/useCommandPalette';
import { createPaletteHostContext } from '~/core/search/command-palette/host-context';
import { registerCorePaletteSources } from '~/core/search/command-palette/sources/register-core';
import { setWorkspaceTabPaletteProvider } from '~/core/search/command-palette/sources/workspace-tab-source';
import {
    useSystemPromptsModal,
    type SystemPromptsModalMode,
} from '~/composables/chat/useSystemPromptsModal';
import { useWorkspaceProfiles } from '~/composables/workspace-profiles/useWorkspaceProfiles';
import type { WorkspaceProfileInitialPane } from '~/core/workspace-profiles';
import type {
    WorkspaceResource,
    WorkspaceTabStatus,
} from '~/core/workspace-tabs/types';

const legacyCompatClasses = {
    height: `h-[${'100dvh'}]`,
    borderInverse: `border-[${'var(--md-inverse-surface)'}]`,
    borderPrimary: `border-[${'var(--md-primary)'}]`,
    bgSurfaceVariant20: `bg-[${'var(--md-surface-variant)'}]/20`,
    bgSurfaceVariant10: `bg-[${'var(--md-surface-variant)'}]/10`,
} as const;

const props = withDefaults(
    defineProps<{
        initialThreadId?: string;
        initialDocumentId?: string;
        validateInitial?: boolean; // applies to whichever id is provided
        routeSync?: boolean;
        defaultMode?: 'chat' | 'doc'; // used when no initial id
    }>(),
    { validateInitial: false, routeSync: true, defaultMode: 'chat' }
);

const router = useRouter();
const toast = useToast();
const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const layoutRef = ref<InstanceType<typeof ResizableSidebarLayout> | null>(null);
const sideNavExpandedRef = ref<any | null>(null);
const showDashboardModal = ref(false);
const hasSyncedInitial = ref(false);
const or3Config = useOr3Config();
const showNotificationBell = computed(
    () => runtimeConfig.public.ssrAuthEnabled === true
);
const documentsEnabled = computed(() => or3Config.features.documents.enabled);
const dashboardEnabled = computed(() => or3Config.features.dashboard.enabled);
const workspaceTabsEnabled = computed(
    () => or3Config.features.workspaceTabs.enabled
);
const canCreateWorkflowTab = computed(
    () =>
        or3Config.features.workflows.enabled &&
        or3Config.features.workflows.editor
);
const externalAgentRuntime = useExternalAgentRuntime();
const canCreateAgentTab = computed(() => {
    const snapshot = externalAgentRuntime.snapshot.value;
    if (!snapshot) return false;
    if (
        snapshot.connectionState !== 'online' &&
        snapshot.connectionState !== 'degraded'
    ) {
        return false;
    }
    return (
        externalAgentRuntime.controller
            ?.availableRunnerOptions()
            .some((runner) => runner.available) ?? false
    );
});
// Pane and tab IDs are runtime UUIDs. Render the deterministic legacy chrome
// until hydration finishes, then mount the workspace chrome with client IDs.
// This avoids server/client attribute mismatches without making IDs global.
const workspaceTabsHydrated = ref(false);
const workspaceTabsChromeVisible = computed(
    () => workspaceTabsEnabled.value && workspaceTabsHydrated.value
);
const minPaneWidth = 280;
const { isMobile } = useResponsiveState();
const {
    resolvedProfile,
    pending: workspaceProfilePending,
    initialPaneRequest,
    acknowledgeInitialPanes,
} = useWorkspaceProfiles();
const profilePaneLimit = computed(
    () => resolvedProfile.value.workspace.desktopPaneLimit
);
const multiPane = useMultiPane({
    initialThreadId: props.initialThreadId,
    maxPanes: profilePaneLimit,
    onFlushDocument: async (id) => {
        await captureDocumentEditor(id);
        await flushDocument(id);
    },
    minPaneWidth: 280,
    maxPaneWidth: 2000,
    allowMultiplePanes: computed(
        () => !isMobile.value && profilePaneLimit.value > 1
    ),
});

// ---------------- Multi-pane ----------------
const {
    panes,
    activePaneIndex,
    canAddPane,
    newWindowTooltip,
    addPane,
    closePane,
    setActive,
    focusPrev,
    focusNext,
    setPaneThread,
    loadMessagesFor,
    ensureAtLeastOne,
    newPaneForApp,
    setPaneApp,
    updatePane,
    getPaneWidth,
    handleResize,
    persistPaneWidths,
    recalculateWidthsForContainer,
    paneWidths,
} = multiPane;

const paneComponentRefs = new Map<string, any>();
const workspaceTabDrafts = useWorkspaceTabDrafts();
const workspaceTabHost = useWorkspaceTabHost(multiPane);
const workspaceTabs = useWorkspaceTabs({
    host: workspaceTabHost,
    paneLimit: profilePaneLimit,
    isMobile,
    workspaceId: () => (process.client ? getActiveWorkspaceId() : null),
    profileId: () => resolvedProfile.value.id,
    async captureOutgoing(tabId, paneId) {
        const tab = workspaceTabs.state.value.tabs.find((entry) => entry.id === tabId);
        if (!tab) return;
        if (tab.resource.kind === 'document') {
            const session = getDocumentEditorSession({ paneId, tabId });
            if (!session) return;
            workspaceTabs.updateRuntime(tabId, { status: 'saving' });
            try {
                session.captureContent();
                await session.ensureLocalDurability();
                workspaceTabs.updateRuntime(tabId, {
                    status: 'idle',
                    viewState: {
                        ...workspaceTabs.state.value.runtime.get(tabId)?.viewState,
                        document: session.captureViewState(),
                    },
                });
            } catch (error) {
                workspaceTabs.updateRuntime(tabId, {
                    status: 'error',
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : 'Document changes could not be saved locally',
                });
                throw error;
            }
            return;
        }
        const view = paneComponentRefs.get(paneId)?.captureViewState?.();
        if (view) {
            workspaceTabs.updateRuntime(tabId, {
                viewState: {
                    ...workspaceTabs.state.value.runtime.get(tabId)?.viewState,
                    chatScroll: view.scroll,
                },
            });
        }
    },
    async restoreIncoming(tabId, paneId) {
        const tab = workspaceTabs.state.value.tabs.find((entry) => entry.id === tabId);
        const viewState = workspaceTabs.state.value.runtime.get(tabId)?.viewState;
        if (!tab || !viewState) return;
        if (tab.resource.kind === 'document' && viewState.document) {
            const session = await waitForDocumentEditorSession({ paneId, tabId });
            await session?.restoreViewState(viewState.document);
            return;
        }
        await paneComponentRefs.get(paneId)?.restoreViewState?.({
            scroll: viewState.chatScroll,
        });
    },
    async filterRestoredTabs(tabs) {
        const threadIds = tabs.flatMap((tab) =>
            tab.resource.kind === 'chat' && tab.resource.threadId
                ? [tab.resource.threadId]
                : []
        );
        const documentIds = tabs.flatMap((tab) =>
            tab.resource.kind === 'document' ? [tab.resource.documentId] : []
        );
        const db = getDb();
        const [threads, documents] = await Promise.all([
            threadIds.length ? db.threads.bulkGet(threadIds) : Promise.resolve([]),
            documentIds.length ? db.posts.bulkGet(documentIds) : Promise.resolve([]),
        ]);
        const availableThreads = new Set(
            threads.flatMap((thread) =>
                thread && !thread.deleted ? [thread.id] : []
            )
        );
        const availableDocuments = new Set(
            documents.flatMap((document) =>
                document &&
                !document.deleted &&
                document.postType === 'doc'
                    ? [document.id]
                    : []
            )
        );
        return tabs
            .filter((tab) => {
                if (tab.resource.kind === 'chat') {
                    return !tab.resource.threadId || availableThreads.has(tab.resource.threadId);
                }
                if (tab.resource.kind === 'document') {
                    return availableDocuments.has(tab.resource.documentId);
                }
                // App availability can be asynchronous during plugin boot. Keep
                // its descriptor and let the existing unknown-app fallback show
                // rather than silently losing a local session entry.
                return true;
            })
            .map((tab) => tab.id);
    },
    onError(error, context) {
        console.error(`[workspace-tabs] ${context.action} failed`, error);
        toast.add({
            title: 'Tab switch failed',
            description: 'Your current content remains open. Please try again.',
            color: 'error',
        });
    },
});
const workspaceScopeId = ref<string | null>(
    process.client ? getActiveWorkspaceId() : null
);
let activeWorkspaceTabsScope = '';
const disposeWorkspaceScopeSubscription = process.client
    ? subscribeActiveWorkspaceDb(({ newWorkspaceId }) => {
          workspaceScopeId.value = newWorkspaceId;
          if (workspaceTabsReady.value && workspaceTabsEnabled.value) {
              requestWorkspaceTabsScope(
                  newWorkspaceId,
                  resolvedProfile.value.id
              );
          }
      })
    : () => undefined;

function requestWorkspaceTabsScope(
    workspaceId: string | null,
    profileId: string
): void {
    const scope = `${workspaceId ?? 'local'}\0${profileId}`;
    if (scope === activeWorkspaceTabsScope) return;
    activeWorkspaceTabsScope = scope;
    void workspaceTabs
        .switchScope(workspaceId, profileId)
        .then((switched) => {
            if (!switched || scope !== activeWorkspaceTabsScope) return;
            hasSyncedInitial.value = true;
            updateUrl(true);
        })
        .catch((error) => {
            if (scope === activeWorkspaceTabsScope) {
                activeWorkspaceTabsScope = '';
            }
            console.error('[workspace-tabs] Scope switch failed', error);
            toast.add({
                title: 'Workspace tabs could not be restored',
                description: 'Reload the workspace before continuing.',
                color: 'warning',
            });
        });
}

watch(
    [workspaceScopeId, () => resolvedProfile.value.id, workspaceProfilePending],
    ([workspaceId, profileId, profilePending]) => {
        if (
            !workspaceTabsReady.value ||
            !workspaceTabsEnabled.value ||
            profilePending
        ) {
            return;
        }
        requestWorkspaceTabsScope(workspaceId, profileId);
    }
);
const workspaceTabMetadata = useWorkspaceTabMetadata();
const workspaceTabIcons = computed(
    () =>
        new Map(
            [...workspaceTabMetadata.metadata].map(([tabId, metadata]) => [
                tabId,
                metadata.icon,
            ])
        )
);

async function refreshWorkspaceTabMetadata(): Promise<void> {
    if (!workspaceTabsEnabled.value) return;
    try {
        await workspaceTabMetadata.refresh(workspaceTabs.tabs.value);
        for (const tab of workspaceTabs.tabs.value) {
            workspaceTabs.updateCachedTitle(
                tab.id,
                workspaceTabMetadata.titleFor(tab).title
            );
        }
    } catch (error) {
        console.warn('[workspace-tabs] Failed to refresh tab titles', error);
    }
}

watch(
    () => workspaceTabs.tabs.value.map((tab) => `${tab.id}:${tab.cachedTitle}`),
    () => void refreshWorkspaceTabMetadata(),
    { immediate: true }
);
useHookEffect('db.threads.create:action:after', () =>
    void refreshWorkspaceTabMetadata()
);
useHookEffect('db.threads.upsert:action:after', () =>
    void refreshWorkspaceTabMetadata()
);
useHookEffect('db.threads.delete:action:soft:after', () =>
    void refreshWorkspaceTabMetadata()
);
useHookEffect('db.threads.delete:action:hard:after', () =>
    void refreshWorkspaceTabMetadata()
);
useHookEffect('db.documents.update:action:after', () =>
    void refreshWorkspaceTabMetadata()
);

const themePlugin = useNuxtApp().$theme as ThemePlugin | undefined;
const {
    sidebarExpandedComponent,
    sidebarCollapsedComponent,
    dashboardModalComponent,
    systemPromptsModalComponent,
    sidebarToggleButtonProps,
    newPaneButtonProps,
    themeToggleButtonProps,
    notificationButtonProps,
    headerActionButtonProps,
    paneCloseButtonProps,
} = usePageShellTheme(themePlugin);

const {
    paneContainerRef,
    onPaneResizeStart,
    onPaneResizeKeydown,
} = usePaneResizeController({
    paneCount: () => panes.value.length,
    paneWidths,
    isMobile,
    minPaneWidth,
    recalculateWidths: recalculateWidthsForContainer,
    resize: handleResize,
    persist: persistPaneWidths,
});

// Pane navigation with Shift+Arrow keys (using VueUse)
const keys = useMagicKeys();
const shiftLeft = keys['Shift+ArrowLeft'] ?? ref(false);
const shiftRight = keys['Shift+ArrowRight'] ?? ref(false);

// Navigate to previous pane with Shift+Left
whenever(shiftLeft, () => {
    // Only work when multiple panes exist
    if (panes.value.length <= 1) return;

    // Don't interfere if user is editing content
    const activeEl = document.activeElement as HTMLElement;
    if (
        activeEl &&
        (activeEl.isContentEditable ||
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA')
    ) {
        return;
    }

    focusPrev(activePaneIndex.value);
});

// Navigate to next pane with Shift+Right
whenever(shiftRight, () => {
    // Only work when multiple panes exist
    if (panes.value.length <= 1) return;

    // Don't interfere if user is editing content
    const activeEl = document.activeElement as HTMLElement;
    if (
        activeEl &&
        (activeEl.isContentEditable ||
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA')
    ) {
        return;
    }

    focusNext(activePaneIndex.value);
});

// ---------------- Pane Component Resolution ----------------
const { getPaneApp } = usePaneApps();

/**
 * Resolve the component to render for a pane based on its mode.
 * Returns the appropriate component for built-in modes or registered custom apps.
 */
function resolvePaneComponent(pane: PaneState): Component {
    // Built-in: chat
    if (pane.mode === 'chat') {
        if (import.meta.dev) {
            console.debug('[PageShell] resolve component: chat');
        }
        return (
            themePlugin?.activeComponents.value['chat-page'] ??
            CORE_APP_COMPONENT_DEFAULTS['chat-page']
        );
    }

    // Built-in: doc (lazy loaded)
    if (pane.mode === 'doc') {
        if (!documentsEnabled.value) {
            if (import.meta.dev) {
                console.debug('[PageShell] doc mode disabled, using PaneUnknown');
            }
            return PaneUnknown;
        }
        if (import.meta.dev) {
            console.debug('[PageShell] resolve component: doc');
        }
        return (
            themePlugin?.activeComponents.value['document-editor'] ??
            CORE_APP_COMPONENT_DEFAULTS['document-editor']
        );
    }

    // Custom pane app
    const app = getPaneApp(pane.mode);
    if (import.meta.dev && !app?.component) {
        console.warn('[PageShell] Missing component for pane mode', pane.mode);
    }
    if (app?.component) {
        if (import.meta.dev) {
            console.debug(
                '[PageShell] resolve component: custom',
                pane.mode,
                app.component
            );
        }
        return app.component as Component;
    }

    // Fallback for unknown modes
    if (import.meta.dev) {
        console.debug('[PageShell] resolve component: unknown', pane.mode);
    }
    return PaneUnknown;
}

/**
 * Build props object for the pane component.
 * Built-in panes get their specific props, custom panes get a generic contract.
 */
function buildPaneProps(
    pane: PaneState,
    paneIndex: number
): Record<string, any> {
    // Built-in: chat
    if (pane.mode === 'chat') {
        return {
            messageHistory: pane.messages,
            threadId: pane.threadId,
            paneId: pane.id,
            tabId: tabIdForPane(pane.id),
        };
    }

    // Built-in: doc
    if (pane.mode === 'doc') {
        return pane.documentId
            ? {
                  documentId: pane.documentId,
                  paneId: pane.id,
                  tabId: tabIdForPane(pane.id),
              }
            : {};
    }

    // Custom pane app - provide generic contract
    const app = getPaneApp(pane.mode);
    const panePluginApi =
        (
            globalThis as typeof globalThis & {
                __or3PanePluginApi?: PanePluginApi;
            }
        ).__or3PanePluginApi ?? null;
    if (import.meta.dev) {
        console.debug('[PageShell] build props for custom pane', {
            paneId: pane.id,
            mode: pane.mode,
            recordId: pane.documentId ?? null,
            hasPostApi: !!panePluginApi?.posts,
        });
    }
    return {
        paneId: pane.id,
        tabId: tabIdForPane(pane.id),
        recordId: pane.documentId ?? null,
        postType: app?.postType ?? pane.mode,
        postApi: panePluginApi?.posts ?? null,
    };
}

function tabIdForPane(paneId: string): string {
    return workspaceTabs.state.value.paneBindings.get(paneId) ?? paneId;
}

function setPaneComponentRef(paneId: string, instance: unknown): void {
    if (instance) paneComponentRefs.set(paneId, instance);
    else paneComponentRefs.delete(paneId);
}

function onPaneFocused(index: number): void {
    setActive(index);
    if (!workspaceTabsEnabled.value) return;
    const pane = panes.value[index];
    const tabId = pane && workspaceTabs.state.value.paneBindings.get(pane.id);
    if (tabId) void workspaceTabs.activateTab(tabId, 'pointer');
}

function onWorkspaceTabActivate(
    tabId: string,
    reason: 'pointer' | 'keyboard'
): void {
    void workspaceTabs.activateTab(tabId, reason);
}

function onWorkspaceTabClose(tabId: string): void {
    void workspaceTabs.closeTab(tabId).then((closed) => {
        if (!closed) return;
        clearPanePendingPromptAfter(tabId, 6000);
        workspaceTabDrafts.discardAfter(tabId, 6000);
        toast.add({
            id: 'workspace-tab-closed',
            title: 'Tab closed',
            duration: 6000,
            actions: [
                {
                    label: 'Undo',
                    size: 'sm',
                    onClick: () => void workspaceTabs.reopenClosedTab(),
                },
            ],
        });
    });
}

async function closeWorkspaceTabs(tabIds: readonly string[]): Promise<void> {
    let closedCount = 0;
    for (const tabId of tabIds) {
        if (await workspaceTabs.closeTab(tabId)) {
            clearPanePendingPromptAfter(tabId, 6000);
            workspaceTabDrafts.discardAfter(tabId, 6000);
            closedCount++;
        }
    }
    if (closedCount) {
        toast.add({
            id: 'workspace-tabs-closed',
            title: closedCount === 1 ? 'Tab closed' : `${closedCount} tabs closed`,
            duration: 6000,
            actions: [
                {
                    label: 'Undo',
                    size: 'sm',
                    onClick: () => void workspaceTabs.reopenClosedTab(),
                },
            ],
        });
    }
}

function closeOtherWorkspaceTabs(tabId: string): void {
    void closeWorkspaceTabs(
        workspaceTabs.tabs.value
            .filter((tab) => tab.id !== tabId)
            .map((tab) => tab.id)
    );
}

function closeWorkspaceTabsToRight(tabId: string): void {
    const index = workspaceTabs.tabs.value.findIndex((tab) => tab.id === tabId);
    if (index >= 0) {
        void closeWorkspaceTabs(
            workspaceTabs.tabs.value.slice(index + 1).map((tab) => tab.id)
        );
    }
}

function onWorkspaceNewTab(): void {
    void workspaceTabs.newTab();
}

function getPanePluginPostsApi(): PanePluginApi['posts'] | null {
    return (
        (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi
            ?.posts ?? null
    );
}

async function onWorkspaceCreateTab(
    kind: WorkspaceNewTabCreateKind
): Promise<void> {
    if (kind === 'chat') {
        onWorkspaceNewTab();
        return;
    }
    if (kind === 'document') {
        await onNewDocument();
        return;
    }
    if (kind === 'workflow') {
        if (!canCreateWorkflowTab.value) {
            toast.add({
                title: 'Workflows disabled',
                description: 'This deployment has workflow editing turned off.',
                color: 'warning',
            });
            return;
        }
        const posts = getPanePluginPostsApi();
        if (!posts) {
            toast.add({
                title: 'Could not create workflow',
                description: 'The workspace posts API is not ready yet.',
                color: 'warning',
            });
            return;
        }
        const { createWorkflow } = useWorkflowsCrud(posts);
        const result = await createWorkflow('Untitled Workflow');
        if (!result.ok) {
            toast.add({
                title: 'Workflow creation failed',
                description: result.error,
                color: 'error',
            });
            return;
        }
        await workspaceTabs.openResource(
            {
                kind: 'app',
                appId: 'or3-workflows',
                recordId: result.id,
            },
            { allowDuplicate: true }
        );
        return;
    }
    if (kind === 'agent') {
        if (!canCreateAgentTab.value) {
            toast.add({
                title: 'Agent host unavailable',
                description: 'Connect a trusted external agent host first.',
                color: 'warning',
            });
            return;
        }
        await workspaceTabs.openResource(
            {
                kind: 'app',
                appId: EXTERNAL_AGENT_PANE_APP_ID,
                recordId: EXTERNAL_AGENT_LAUNCHER_REF,
            },
            { allowDuplicate: true }
        );
    }
}

function onWorkspaceTabReorder(tabId: string, destinationIndex: number): void {
    workspaceTabs.reorderTab(tabId, destinationIndex);
}

function activateRelativeWorkspaceTab(direction: 1 | -1): void {
    const tabs = workspaceTabs.tabs.value;
    const current = tabs.findIndex(
        (tab) => tab.id === workspaceTabs.activeTabId.value
    );
    if (!tabs.length || current < 0) return;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    if (next) void workspaceTabs.activateTab(next.id, 'command');
}

function openWorkspaceTabInSplit(tabId: string): void {
    const tab = workspaceTabs.state.value.tabs.find((entry) => entry.id === tabId);
    if (tab) void workspaceTabs.openInSplit(tab.resource, { allowDuplicate: true });
}

const workspaceCopyableTabIds = computed(
    () =>
        new Set(
            workspaceTabs.tabs.value.flatMap((tab) =>
                (tab.resource.kind === 'chat' && tab.resource.threadId) ||
                tab.resource.kind === 'document'
                    ? [tab.id]
                    : []
            )
        )
);

async function copyWorkspaceTabLink(tabId: string): Promise<void> {
    const tab = workspaceTabs.tabs.value.find((entry) => entry.id === tabId);
    if (!tab || !import.meta.client) return;
    const path =
        tab.resource.kind === 'chat' && tab.resource.threadId
            ? `/chat/${tab.resource.threadId}`
            : tab.resource.kind === 'document'
              ? `/docs/${tab.resource.documentId}`
              : null;
    if (!path) return;
    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error('Clipboard API is unavailable');
        }
        await navigator.clipboard.writeText(
            new URL(path, window.location.origin).href
        );
        toast.add({ title: 'Link copied', duration: 2500 });
    } catch {
        toast.add({
            title: 'Could not copy link',
            description: 'Your browser did not allow clipboard access.',
            color: 'warning',
        });
    }
}

function onPaneTabStatus(paneId: string, status: WorkspaceTabStatus): void {
    if (!workspaceTabsEnabled.value) return;
    const tabId = workspaceTabs.state.value.paneBindings.get(paneId);
    if (tabId) workspaceTabs.updateRuntime(tabId, { status });
}

function onPaneTabTitle(paneId: string, title: string): void {
    if (!workspaceTabsEnabled.value) return;
    const tabId = workspaceTabs.state.value.paneBindings.get(paneId);
    if (tabId) workspaceTabs.updateCachedTitle(tabId, title);
}

const newSplitTooltip = computed(() => {
    if (!canAddPane.value) return newWindowTooltip.value.replace('window', 'split');
    return 'New split';
});

// Active thread convenience (first pane for sidebar highlight)
const activeChatThreadId = computed(() => {
    const activePane = panes.value[activePaneIndex.value];
    return activePane?.mode === 'chat' ? activePane.threadId || '' : '';
});

// --------------- Initializers ---------------

let validateToken = 0;
const shellMounted = ref(false);
const workspaceTabsReady = ref(false);
let applyingInitialPaneToken: number | null = null;

function resourceForPane(pane: PaneState) {
    if (pane.mode === 'chat') {
        return { kind: 'chat' as const, threadId: pane.threadId || null };
    }
    if (pane.mode === 'doc') {
        return pane.documentId
            ? { kind: 'document' as const, documentId: pane.documentId }
            : null;
    }
    return {
        kind: 'app' as const,
        appId: pane.mode,
        recordId: pane.documentId,
        // A record-less app is still a valid temporary instance in the tab
        // session, keyed to the stable runtime pane until it creates a record.
        instanceKey: pane.documentId ? undefined : pane.id,
    };
}

function reconcileWorkspaceTabsWithPanes(): void {
    if (!workspaceTabsEnabled.value) return;
    for (const pane of panes.value) {
        const resource = resourceForPane(pane);
        if (resource) {
            workspaceTabs.reconcilePaneResource(pane.id, resource, {
                replaceCurrent:
                    resource.kind === 'app' &&
                    getPaneApp(resource.appId)?.replaceRecordInCurrentTab === true,
            });
        }
    }
}

watch(
    () =>
        panes.value.map((pane) =>
            [pane.id, pane.mode, pane.threadId, pane.documentId ?? ''].join(':')
        ),
    () => {
        if (!workspaceTabsReady.value || !workspaceTabsEnabled.value) return;
        const currentPaneIds = new Set(panes.value.map((pane) => pane.id));
        for (const paneId of workspaceTabs.state.value.paneBindings.keys()) {
            if (!currentPaneIds.has(paneId)) workspaceTabs.paneClosedExternally(paneId);
        }
        reconcileWorkspaceTabsWithPanes();
    },
    { flush: 'post' }
);

async function validateThread(id: string): Promise<ValidationStatus> {
    return validateDbRecordWithRetry({
        id,
        getRecord: (db, recordId) => db.threads.get(recordId),
        isValid: () => true,
        isDeleted: (record) => Boolean(record.deleted),
    });
}

async function validateDocument(id: string): Promise<ValidationStatus> {
    return validateDbRecordWithRetry({
        id,
        getRecord: (db, recordId) => db.posts.get(recordId),
        isValid: (record) => (record as any)?.postType === 'doc',
        isDeleted: (record) => Boolean((record as any)?.deleted),
    });
}

async function initInitial(preserveWorkspaceRestore = false) {
    if (!process.client) {
        hasSyncedInitial.value = true;
        return;
    }
    const pane = panes.value[0];
    if (!pane) {
        hasSyncedInitial.value = true;
        return;
    }
    if (props.initialThreadId) {
        if (props.validateInitial) {
            pane.validating = true;
            const token = ++validateToken;
            try {
                const result = await validateThread(props.initialThreadId);
                if (token !== validateToken) {
                    return; // Newer validation in flight
                }
                if (result === 'deleted') {
                    redirectNotFound('chat');
                    return;
                }
            } finally {
                if (token === validateToken) {
                    pane.validating = false;
                }
            }
        }
        if (workspaceTabsEnabled.value) {
            await workspaceTabs.openResource({
                kind: 'chat',
                threadId: props.initialThreadId,
            });
        } else {
            try {
                await setPaneThread(0, props.initialThreadId);
            } finally {
                pane.validating = false;
            }
            pane.mode = 'chat';
        }
        hasSyncedInitial.value = true;
        updateUrl(true);
        return;
    }
    if (props.initialDocumentId) {
        if (!documentsEnabled.value) {
            await navigateTo('/chat', { replace: true });
            hasSyncedInitial.value = true;
            return;
        }
        if (props.validateInitial) {
            pane.validating = true;
            const token = ++validateToken;
            try {
                const result = await validateDocument(props.initialDocumentId);
                if (token !== validateToken) {
                    return; // Newer validation in flight
                }
                if (result === 'deleted') {
                    redirectNotFound('doc');
                    return;
                }
            } finally {
                if (token === validateToken) {
                    pane.validating = false;
                }
            }
        }
        if (workspaceTabsEnabled.value) {
            await workspaceTabs.openResource({
                kind: 'document',
                documentId: props.initialDocumentId,
            });
        } else {
            pane.mode = 'doc';
            pane.documentId = props.initialDocumentId;
            pane.threadId = '';
            pane.validating = false;
        }
        hasSyncedInitial.value = true;
        updateUrl(true);
        return;
    }
    if (workspaceTabsEnabled.value && preserveWorkspaceRestore) {
        hasSyncedInitial.value = true;
        updateUrl(true);
        return;
    }
    // No ids: set default mode
    if (props.defaultMode === 'doc' && documentsEnabled.value) {
        pane.mode = 'doc';
        pane.documentId = undefined;
        pane.threadId = '';
    } else {
        pane.mode = 'chat';
    }
    hasSyncedInitial.value = true;
    updateUrl(true);
}

async function configureProfilePane(
    index: number,
    pane: WorkspaceProfileInitialPane
): Promise<void> {
    if (pane.id === 'chat') {
        updatePane(index, {
            mode: 'chat',
            documentId: undefined,
            threadId: '',
            messages: [],
            validating: false,
        });
        if (pane.recordId) await setPaneThread(index, pane.recordId);
        return;
    }
    if (pane.id === 'doc') {
        updatePane(index, {
            mode: 'doc',
            documentId: pane.recordId,
            threadId: '',
            messages: [],
            validating: false,
        });
        return;
    }
    await setPaneApp(index, pane.id, { recordId: pane.recordId });
}

function resourceForProfilePane(
    pane: WorkspaceProfileInitialPane,
    index: number
): WorkspaceResource | null {
    if (pane.id === 'chat') {
        return { kind: 'chat', threadId: pane.recordId ?? null };
    }
    if (pane.id === 'doc') {
        return pane.recordId
            ? { kind: 'document', documentId: pane.recordId }
            : null;
    }
    return {
        kind: 'app',
        appId: pane.id,
        recordId: pane.recordId,
        instanceKey: pane.recordId ? undefined : `profile-${index}-${pane.id}`,
    };
}

async function applyInitialPaneRequest(): Promise<void> {
    const request = initialPaneRequest.value;
    if (
        !shellMounted.value ||
        !request ||
        applyingInitialPaneToken === request.token
    ) {
        return;
    }
    applyingInitialPaneToken = request.token;
    try {
        if (props.initialThreadId || props.initialDocumentId) {
            await acknowledgeInitialPanes(request.token);
            return;
        }
        ensureAtLeastOne();
        const first = panes.value[0];
        const firstIsBlank =
            first?.mode === 'chat' &&
            !first.threadId &&
            !first.documentId &&
            first.messages.length === 0;
        if (!request.replaceExisting && !firstIsBlank) {
            await acknowledgeInitialPanes(request.token);
            return;
        }
        if (request.replaceExisting) {
            while (panes.value.length > 1) {
                await closePane(panes.value.length - 1);
            }
        }

        const requestedPanes = request.panes.slice(
            0,
            resolvedProfile.value.workspace.desktopPaneLimit
        );
        if (workspaceTabsEnabled.value && isMobile.value) {
            const first = requestedPanes[0];
            if (first) {
                await configureProfilePane(0, first);
                reconcileWorkspaceTabsWithPanes();
            }
            for (const [index, pane] of requestedPanes.slice(1).entries()) {
                const resource = resourceForProfilePane(pane, index + 1);
                if (!resource) continue;
                const tabId = await workspaceTabs.openResource(resource, {
                    target: 'background',
                });
                if (tabId) workspaceTabs.reorderTab(tabId, index + 1);
            }
            setActive(0);
            await acknowledgeInitialPanes(request.token);
            return;
        }
        if (requestedPanes[0]) {
            await configureProfilePane(0, requestedPanes[0]);
        }
        for (const pane of requestedPanes.slice(1)) {
            if (!canAddPane.value) break;
            if (pane.id === 'chat' || pane.id === 'doc') {
                addPane();
                await configureProfilePane(panes.value.length - 1, pane);
            } else {
                await newPaneForApp(pane.id, {
                    initialRecordId: pane.recordId,
                });
            }
        }
        setActive(0);
        await acknowledgeInitialPanes(request.token);
    } catch (error) {
        console.error('[workspace-profiles] Initial pane application failed', error);
        toast.add({
            title: 'Layout setup incomplete',
            description:
                'Your profile is active, but its initial panes could not be opened.',
            color: 'warning',
        });
    } finally {
        applyingInitialPaneToken = null;
    }
}

watch(
    () => initialPaneRequest.value?.token,
    () => {
        void applyInitialPaneRequest();
    }
);

function redirectNotFound(kind: 'chat' | 'doc') {
    hasSyncedInitial.value = true;
    if (kind === 'chat') router.replace('/chat');
    else router.replace('/docs');
    toast.add({
        title: 'Not found',
        description:
            kind === 'chat'
                ? 'This chat does not exist.'
                : 'This document does not exist.',
        color: 'error',
    });
}

// --------------- URL Sync ---------------
function updateUrl(force = false) {
    if (!process.client || !props.routeSync) return;
    if (!force && !hasSyncedInitial.value) return;
    // Prevent route sync from clobbering the OAuth callback path while the
    // OpenRouter token exchange page is mounting. The callback component
    // itself will redirect after finishing, so we should not rewrite here.
    const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '';
    if (currentPath.startsWith('/openrouter-callback')) return;
    const pane = panes.value[activePaneIndex.value];
    if (!pane) return;

    // Skip route sync for custom pane apps (only sync chat/doc modes)
    if (pane.mode !== 'chat' && pane.mode !== 'doc') return;

    const base = pane.mode === 'doc' ? '/docs' : '/chat';
    const id = pane.mode === 'doc' ? pane.documentId : pane.threadId;
    const newPath = id ? `${base}/${id}` : base;
    if (window.location.pathname === newPath) return;
    window.history.replaceState(window.history.state, '', newPath);
}

watch(
    () => {
        const active = panes.value[activePaneIndex.value];
        if (!active) return '';
        return `${active.mode}:${active.threadId || ''}:${
            active.documentId || ''
        }`;
    },
    () => updateUrl()
);

watch(
    () => activePaneIndex.value,
    () => updateUrl()
);

// --------------- Documents Integration ---------------
const hooks = useHooks();
const { newDocumentInActive, selectDocumentInActive } = usePaneDocuments({
    panes,
    activePaneIndex,
    createNewDoc,
    flushDocument: async (id) => {
        await captureDocumentEditor(id);
        await flushDocument(id); // central flush now emits saved
    },
});

async function onNewDocument(initial?: { title?: string }) {
    if (!documentsEnabled.value) {
        toast.add({
            title: 'Documents disabled',
            description: 'This deployment has documents turned off.',
            color: 'warning',
        });
        return;
    }
    if (workspaceTabsEnabled.value) {
        try {
            const doc = await createNewDoc(initial);
            await workspaceTabs.openResource({
                kind: 'document',
                documentId: doc.id,
            });
        } catch (error) {
            console.error('[workspace-tabs] Failed to create document', error);
            toast.add({
                title: 'Document creation failed',
                description: 'No tab was opened. Please try again.',
                color: 'error',
            });
        }
    } else {
        const doc = await newDocumentInActive(initial);
        if (doc) updateUrl();
    }
    closeSidebarIfMobile();
}
async function onDocumentSelected(id: string) {
    if (!documentsEnabled.value) return;
    if (workspaceTabsEnabled.value) {
        await workspaceTabs.openResource({ kind: 'document', documentId: id });
    } else {
        await selectDocumentInActive(id);
        updateUrl();
    }
    closeSidebarIfMobile();
}

// Sidebar chat selection always puts pane in chat mode
function onSidebarSelected(id: string) {
    if (!id) return;
    if (workspaceTabsEnabled.value) {
        void workspaceTabs.openResource({ kind: 'chat', threadId: id });
        closeSidebarIfMobile();
        return;
    }
    const target = activePaneIndex.value;
    setPaneThread(target, id);
    const pane = panes.value[target];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
    }
    if (target === activePaneIndex.value) updateUrl();
    closeSidebarIfMobile();
}
function onInternalThreadCreated(id: string, paneIndex?: number) {
    if (!id) return;
    const idx =
        typeof paneIndex === 'number' ? paneIndex : activePaneIndex.value;
    const pane = panes.value[idx];
    if (!pane) return;
    if (workspaceTabsEnabled.value) {
        const tabId = workspaceTabs.state.value.paneBindings.get(pane.id);
        if (tabId) workspaceTabs.promoteBlankChat(tabId, id);
        else workspaceTabs.reconcilePaneResource(pane.id, {
            kind: 'chat',
            threadId: id,
        });
    }
    pane.mode = 'chat';
    pane.documentId = undefined;
    if (pane.threadId !== id) setPaneThread(idx, id);
    if (idx === activePaneIndex.value) updateUrl();
    closeSidebarIfMobile();
}
function onNewChat() {
    if (workspaceTabsEnabled.value) {
        void workspaceTabs.newTab();
        closeSidebarIfMobile();
        return;
    }
    const pane = panes.value[activePaneIndex.value];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
        pane.messages = [];
        pane.threadId = '';
    }
    updateUrl();
    closeSidebarIfMobile();
}

// --------------- Theme ---------------
const nuxtApp = useNuxtApp();
const getThemeSafe = () => {
    try {
        const api = nuxtApp.$theme as any;
        if (api && typeof api.get === 'function') return api.get();
        if (process.client) {
            return document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light';
        }
    } catch {}
    return 'light';
};
// To avoid SSR/client hydration mismatch, initialize with null placeholder then set onMounted
const themeName = ref<string>('light'); // default placeholder
if (process.client) {
    // set actual theme asap after mount to prevent SSR mismatch flicker
    onMounted(() => {
        syncTheme();
    });
}
function syncTheme() {
    themeName.value = getThemeSafe();
}
function toggleTheme() {
    (nuxtApp.$theme as any)?.toggle?.();
    // defer sync to next frame to let DOM class update first
    requestAnimationFrame(() => syncTheme());
}
if (process.client) {
    const root = document.documentElement;
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => observer.disconnect());
    } else {
        onUnmounted(() => observer.disconnect());
    }
}
const themeAriaLabel = computed(() =>
    themeName.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
);
const themeLightIcon = useIcon('shell.theme.light');
const themeDarkIcon = useIcon('shell.theme.dark');
const themeToggleIcon = computed(() =>
    themeName.value === 'dark' ? themeLightIcon.value : themeDarkIcon.value
);

// --------------- Command palette ---------------
// PageShell is the single host: it owns the navigation context the palette
// actions dispatch through, and registers the core sources once per session.
const dashboardNavigation = useDashboardNavigation();
const {
    open: openCommandPalette,
    close: closeCommandPalette,
    getCoordinator: getPaletteCoordinator,
} = useCommandPalette();
const {
    isOpen: systemPromptsModalOpen,
    request: systemPromptsModalRequest,
    open: openSystemPromptsModal,
    notifySelected: notifySystemPromptSelected,
} = useSystemPromptsModal();
let disposePaletteHostContext: (() => void) | null = null;
let disposeWorkspaceTabPaletteProvider: (() => void) | null = null;

watch(
    () =>
        workspaceTabs.tabs.value.map(
            (tab) => `${tab.id}:${tab.cachedTitle}:${tab.lastActivatedAt}`
        ),
    () => {
        void getPaletteCoordinator()?.refreshSources(['workspace-tab']);
    }
);

async function openSystemPromptsFromPalette(options: {
    mode: SystemPromptsModalMode;
    promptId?: string;
}) {
    const activePane = panes.value[activePaneIndex.value];
    closeCommandPalette();
    await nextTick();
    openSystemPromptsModal({
        ...options,
        threadId:
            activePane?.mode === 'chat'
                ? activePane.threadId || undefined
                : undefined,
        paneId: activePane?.mode === 'chat' ? activePane.id : undefined,
    });
}

function setDashboardOpen(open: boolean) {
    if (!dashboardEnabled.value) return;
    showDashboardModal.value = open;
}

async function openDashboardPage(pluginId: string, pageId: string) {
    setDashboardOpen(true);
    await nextTick();
    await dashboardNavigation.openPage(pluginId, pageId);
}

async function openImageLibraryPage() {
    await openDashboardPage('core:images', 'images-library');
}

async function openNewProjectModal() {
    await ensureSidebarExpanded();
    await nextTick();
    sideNavExpandedRef.value?.openCreateProject?.();
}

onMounted(() => {
    disposeWorkspaceTabPaletteProvider?.();
    disposeWorkspaceTabPaletteProvider = setWorkspaceTabPaletteProvider(
        () => workspaceTabs.tabs.value
    );
    disposePaletteHostContext?.();
    disposePaletteHostContext = setPaletteHostContext(
        createPaletteHostContext({
            expandSidebar,
            activateDefaultSidebarPage: () =>
                sideNavExpandedRef.value?.activateDefaultPage?.(),
            openImageLibraryPage,
            setDashboardOpen,
            canOpenNewPane: () => canAddPane.value,
            ...(workspaceTabsEnabled.value
                ? {
                      openWorkspaceResource: (resource: WorkspaceResource, options: { target: 'active' | 'split' }) =>
                          workspaceTabs.openResource(resource, options),
                      activateWorkspaceTab: (tabId: string) =>
                          workspaceTabs.activateTab(tabId, 'command'),
                  }
                : {}),
            getDashboardNavigation: () => dashboardNavigation,
            openSystemPrompts: openSystemPromptsFromPalette,
        })
    );

    registerCorePaletteSources({
        commandDeps: {
            isFeatureEnabled: (feature) => {
                if (feature === 'documents') return documentsEnabled.value;
                if (feature === 'dashboard') return dashboardEnabled.value;
                if (feature === 'workspaceTabs') return workspaceTabsEnabled.value;
                return true;
            },
            toggleTheme,
            openDashboard: () => setDashboardOpen(true),
            openImageLibrary: openImageLibraryPage,
            openThemeSettings: () =>
                openDashboardPage('core:settings', 'theme-settings'),
            openAiSettings: () =>
                openDashboardPage('core:settings', 'ai-settings'),
            newChat: onNewChat,
            newDocument: () => onNewDocument(),
            newProject: openNewProjectModal,
            newTab: onWorkspaceNewTab,
            closeTab: () => onWorkspaceTabClose(workspaceTabs.activeTabId.value),
            reopenClosedTab: () => void workspaceTabs.reopenClosedTab(),
            nextTab: () => activateRelativeWorkspaceTab(1),
            previousTab: () => activateRelativeWorkspaceTab(-1),
            newSplit: () => void workspaceTabs.newSplit(),
            closeSplit: () => void workspaceTabs.closeSplit(),
            openSystemPrompts: () =>
                openSystemPromptsFromPalette({ mode: 'home' }),
            newSystemPrompt: () =>
                openSystemPromptsFromPalette({ mode: 'new' }),
        },
    });
});

onUnmounted(() => {
    closeCommandPalette();
    disposeWorkspaceScopeSubscription();
    disposePaletteHostContext?.();
    disposePaletteHostContext = null;
    disposeWorkspaceTabPaletteProvider?.();
    disposeWorkspaceTabPaletteProvider = null;
});

const getHeaderActionContext = () => ({
    route,
    isMobile: isMobile.value,
    activeTab: workspaceTabs.state.value.tabs.find(
        (tab) => tab.id === workspaceTabs.activeTabId.value
    ),
    activePane: panes.value[activePaneIndex.value] ?? null,
    tabCount: workspaceTabs.tabs.value.length,
    paneCount: panes.value.length,
    visibleTabIds: workspaceTabs.visibleTabIds.value,
});
const headerActions = useHeaderActions(getHeaderActionContext);
const headerActionMenuItems = computed(() =>
    headerActions.value.map((entry) => ({
        label: entry.action.label || entry.action.tooltip || entry.action.id,
        icon: entry.action.icon,
        disabled: entry.disabled,
        onSelect: () => void handleHeaderAction(entry),
    }))
);
const workspaceChromeRef = ref<{ openTabSwitcher?: () => void } | null>(null);
const tabsOverflowIcon = useIcon('shell.tabs');
const tabsOverflowLabel = computed(() => {
    const count = workspaceTabs.tabs.value.length;
    return count === 1 ? '1 open tab' : `${count} open tabs`;
});

/** Mobile moves theme + tabs into overflow so the chrome row stays usable. */
const chromeOverflowMenuItems = computed(() => {
    const items = [...headerActionMenuItems.value];
    if (isMobile.value) {
        const mobileItems: typeof items = [];
        if (workspaceTabsChromeVisible.value) {
            mobileItems.push({
                label: tabsOverflowLabel.value,
                icon: tabsOverflowIcon.value,
                disabled: false,
                onSelect: () => void workspaceChromeRef.value?.openTabSwitcher?.(),
            });
        }
        mobileItems.push({
            label: themeAriaLabel.value,
            icon: themeToggleIcon.value,
            disabled: false,
            onSelect: () => void toggleTheme(),
        });
        items.unshift(...mobileItems);
    }
    return items;
});

async function handleHeaderAction(entry: HeaderActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(getHeaderActionContext());
    } catch (error) {
        console.error(
            `[PageShell] header action "${entry.action.id}" failed`,
            error
        );
    }
}
const showTopOffset = computed(
    () =>
        workspaceTabsEnabled.value ||
        panes.value.length > 1 ||
        isMobile.value
);
const paneChromeClearanceStyle = computed(() => {
    const hasOverlayChrome =
        !workspaceTabsChromeVisible.value && !showTopOffset.value;
    return {
        '--or3-workspace-chrome-height': workspaceTabsChromeVisible.value
            ? isMobile.value
                ? 'calc(var(--or3-workspace-chrome-mobile-size, 52px) + env(safe-area-inset-top))'
                : 'var(--or3-workspace-chrome-size, 48px)'
            : '46px',
        '--or3-pane-chrome-top-clearance': hasOverlayChrome ? '46px' : '0px',
        '--or3-pane-chrome-left-clearance': hasOverlayChrome ? '56px' : '0px',
        '--or3-pane-chrome-right-clearance': hasOverlayChrome
            ? '112px'
            : '0px',
    };
});

function toggleDashboard() {
    if (!dashboardEnabled.value) return;
    showDashboardModal.value = !showDashboardModal.value;
}
function openMobileSidebar() {
    (layoutRef.value as any)?.openSidebar?.();
}

async function ensureSidebarExpanded() {
    const layout: any = layoutRef.value;
    if (!layout) return;
    layout?.expand?.();
    const collapsedRef = layout?.isCollapsed;
    if (!collapsedRef || typeof collapsedRef.value === 'undefined') return;
    if (!collapsedRef.value) return;
    await new Promise<void>((resolve) => {
        const stop = watch(
            () => collapsedRef.value,
            (val) => {
                if (!val) {
                    stop();
                    resolve();
                }
            }
        );
    });
}

function expandSidebar() {
    const layout: any = layoutRef.value;
    if (!layout) return;
    layout?.expand?.();
}

function openCollapsedCreateDocumentModal() {
    sideNavExpandedRef.value?.openCreateDocumentModal?.();
}

function openCollapsedCreateProjectModal() {
    sideNavExpandedRef.value?.openCreateProject?.();
}

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        if (ms <= 0) resolve();
        else setTimeout(resolve, ms);
    });
}

function closeSidebarIfMobile() {
    if (isMobile.value) (layoutRef.value as any)?.close?.();
}

// --------------- Deletion auto-reset ---------------
function resetPaneToBlank(paneIndex: number) {
    const pane = panes.value[paneIndex];
    if (!pane) return;
    pane.mode = 'chat';
    pane.documentId = undefined;
    pane.threadId = '';
    pane.messages = [];
    if (paneIndex === activePaneIndex.value) updateUrl();
}
function handleThreadDeletion(payload: DbDeletePayload<ThreadEntity>) {
    const deletedId = payload?.id ?? payload?.entity?.id;
    if (!deletedId) return;
    if (workspaceTabsEnabled.value) {
        for (const tab of workspaceTabs.state.value.tabs) {
            if (tab.resource.kind === 'chat' && tab.resource.threadId === deletedId) {
                void workspaceTabs.closeTab(tab.id);
            }
        }
        return;
    }
    panes.value.forEach((p, i) => {
        if (p.mode === 'chat' && p.threadId === deletedId) resetPaneToBlank(i);
    });
}
function handleDocumentDeletion(payload: DbDeletePayload<DocumentEntity>) {
    const deletedId = payload?.id ?? payload?.entity?.id;
    if (!deletedId) return;
    if (workspaceTabsEnabled.value) {
        for (const tab of workspaceTabs.state.value.tabs) {
            if (
                tab.resource.kind === 'document' &&
                tab.resource.documentId === deletedId
            ) {
                void workspaceTabs.closeTab(tab.id);
            }
        }
        return;
    }
    panes.value.forEach((p, i) => {
        if (p.mode === 'doc' && p.documentId === deletedId) resetPaneToBlank(i);
    });
}
useHookEffect('db.threads.delete:action:soft:after', handleThreadDeletion, {
    kind: 'action',
    priority: 10,
});
useHookEffect('db.threads.delete:action:hard:after', handleThreadDeletion, {
    kind: 'action',
    priority: 10,
});
useHookEffect('db.documents.delete:action:soft:after', handleDocumentDeletion, {
    kind: 'action',
    priority: 10,
});
useHookEffect('db.documents.delete:action:hard:after', handleDocumentDeletion, {
    kind: 'action',
    priority: 10,
});

// --------------- Mount ---------------
onMounted(async () => {
    let restoredWorkspaceTabs = false;
    if (workspaceTabsEnabled.value) {
        restoredWorkspaceTabs = await workspaceTabs.restore();
    }
    await initInitial(restoredWorkspaceTabs);
    syncTheme();
    ensureAtLeastOne();
    shellMounted.value = true;
    await applyInitialPaneRequest();
    if (workspaceTabsEnabled.value) {
        if (!props.initialThreadId && !props.initialDocumentId && !restoredWorkspaceTabs) {
            reconcileWorkspaceTabsWithPanes();
        }
        activeWorkspaceTabsScope = `${workspaceScopeId.value ?? 'local'}\0${resolvedProfile.value.id}`;
        workspaceTabsReady.value = true;
    }
    workspaceTabsHydrated.value = true;

    // Expose sidebar layout API globally for plugins
    const sidebarLayoutApi: SidebarLayoutApi = {
        close: () => (layoutRef.value as any)?.close?.(),
        open: () => (layoutRef.value as any)?.openSidebar?.(),
        toggleCollapse: () => (layoutRef.value as any)?.toggle?.(),
        expand: () => (layoutRef.value as any)?.expand?.(),
        isMobile: () => isMobile.value,
        closeSidebarIfMobile: () => {
            if (isMobile.value) (layoutRef.value as any)?.close?.();
        },
    };
    setGlobalSidebarLayoutApi(sidebarLayoutApi);
});

onUnmounted(() => {
    // Clean up global API on unmount
    setGlobalSidebarLayoutApi(undefined);
});

// --------------- Shortcuts ---------------
// Ctrl/Cmd+Shift+D shortcut for new document
function handleDocumentShortcut(e: KeyboardEvent) {
    if (!e.shiftKey) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 'd') {
        const target = e.target as HTMLElement | null;
        if (target) {
            const tag = target.tagName;
            if (
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                target.isContentEditable
            )
                return;
        }
        e.preventDefault();
        onNewDocument();
    }
}

// Use VueUse's useEventListener for automatic cleanup and HMR safety
useEventListener(window, 'keydown', handleDocumentShortcut);
</script>
<style scoped src="./PageShell.css"></style>
