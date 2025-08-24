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
                class="absolute z-50 top-0 w-full border-b-2 border-black h-[46px] inset-0 flex items-center justify-end pr-2 gap-2 pointer-events-none"
            >
                <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :square="true"
                    :class="'retro-btn pointer-events-auto mr-4'"
                    :ui="{ base: 'retro-btn' }"
                    :aria-label="themeAriaLabel"
                    :title="themeAriaLabel"
                    @click="toggleTheme"
                >
                    <UIcon :name="themeIcon" class="w-5 h-5" />
                </UButton>
            </div>
            <ChatContainer
                :message-history="messageHistory"
                :thread-id="threadId"
                @thread-selected="onInternalThreadCreated"
            />
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

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref<string>(props.initialThreadId || '');
const validating = ref(false);
let validateToken = 0;

async function loadMessages(id: string) {
    if (!id) return;
    const msgs = await db.messages
        .where('[thread_id+index]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .filter((m: any) => !m.deleted)
        .toArray();
    messageHistory.value = (msgs || []).map((msg: any) => {
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
    if (props.validateInitial) {
        validating.value = true;
        const token = ++validateToken;
        const ok = await validateThread(props.initialThreadId);
        if (token !== validateToken) return; // superseded
        if (!ok) {
            redirectNotFound();
            return;
        }
    }
    threadId.value = props.initialThreadId;
    await loadMessages(threadId.value);
    validating.value = false;
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
});

watch(
    () => threadId.value,
    async (id) => {
        if (id) await loadMessages(id);
    }
);

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
    threadId.value = id;
    updateUrlThread(id);
}

// ChatContainer emitted new thread (first user send)
function onInternalThreadCreated(id: string) {
    if (!id) return;
    if (threadId.value !== id) threadId.value = id;
    updateUrlThread(id); // immediate URL update without triggering Nuxt routing
}

function onNewChat() {
    messageHistory.value = [];
    threadId.value = '';
    updateUrlThread(undefined);
}
</script>

<style scoped>
body {
    overflow-y: hidden;
}
</style>
