<template>
    <resizable-sidebar-layout>
        <template #sidebar-expanded>
            <sidebar-side-nav-content
                :active-thread="threadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
            />
        </template>
        <template #sidebar-collapsed>
            <SidebarSideNavContentCollapsed
                :active-thread="threadId"
                @new-chat="onNewChat"
                @chatSelected="onSidebarSelected"
            />
        </template>
        <div class="flex-1 h-screen w-full relative">
            <div
                class="absolute z-50 top-0 w-full border-b-2 border-[var(--tw-border)] bg-[var(--md-surface-variant)]/20 backdrop-blur-sm h-[46px] inset-0 flex items-center justify-between pr-2 gap-2 pointer-events-none"
            >
                <!-- New Window Button -->
                <div class="h-full flex items-center justify-center px-4">
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
                class="pt-[46px] h-full flex flex-row gap-0 items-stretch w-full overflow-hidden"
            >
                <div
                    v-for="(pane, i) in panes"
                    :key="pane.id"
                    class="flex-1 relative flex flex-col border-l-2 first:border-l-0 outline-none focus-visible:ring-0"
                    :class="[
                        i === activePaneIndex
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

                    <ChatContainer
                        class="flex-1 min-h-0"
                        :message-history="pane.messages"
                        :thread-id="pane.threadId"
                        @thread-selected="
                            (id) => onInternalThreadCreated(id, i)
                        "
                    />
                </div>
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
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
    threadId: string; // current thread id ('' if new chat)
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
        const activeThread = panes.value[newIndex]?.threadId;
        updateUrlThread(activeThread || undefined);
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
    if (target === activePaneIndex.value) updateUrlThread(id);
}

// ChatContainer emitted new thread (first user send)
function onInternalThreadCreated(id: string, paneIndex?: number) {
    if (!id) return;
    const idx =
        typeof paneIndex === 'number' ? paneIndex : activePaneIndex.value;
    const pane = panes.value[idx];
    if (!pane) return;
    if (pane.threadId !== id) setPaneThread(idx, id);
    if (idx === activePaneIndex.value) updateUrlThread(id);
}

function onNewChat() {
    const pane = panes.value[activePaneIndex.value];
    if (pane) {
        pane.messages = [];
        pane.threadId = '';
    }
    updateUrlThread(undefined);
}
</script>

<style scoped>
body {
    overflow-y: hidden;
}
</style>
