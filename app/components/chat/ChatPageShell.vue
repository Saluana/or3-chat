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
        <div class="flex-1 h-screen w-full">
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

onMounted(() => {
    initInitialThread();
});

watch(
    () => threadId.value,
    async (id) => {
        if (id) await loadMessages(id);
    }
);

// Sidebar selection
function onSidebarSelected(id: string) {
    if (!id) return;
    threadId.value = id;
    if (props.routeSync) router.push(`/chat/${id}`);
}

// ChatContainer emitted new thread (first user send)
function onInternalThreadCreated(id: string) {
    if (!id) return;
    // Avoid loop if already set
    if (threadId.value !== id) threadId.value = id;
    if (props.routeSync) router.push(`/chat/${id}`);
}

function onNewChat() {
    messageHistory.value = [];
    threadId.value = '';
    if (props.routeSync) router.push('/chat');
}
</script>

<style scoped>
body {
    overflow-y: hidden;
}
</style>
