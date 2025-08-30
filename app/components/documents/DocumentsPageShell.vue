<template>
    <resizable-sidebar-layout ref="layoutRef">
        <template #sidebar-expanded>
            <lazy-sidebar-side-nav-content
                ref="sideNavExpandedRef"
                :active-thread="''"
                @newDocument="onNewDocument"
                @documentSelected="onDocumentSelected"
                @chatSelected="onSidebarChatSelected"
                @new-chat="onSidebarNewChat"
            />
        </template>
        <template #sidebar-collapsed>
            <lazy-sidebar-side-nav-content-collapsed
                :active-thread="''"
                @focusSearch="focusSidebarSearch"
                @chatSelected="onSidebarChatSelected"
                @new-chat="onSidebarNewChat"
            />
        </template>
        <div class="flex-1 h-screen w-full relative">
            <div
                id="top-nav"
                class="absolute z-50 top-0 w-full h-[46px] inset-0 flex items-center justify-end pr-2 gap-2 pointer-events-none"
            >
                <div class="h-full flex items-center justify-center px-2">
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
                </div>
            </div>
            <div
                :class="[
                    'pt-[46px]',
                    'h-full flex flex-row gap-0 items-stretch w-full overflow-hidden',
                ]"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    class="flex-1 relative flex flex-col border-l-2 first:border-l-0 outline-none focus-visible:ring-0"
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
                    <LazyDocumentsDocumentEditor
                        v-if="pane.documentId"
                        :document-id="pane.documentId"
                        class="flex-1 min-h-0"
                    />
                    <div
                        v-else
                        class="flex-1 flex items-center justify-center text-sm opacity-70"
                    >
                        No document.
                    </div>
                </div>
            </div>
        </div>
    </resizable-sidebar-layout>
</template>
<script setup lang="ts">
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { useMultiPane } from '~/composables/useMultiPane';
import { newDocument as createNewDoc } from '~/composables/useDocumentsStore';
import { ensureDbOpen as ensureDocumentsDbOpen } from '~/db/documents';
import { usePaneDocuments } from '~/composables/usePaneDocuments';
import { db } from '~/db';

const props = withDefaults(
    defineProps<{
        initialDocumentId?: string;
        validateInitial?: boolean;
        routeSync?: boolean;
    }>(),
    { validateInitial: false, routeSync: true }
);

// Multi-pane: we only use doc mode; thread related fields remain unused.
import { flush as flushDocument } from '~/composables/useDocumentsStore';
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
    ensureAtLeastOne,
} = useMultiPane({ onFlushDocument: (id) => flushDocument(id) });

// Convert first pane to doc mode when loading an existing document
watch(
    () => props.initialDocumentId,
    (id) => {
        if (!id) return;
        const pane = panes.value[0];
        if (pane) {
            pane.mode = 'doc';
            pane.documentId = id;
            pane.threadId = '';
        }
    },
    { immediate: true }
);

const router = useRouter();
const toast = useToast();

async function validateDocument(id: string): Promise<boolean> {
    await ensureDocumentsDbOpen();
    const ATTEMPTS = 5;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const row = await db.posts.get(id);
            if (row && (row as any).postType === 'doc' && !(row as any).deleted)
                return true;
        } catch {}
        if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

function redirectNotFound() {
    router.replace('/docs');
    toast.add({
        title: 'Not found',
        description: 'This document does not exist.',
        color: 'error',
    });
}

let validateToken = 0;
async function initInitialDocument() {
    if (!process.client) return;
    if (!props.initialDocumentId) return;
    const pane = panes.value[0];
    if (!pane) return;
    if (props.validateInitial) {
        pane.validating = true;
        const token = ++validateToken;
        const ok = await validateDocument(props.initialDocumentId);
        if (token !== validateToken) return;
        if (!ok) return redirectNotFound();
    }
    pane.mode = 'doc';
    pane.documentId = props.initialDocumentId;
    pane.threadId = '';
    pane.validating = false;
    updateUrlDocument(props.initialDocumentId);
}

function updateUrlDocument(id?: string) {
    if (!process.client || !props.routeSync) return;
    const newPath = id ? `/docs/${id}` : '/docs';
    if (window.location.pathname === newPath) return;
    window.history.replaceState(window.history.state, '', newPath);
}

// Watch active pane doc changes to sync URL
watch(
    () =>
        panes.value
            .map((p) => `${p.id}:${p.documentId || ''}:${p.mode}`)
            .join(','),
    () => {
        const pane = panes.value[activePaneIndex.value];
        if (!pane) return;
        if (pane.mode === 'doc') updateUrlDocument(pane.documentId);
        else updateUrlDocument(undefined);
    }
);

// Documents operations
const { newDocumentInActive, selectDocumentInActive } = usePaneDocuments({
    panes,
    activePaneIndex,
    createNewDoc,
    flushDocument: (id) => flushDocument(id),
});

async function onNewDocument(initial?: { title?: string }) {
    const doc = await newDocumentInActive(initial);
    if (doc) updateUrlDocument(doc.id);
}
async function onDocumentSelected(id: string) {
    await selectDocumentInActive(id);
    updateUrlDocument(id);
}

// If user picks a chat in sidebar, navigate to chat route (keeps consistent behavior with unified sidebar)
function onSidebarChatSelected(id: string) {
    if (!id) return;
    router.push(`/chat/${id}`);
}
function onSidebarNewChat() {
    router.push('/chat');
}

// Theme toggle (copied minimal from chat shell)
const nuxtApp = useNuxtApp();
const themeName = ref('light');
function getThemeSafe() {
    try {
        const api = nuxtApp.$theme as any;
        if (api && typeof api.get === 'function') return api.get();
        if (process.client)
            return document.documentElement.classList.contains('dark')
                ? 'dark'
                : 'light';
    } catch {}
    return 'light';
}
function syncTheme() {
    themeName.value = getThemeSafe();
}
function toggleTheme() {
    (nuxtApp.$theme as any)?.toggle?.();
    syncTheme();
}
if (process.client) {
    onMounted(() => {
        syncTheme();
        const root = document.documentElement;
        const observer = new MutationObserver(syncTheme);
        observer.observe(root, {
            attributes: true,
            attributeFilter: ['class'],
        });
        if (import.meta.hot)
            import.meta.hot.dispose(() => observer.disconnect());
        else onUnmounted(() => observer.disconnect());
    });
}
const themeIcon = computed(() =>
    themeName.value === 'dark' ? 'pixelarticons:sun' : 'pixelarticons:moon-star'
);
const themeAriaLabel = computed(() =>
    themeName.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
);

// Sidebar focus (collapsed)
const layoutRef = ref<InstanceType<typeof ResizableSidebarLayout> | null>(null);
const sideNavExpandedRef = ref<any | null>(null);
function focusSidebarSearch() {
    const layout: any = layoutRef.value;
    if (layout?.expand) layout.expand();
    requestAnimationFrame(() => sideNavExpandedRef.value?.focusSearchInput?.());
}

onMounted(() => {
    ensureAtLeastOne();
    initInitialDocument();
});

// Keyboard shortcut: Cmd/Ctrl + Shift + D => new document
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
    if (import.meta.hot)
        import.meta.hot.dispose(() =>
            window.removeEventListener('keydown', down)
        );
    else onUnmounted(() => window.removeEventListener('keydown', down));
}
</script>
<style scoped>
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
