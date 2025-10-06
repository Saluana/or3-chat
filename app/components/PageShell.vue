<template>
    <resizable-sidebar-layout ref="layoutRef">
        <template #sidebar-expanded>
            <lazy-sidebar-side-nav-content
                ref="sideNavExpandedRef"
                :active-thread="activeChatThreadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @newDocument="onNewDocument"
                @documentSelected="onDocumentSelected"
                @toggle-dashboard="showDashboardModal = !showDashboardModal"
            />
        </template>
        <template #sidebar-collapsed>
            <lazy-sidebar-side-nav-content-collapsed
                :active-thread="activeChatThreadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @focusSearch="focusSidebarSearch"
                @toggle-dashboard="showDashboardModal = !showDashboardModal"
            />
        </template>
        <div class="flex-1 h-[100dvh] w-full relative">
            <div
                id="top-nav"
                :class="{
                    'border-[var(--md-inverse-surface)] border-b-2 bg-[var(--md-surface-variant)]/20 backdrop-blur-sm':
                        panes.length > 1 || isMobile,
                }"
                class="absolute z-50 top-0 w-full h-[46px] inset-0 flex items-center justify-between pr-2 gap-2 pointer-events-none"
            >
                <div
                    v-if="isMobile"
                    class="h-full flex items-center justify-center px-4 pointer-events-auto"
                >
                    <UTooltip :delay-duration="0" text="Open sidebar">
                        <UButton
                            label="Open"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            aria-label="Open sidebar"
                            title="Open sidebar"
                            :class="'retro-btn'"
                            :ui="{ base: 'retro-btn' }"
                            @click="openMobileSidebar"
                        >
                            <UIcon
                                name="pixelarticons:arrow-bar-right"
                                class="w-5 h-5"
                            />
                        </UButton>
                    </UTooltip>
                </div>
                <div
                    class="h-full items-center justify-center px-4 hidden md:flex"
                >
                    <UTooltip :delay-duration="0" :text="newWindowTooltip">
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            :disabled="!canAddPane"
                            :class="
                                'retro-btn pointer-events-auto mr-2 ' +
                                (!canAddPane
                                    ? 'opacity-50 cursor-not-allowed'
                                    : '')
                            "
                            :ui="{ base: 'retro-btn' }"
                            aria-label="New window"
                            title="New window"
                            @click="addPane"
                        >
                            <UIcon
                                name="pixelarticons:card-plus"
                                class="w-5 h-5"
                            />
                        </UButton>
                    </UTooltip>
                </div>
                <div class="h-full flex items-center justify-center px-4">
                    <UTooltip :delay-duration="0" text="Toggle theme">
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :square="true"
                            :class="'retro-btn pointer-events-auto '"
                            :ui="{ base: 'retro-btn' }"
                            :aria-label="themeAriaLabel"
                            :title="themeAriaLabel"
                            @click="toggleTheme"
                        >
                            <UIcon :name="themeIcon" class="w-5 h-5" />
                        </UButton>
                    </UTooltip>
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
                                size="xs"
                                variant="ghost"
                                :color="(entry.action.color || 'neutral') as any"
                                :square="!entry.action.label"
                                :disabled="entry.disabled"
                                :class="[
                                    'retro-btn pointer-events-auto flex items-center gap-1',
                                    entry.action.label ? 'px-3' : '',
                                ]"
                                :ui="{ base: 'retro-btn' }"
                                :aria-label="
                                    entry.action.tooltip ||
                                    entry.action.label ||
                                    entry.action.id
                                "
                                @click="() => handleHeaderAction(entry)"
                            >
                                <UIcon
                                    :name="entry.action.icon"
                                    class="w-4 h-4"
                                />
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
                :class="[
                    showTopOffset ? 'pt-[46px]' : 'pt-0',
                    ' h-full flex flex-row gap-0 items-stretch w-full overflow-hidden',
                ]"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    class="flex-1 min-w-0 relative flex flex-col border-l-2 first:border-l-0 outline-none focus-visible:ring-0"
                    :class="[
                        i === activePaneIndex && panes.length > 1
                            ? 'pane-active border-[var(--md-primary)] bg-[var(--md-surface-variant)]/10'
                            : 'border-[var(--md-inverse-surface)]',
                        'transition-colors',
                    ]"
                    tabindex="0"
                    @focus="setActive(i)"
                    @click="setActive(i)"
                >
                    <div
                        v-if="panes.length > 1"
                        class="absolute top-1 right-1 z-10"
                    >
                        <UTooltip :delay-duration="0" text="Close window">
                            <UButton
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                :square="true"
                                :class="'retro-btn'"
                                :ui="{
                                    base: 'retro-btn bg-[var(--md-surface-variant)]/60 backdrop-blur-sm',
                                }"
                                aria-label="Close window"
                                title="Close window"
                                @click.stop="closePane(i)"
                            >
                                <UIcon
                                    name="pixelarticons:close"
                                    class="w-4 h-4"
                                />
                            </UButton>
                        </UTooltip>
                    </div>

                    <template v-if="pane.mode === 'chat'">
                        <ChatContainer
                            class="flex-1 min-h-0"
                            :message-history="pane.messages"
                            :thread-id="pane.threadId"
                            :pane-id="pane.id"
                            @thread-selected="
                                (id: string) => onInternalThreadCreated(id, i)
                            "
                        />
                    </template>
                    <template v-else-if="pane.mode === 'doc'">
                        <LazyDocumentsDocumentEditor
                            v-if="pane.documentId"
                            :document-id="pane.documentId"
                            class="flex-1 min-h-0"
                        ></LazyDocumentsDocumentEditor>
                        <div
                            v-else
                            class="flex-1 flex items-center justify-center text-sm opacity-70"
                        >
                            No document.
                        </div>
                    </template>
                </div>
            </div>
        </div>
        <lazy-modal-dashboard v-model:showModal="showDashboardModal" />
    </resizable-sidebar-layout>
</template>
<script setup lang="ts">
// Generic PageShell merging chat + docs functionality.
// Props allow initializing with a thread OR a document and choosing default mode.
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { useMultiPane } from '~/composables/useMultiPane';
import { db } from '~/db';
import { useHookEffect } from '~/composables/useHookEffect';
import {
    flush as flushDocument,
    newDocument as createNewDoc,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import { usePaneDocuments } from '~/composables/documents/usePaneDocuments';
import { useHeaderActions, type HeaderActionEntry } from '#imports';
import type {
    DbDeletePayload,
    ThreadEntity,
    DocumentEntity,
} from '~/utils/hook-types';
import { useMagicKeys, whenever } from '@vueuse/core';

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
const layoutRef = ref<InstanceType<typeof ResizableSidebarLayout> | null>(null);
const sideNavExpandedRef = ref<any | null>(null);
const showDashboardModal = ref(false);

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
} = useMultiPane({
    initialThreadId: props.initialThreadId,
    maxPanes: 3,
    onFlushDocument: (id) => flushDocument(id),
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

// Active thread convenience (first pane for sidebar highlight)
const activeChatThreadId = computed(() =>
    panes.value[0]?.mode === 'chat' ? panes.value[0].threadId || '' : ''
);

// --------------- Initializers ---------------
let validateToken = 0;

async function validateThread(id: string): Promise<boolean> {
    try {
        if (!db.isOpen()) await db.open();
    } catch {}
    const ATTEMPTS = 5;
    for (let a = 0; a < ATTEMPTS; a++) {
        try {
            const t = await db.threads.get(id);
            if (t && !t.deleted) return true;
        } catch {}
        if (a < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

async function validateDocument(id: string): Promise<boolean> {
    try {
        if (!db.isOpen()) await db.open();
    } catch {}
    const ATTEMPTS = 5;
    for (let a = 0; a < ATTEMPTS; a++) {
        try {
            const row = await db.posts.get(id);
            if (row && (row as any).postType === 'doc' && !(row as any).deleted)
                return true;
        } catch {}
        if (a < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

async function initInitial() {
    if (!process.client) return;
    const pane = panes.value[0];
    if (!pane) return;
    if (props.initialThreadId) {
        if (props.validateInitial) {
            pane.validating = true;
            const token = ++validateToken;
            const ok = await validateThread(props.initialThreadId);
            if (token !== validateToken) return;
            if (!ok) {
                redirectNotFound('chat');
                return;
            }
        }
        await setPaneThread(0, props.initialThreadId);
        pane.mode = 'chat';
        pane.validating = false;
        updateUrl();
        return;
    }
    if (props.initialDocumentId) {
        if (props.validateInitial) {
            pane.validating = true;
            const token = ++validateToken;
            const ok = await validateDocument(props.initialDocumentId);
            if (token !== validateToken) return;
            if (!ok) {
                redirectNotFound('doc');
                return;
            }
        }
        pane.mode = 'doc';
        pane.documentId = props.initialDocumentId;
        pane.threadId = '';
        pane.validating = false;
        updateUrl();
        return;
    }
    // No ids: set default mode
    if (props.defaultMode === 'doc') {
        pane.mode = 'doc';
        pane.documentId = undefined;
        pane.threadId = '';
    } else {
        pane.mode = 'chat';
    }
    updateUrl();
}

function redirectNotFound(kind: 'chat' | 'doc') {
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
function updateUrl() {
    if (!process.client || !props.routeSync) return;
    // Prevent route sync from clobbering the OAuth callback path while the
    // OpenRouter token exchange page is mounting. The callback component
    // itself will redirect after finishing, so we should not rewrite here.
    const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '';
    if (currentPath.startsWith('/openrouter-callback')) return;
    const pane = panes.value[activePaneIndex.value];
    if (!pane) return;
    const base = pane.mode === 'doc' ? '/docs' : '/chat';
    const id = pane.mode === 'doc' ? pane.documentId : pane.threadId;
    const newPath = id ? `${base}/${id}` : base;
    if (window.location.pathname === newPath) return;
    window.history.replaceState(window.history.state, '', newPath);
}

watch(
    () =>
        panes.value
            .map(
                (p) =>
                    `${p.id}:${p.mode}:${p.threadId || ''}:${
                        p.documentId || ''
                    }`
            )
            .join(','),
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
        await flushDocument(id); // central flush now emits saved
    },
});

async function onNewDocument(initial?: { title?: string }) {
    const doc = await newDocumentInActive(initial);
    if (doc) updateUrl();
    closeSidebarIfMobile();
}
async function onDocumentSelected(id: string) {
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
const themeIcon = computed(() =>
    themeName.value === 'dark' ? 'pixelarticons:sun' : 'pixelarticons:moon-star'
);
const themeAriaLabel = computed(() =>
    themeName.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
);

// --------------- Mobile + layout ---------------
import { isMobile } from '~/state/global';

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
// Mobile breakpoint watcher (flattened to avoid build transform issues in nested blocks)
if (process.client) {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => (isMobile.value = mq.matches);
    onMounted(() => {
        apply();
        mq.addEventListener('change', apply);
    });
    const dispose = () => mq.removeEventListener('change', apply);
    onUnmounted(dispose);
    if (import.meta.hot) import.meta.hot.dispose(dispose);
}
const showTopOffset = computed(() => panes.value.length > 1 || isMobile.value);
function openMobileSidebar() {
    (layoutRef.value as any)?.openSidebar?.();
}
function focusSidebarSearch() {
    const layout: any = layoutRef.value;
    if (layout?.expand) layout.expand();

    setTimeout(() => {
        sideNavExpandedRef.value?.focusSearchInput?.();
    }, 300);
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
});

// --------------- Shortcuts ---------------
if (process.client) {
    const down = (e: KeyboardEvent) => {
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
    };
    window.addEventListener('keydown', down);
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            window.removeEventListener('keydown', down)
        );
    } else {
        onUnmounted(() => window.removeEventListener('keydown', down));
    }
}
</script>
<style scoped>
body {
    overflow-y: hidden;
}
.pane-active {
    position: relative;
    transition: box-shadow 0.4s ease, background-color 0.3s ease;
}
.pane-active::after {
    content: '';
    pointer-events: none;
    position: absolute;
    inset: 0;
    border: 1px solid var(--md-primary);
    box-shadow: inset 0 0 0 1px var(--md-primary),
        inset 0 0 3px 1px var(--md-primary), inset 0 0 6px 2px var(--md-primary);
    mix-blend-mode: normal;
    opacity: 0.6;
    animation: panePulse 3.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
    .pane-active::after {
        animation: none;
    }
}
</style>
