<template>
    <resizable-sidebar-layout ref="layoutRef">
        <template #sidebar-expanded>
            <sidebar-side-nav-content
                :active-thread="threadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @newDocument="onNewDocument"
                @documentSelected="onDocumentSelected"
            />
        </template>
        <template #sidebar-collapsed>
            <SidebarSideNavContentCollapsed
                :active-thread="threadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
                @focusSearch="focusSidebarSearch"
            />
        </template>
        <div class="flex-1 h-screen w-full relative">
            <div
                id="top-nav"
                :class="{
                    'border-[var(--tw-border)] border-b-2 bg-[var(--md-surface-variant)]/20 backdrop-blur-sm':
                        panes.length > 1 || isMobile,
                }"
                class="absolute z-50 top-0 w-full h-[46px] inset-0 flex items-center justify-between pr-2 gap-2 pointer-events-none"
            >
                <!-- New Window Button -->
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
                <!-- Theme Toggle Button -->
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
                </div>
            </div>
            <!-- Panes Container -->
            <div
                :class="[
                    showTopOffset ? 'pt-[46px]' : 'pt-0',
                    ' h-full flex flex-row gap-0 items-stretch w-full overflow-hidden',
                ]"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    class="flex-1 relative flex flex-col border-l-2 first:border-l-0 outline-none focus-visible:ring-0"
                    :class="[
                        i === activePaneIndex && panes.length > 1
                            ? 'pane-active border-[var(--md-primary)] bg-[var(--md-surface-variant)]/10'
                            : 'border-[var(--tw-border)]',
                        'transition-colors',
                    ]"
                    tabindex="0"
                    @focus="setActive(i)"
                    @click="setActive(i)"
                    @keydown.left.prevent="focusPrev(i)"
                    @keydown.right.prevent="focusNext(i)"
                >
                    <!-- Close button (only if >1 pane) -->
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
                            @thread-selected="
                                (id) => onInternalThreadCreated(id, i)
                            "
                        />
                    </template>
                    <template v-else-if="pane.mode === 'doc'">
                        <DocumentEditor
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
                    </template>
                </div>
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import DocumentEditor from '~/components/documents/DocumentEditor.vue';
import Dexie from 'dexie';
import { db } from '~/db';
// No route pushes; we mutate the URL directly to avoid Nuxt remounts between /chat and /chat/<id>

/**
 * ChatPageShell centralizes the logic shared by /chat and /chat/[id]
 * Props:
 *  - initialThreadId: optional id to load immediately (deep link)
 *  - validateInitial: if true, ensure the initial thread exists else redirect + toast
 *  - routeSync: keep URL in sync with active thread id (default true)
 */
const props = withDefaults(
    defineProps<{
        initialThreadId?: string;
        validateInitial?: boolean;
        routeSync?: boolean;
    }>(),
    {
        validateInitial: false,
        routeSync: true,
    }
);

const router = useRouter();
const toast = useToast();
const layoutRef = ref<InstanceType<typeof ResizableSidebarLayout> | null>(null);

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
};

// ---------------- Multi-pane (phase 1: internal refactor) ----------------
// PaneState holds per-pane chat state. For Task 1 we still render a single pane; template
// continues to use computed aliases `threadId` & `messageHistory` pointing at pane[0].
interface PaneState {
    id: string; // local pane id (not thread id)
    mode: 'chat' | 'doc';
    threadId: string; // current thread id ('' if new chat) when mode==='chat'
    documentId?: string; // active document when mode==='doc'
    messages: ChatMessage[]; // loaded messages for the thread
    validating: boolean; // reserved for potential per-pane validation
}

function createEmptyPane(initialThreadId = ''): PaneState {
    const genId = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'pane-' + Math.random().toString(36).slice(2);
    return {
        id: genId(),
        mode: 'chat',
        threadId: initialThreadId,
        messages: [],
        validating: false,
    };
}

// Primary state: array of panes (currently single until Task 2 UI changes)
const panes = ref<PaneState[]>([createEmptyPane(props.initialThreadId || '')]);
// Active pane index (for future multi-pane interactions)
const activePaneIndex = ref(0);

// Backward compatible aliases used by existing template (will be removed in Task 2 step 2.1)
const threadId = computed<string>({
    get: () => panes.value[0]?.threadId || '',
    set: (v) => {
        if (panes.value[0]) panes.value[0].threadId = v;
    },
});
const messageHistory = computed<ChatMessage[]>(
    () => panes.value[0]?.messages || []
);
// Legacy validating handling mapped to pane[0]
const validating = computed<boolean>({
    get: () => panes.value[0]?.validating || false,
    set: (v) => {
        if (panes.value[0]) panes.value[0].validating = v;
    },
});
let validateToken = 0; // reused for initial validation, scoped now to pane[0]

// Extracted loader now returns messages for a thread id (Task 1.3)
async function loadMessagesFor(id: string): Promise<ChatMessage[]> {
    if (!id) return [];
    try {
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .filter((m: any) => !m.deleted)
            .toArray();
        return (msgs || []).map((msg: any) => {
            const data = msg.data as unknown;
            const content =
                typeof data === 'object' && data !== null && 'content' in data
                    ? String((data as any).content ?? '')
                    : String((msg.content as any) ?? '');
            return {
                role: msg.role as 'user' | 'assistant',
                content,
                file_hashes: msg.file_hashes,
                id: msg.id,
                stream_id: msg.stream_id,
            } as ChatMessage;
        });
    } catch (e) {
        // Fail soft; log once if desired (kept silent for now per simplicity)
        return [];
    }
}

// Helper to set a pane's thread & load messages (Task 1.4)
async function setPaneThread(index: number, id: string) {
    const pane = panes.value[index];
    if (!pane) return;
    pane.threadId = id;
    pane.messages = await loadMessagesFor(id);
}

// Activate pane (Task 1.5; not yet wired in template until Task 2)
function setActive(i: number) {
    if (i >= 0 && i < panes.value.length) activePaneIndex.value = i;
}

// ---------------- Task 2: UI / interaction helpers ----------------
const canAddPane = computed(() => panes.value.length < 3);
const newWindowTooltip = computed(() =>
    canAddPane.value ? 'New window' : 'Max 3 windows'
);

function addPane() {
    // Guard (Task 3.1): never exceed 3 panes even if called externally
    if (panes.value.length >= 3) return;
    panes.value.push(createEmptyPane());
    setActive(panes.value.length - 1);
}

function closePane(i: number) {
    if (panes.value.length <= 1) return; // never close last
    const wasActive = i === activePaneIndex.value;
    // Flush document if closing a doc pane
    const closing = panes.value[i];
    if (closing?.mode === 'doc' && closing.documentId) {
        flushDocument(closing.documentId);
    }
    panes.value.splice(i, 1);
    if (!panes.value.length) {
        // Safety: recreate a blank pane (should not normally happen)
        panes.value.push(createEmptyPane());
        activePaneIndex.value = 0;
        return;
    }
    if (wasActive) {
        // Task 3.2: ensure logical new active (nearest existing)
        const newIndex = Math.min(i, panes.value.length - 1);
        setActive(newIndex);
        const newPane = panes.value[newIndex];
        if (!newPane) return; // safety guard
        if (newPane.mode === 'chat') {
            updateUrlThread(newPane.threadId || undefined);
        } else {
            // Clear URL if previously a chat (remain at /chat)
            updateUrlThread(undefined);
        }
    } else if (i < activePaneIndex.value) {
        // shift active index left because array shrank before it
        activePaneIndex.value -= 1;
    }
}

function focusPrev(current: number) {
    if (panes.value.length < 2) return;
    const target = current - 1;
    if (target >= 0) setActive(target);
}
function focusNext(current: number) {
    if (panes.value.length < 2) return;
    const target = current + 1;
    if (target < panes.value.length) setActive(target);
}

async function ensureDbOpen() {
    try {
        if (!db.isOpen()) await db.open();
    } catch {}
}

async function validateThread(id: string): Promise<boolean> {
    await ensureDbOpen();
    const ATTEMPTS = 5;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            const t = await db.threads.get(id);
            if (t) return !t.deleted;
        } catch {}
        if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

function redirectNotFound() {
    router.replace('/chat');
    toast.add({
        title: 'Not found',
        description: 'This chat does not exist.',
        color: 'error',
    });
}

async function initInitialThread() {
    if (!process.client) return;
    if (!props.initialThreadId) return;
    const pane = panes.value[0];
    if (!pane) return;
    if (props.validateInitial) {
        pane.validating = true;
        const token = ++validateToken;
        const ok = await validateThread(props.initialThreadId);
        if (token !== validateToken) return; // superseded
        if (!ok) {
            redirectNotFound();
            return;
        }
    }
    await setPaneThread(0, props.initialThreadId);
    pane.validating = false;
}

// Theme toggle (SSR safe)
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
const themeName = ref<string>(getThemeSafe());
function syncTheme() {
    themeName.value = getThemeSafe();
}
function toggleTheme() {
    const api = nuxtApp.$theme as any;
    if (api?.toggle) api.toggle();
    // After toggle, re-read
    syncTheme();
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

// Mobile detection to keep padding on small screens
import { isMobile } from '~/state/global';

if (process.client) {
    onMounted(() => {
        const mq = window.matchMedia('(max-width: 640px)');
        const apply = () => (isMobile.value = mq.matches);
        apply();
        mq.addEventListener('change', apply);
        if (import.meta.hot) {
            import.meta.hot.dispose(() =>
                mq.removeEventListener('change', apply)
            );
        } else {
            onUnmounted(() => mq.removeEventListener('change', apply));
        }
    });
}

// Only offset content when multi-pane OR on mobile (toolbar overlap avoidance)
const showTopOffset = computed(() => panes.value.length > 1 || isMobile.value);

onMounted(() => {
    initInitialThread();
    syncTheme();
    // Safety: ensure at least one pane exists (Task 3.5 defensive)
    if (!panes.value.length) panes.value.push(createEmptyPane());
});

// Previous watcher removed; pane thread changes now go through setPaneThread (Task 1.6 cleanup)

function updateUrlThread(id?: string) {
    if (!process.client || !props.routeSync) return;
    const newPath = id ? `/chat/${id}` : '/chat';
    if (window.location.pathname === newPath) return; // no-op
    // Preserve existing history.state so back button stack stays intact
    window.history.replaceState(window.history.state, '', newPath);
}

// Sidebar selection
function onSidebarSelected(id: string) {
    if (!id) return;
    const target = activePaneIndex.value;
    setPaneThread(target, id);
    const pane = panes.value[target];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
    }
    if (target === activePaneIndex.value) updateUrlThread(id);
}

// ChatContainer emitted new thread (first user send)
function onInternalThreadCreated(id: string, paneIndex?: number) {
    if (!id) return;
    const idx =
        typeof paneIndex === 'number' ? paneIndex : activePaneIndex.value;
    const pane = panes.value[idx];
    if (!pane) return;
    pane.mode = 'chat';
    pane.documentId = undefined;
    if (pane.threadId !== id) setPaneThread(idx, id);
    if (idx === activePaneIndex.value) updateUrlThread(id);
}

function onNewChat() {
    const pane = panes.value[activePaneIndex.value];
    if (pane) {
        pane.mode = 'chat';
        pane.documentId = undefined;
        pane.messages = [];
        pane.threadId = '';
    }
    updateUrlThread(undefined);
}

// --------------- Documents Integration (minimal) ---------------
import {
    newDocument as createNewDoc,
    flush as flushDocument,
} from '~/composables/useDocumentsStore';

async function onNewDocument(initial?: { title?: string }) {
    const pane = panes.value[activePaneIndex.value];
    if (!pane) return;
    try {
        // Flush existing doc if switching from another document
        if (pane.mode === 'doc' && pane.documentId) {
            await flushDocument(pane.documentId);
        }
        const doc = await createNewDoc(initial);
        pane.mode = 'doc';
        pane.documentId = doc.id;
        // Clear chat-specific state
        pane.threadId = '';
        pane.messages = [];
        // Do NOT route sync for documents (out of scope)
    } catch {}
}

function onDocumentSelected(id: string) {
    if (!id) return;
    const pane = panes.value[activePaneIndex.value];
    if (!pane) return;
    // Flush any current doc before switching
    if (pane.mode === 'doc' && pane.documentId && pane.documentId !== id) {
        flushDocument(pane.documentId);
    }
    pane.mode = 'doc';
    pane.documentId = id;
    pane.threadId = '';
    pane.messages = [];
}

// Keyboard shortcut: Cmd/Ctrl + Shift + D => new document in active pane
if (process.client) {
    const down = (e: KeyboardEvent) => {
        if (!e.shiftKey) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        if (e.key.toLowerCase() === 'd') {
            // Ignore if focused in input/textarea/contentEditable
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

// Mobile sidebar control
function openMobileSidebar() {
    // call exposed method on layout to force open
    (layoutRef.value as any)?.openSidebar?.();
}

// Exposed to collapsed sidebar search button via emit
function focusSidebarSearch() {
    const layout: any = layoutRef.value;
    if (layout?.expand) layout.expand();
    // Defer focus to next tick so sidebar DOM present if previously collapsed
    requestAnimationFrame(() => {
        const input = document.querySelector(
            'aside input[placeholder="Search threads..."]'
        ) as HTMLInputElement | null;
        if (input) input.focus();
    });
}
</script>

<style scoped>
body {
    overflow-y: hidden;
}

/* Active pane visual indicator (retro glow using primary color) */
.pane-active {
    position: relative;
    /* Smooth color / shadow transition when switching panes */
    transition: box-shadow 0.4s ease, background-color 0.3s ease;
}

.pane-active::after {
    content: '';
    pointer-events: none;
    position: absolute;
    inset: 0; /* cover full pane */
    border: 1px solid var(--md-primary);

    /* Layered shadows for a subtle glow while still retro / crisp */
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
