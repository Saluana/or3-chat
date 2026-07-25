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
            class="flex-1 h-dvh w-full relative"
            :class="legacyCompatClasses.height"
            :style="paneChromeClearanceStyle"
        >
            <div
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
                            :icon="useIcon('shell.sidebar.toggle.right').value"
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
                    <UTooltip :delay-duration="0" text="Toggle theme">
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
                    showTopOffset ? 'pt-[46px]' : 'pt-0',
                    ' h-full flex flex-row gap-0 items-stretch w-full pane-container',
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
                    @focus="setActive(i)"
                    @click="setActive(i)"
                >
                    <div
                        v-if="panes.length > 1 && !isMobile"
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
                        :is="resolvePaneComponent(pane)"
                        v-bind="buildPaneProps(pane, i)"
                        class="flex-1 min-h-0"
                        @thread-selected="
                            pane.mode === 'chat'
                                ? (id: string) => onInternalThreadCreated(id, i)
                                : undefined
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
import { usePaneApps } from '~/composables/core/usePaneApps';
import { getDb } from '~/db/client';
import { useHookEffect } from '~/composables/core/useHookEffect';
import {
    flush as flushDocument,
    newDocument as createNewDoc,
} from '~/composables/documents/useDocumentsStore';
import { captureDocumentEditor } from '~/composables/documents/useDocumentEditorSessions';
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
import {
    useSystemPromptsModal,
    type SystemPromptsModalMode,
} from '~/composables/chat/useSystemPromptsModal';

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
const minPaneWidth = 280;
const { isMobile } = useResponsiveState();

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
    getPaneWidth,
    handleResize,
    persistPaneWidths,
    recalculateWidthsForContainer,
    paneWidths,
} = useMultiPane({
    initialThreadId: props.initialThreadId,
    maxPanes: 3,
    onFlushDocument: async (id) => {
        await captureDocumentEditor(id);
        await flushDocument(id);
    },
    minPaneWidth: 280,
    maxPaneWidth: 2000,
    allowMultiplePanes: computed(() => !isMobile.value),
});

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
        };
    }

    // Built-in: doc
    if (pane.mode === 'doc') {
        return pane.documentId ? { documentId: pane.documentId } : {};
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
        recordId: pane.documentId ?? null,
        postType: app?.postType ?? pane.mode,
        postApi: panePluginApi?.posts ?? null,
    };
}

// Active thread convenience (first pane for sidebar highlight)
const activeChatThreadId = computed(() => {
    const activePane = panes.value[activePaneIndex.value];
    return activePane?.mode === 'chat' ? activePane.threadId || '' : '';
});

// --------------- Initializers ---------------

let validateToken = 0;

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

async function initInitial() {
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
        try {
            await setPaneThread(0, props.initialThreadId);
        } finally {
            pane.validating = false;
        }
        pane.mode = 'chat';
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
        pane.mode = 'doc';
        pane.documentId = props.initialDocumentId;
        pane.threadId = '';
        pane.validating = false;
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
    const doc = await newDocumentInActive(initial);
    if (doc) updateUrl();
    closeSidebarIfMobile();
}
async function onDocumentSelected(id: string) {
    if (!documentsEnabled.value) return;
    await selectDocumentInActive(id);
    updateUrl();
    closeSidebarIfMobile();
}

// Sidebar chat selection always puts pane in chat mode
function onSidebarSelected(id: string) {
    if (!id) return;
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
    pane.mode = 'chat';
    pane.documentId = undefined;
    if (pane.threadId !== id) setPaneThread(idx, id);
    if (idx === activePaneIndex.value) updateUrl();
    closeSidebarIfMobile();
}
function onNewChat() {
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

// --------------- Command palette ---------------
// PageShell is the single host: it owns the navigation context the palette
// actions dispatch through, and registers the core sources once per session.
const dashboardNavigation = useDashboardNavigation();
const {
    open: openCommandPalette,
    close: closeCommandPalette,
} = useCommandPalette();
const {
    isOpen: systemPromptsModalOpen,
    request: systemPromptsModalRequest,
    open: openSystemPromptsModal,
    notifySelected: notifySystemPromptSelected,
} = useSystemPromptsModal();
let disposePaletteHostContext: (() => void) | null = null;

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
    disposePaletteHostContext?.();
    disposePaletteHostContext = setPaletteHostContext(
        createPaletteHostContext({
            expandSidebar,
            activateDefaultSidebarPage: () =>
                sideNavExpandedRef.value?.activateDefaultPage?.(),
            openImageLibraryPage,
            setDashboardOpen,
            canOpenNewPane: () => canAddPane.value,
            getDashboardNavigation: () => dashboardNavigation,
            openSystemPrompts: openSystemPromptsFromPalette,
        })
    );

    registerCorePaletteSources({
        commandDeps: {
            isFeatureEnabled: (feature) => {
                if (feature === 'documents') return documentsEnabled.value;
                if (feature === 'dashboard') return dashboardEnabled.value;
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
            openSystemPrompts: () =>
                openSystemPromptsFromPalette({ mode: 'home' }),
            newSystemPrompt: () =>
                openSystemPromptsFromPalette({ mode: 'new' }),
        },
    });
});

onUnmounted(() => {
    closeCommandPalette();
    disposePaletteHostContext?.();
    disposePaletteHostContext = null;
});

const headerActions = useHeaderActions(() => ({
    route,
    isMobile: isMobile.value,
}));

async function handleHeaderAction(entry: HeaderActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler({
            route,
            isMobile: isMobile.value,
        });
    } catch (error) {
        console.error(
            `[PageShell] header action "${entry.action.id}" failed`,
            error
        );
    }
}
const showTopOffset = computed(() => panes.value.length > 1 || isMobile.value);
const paneChromeClearanceStyle = computed(() => {
    const hasOverlayChrome = !showTopOffset.value;
    return {
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
    panes.value.forEach((p, i) => {
        if (p.mode === 'chat' && p.threadId === deletedId) resetPaneToBlank(i);
    });
}
function handleDocumentDeletion(payload: DbDeletePayload<DocumentEntity>) {
    const deletedId = payload?.id ?? payload?.entity?.id;
    if (!deletedId) return;
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
onMounted(() => {
    initInitial();
    syncTheme();
    ensureAtLeastOne();

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
