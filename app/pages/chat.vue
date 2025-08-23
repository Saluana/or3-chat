<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content
                @new-chat="onNewChat"
                @chatSelected="onChatSelected"
                :active-thread="threadId"
            />
        </template>
        <div class="flex-1 h-screen w-full">
            <ChatContainer
                :message-history="messageHistory"
                :thread-id="threadId"
                @thread-selected="onChatSelected"
            />
        </div>
    </resizable-sidebar-layout>
</template>

<script lang="ts" setup>
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { db, upsert } from '~/db';
import { ref, onMounted, watch } from 'vue';
import Dexie from 'dexie';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
};

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref(''); // Replace with actual thread ID logic

async function getMessagesForThread(id: string) {
    if (!id) return;

    // Query ordered messages via compound index and filter deleted
    const msgs = await db.messages
        .where('[thread_id+index]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .filter((m: any) => !m.deleted)
        .toArray();

    if (msgs) {
        messageHistory.value = msgs.map((msg: any) => {
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

        if ((import.meta as any).dev) {
            console.debug('[chat] loaded messages', {
                thread: id,
                count: messageHistory.value.length,
                withHashes: messageHistory.value.filter((m) => m.file_hashes)
                    .length,
                hashesPreview: messageHistory.value
                    .filter((m) => m.file_hashes)
                    .slice(0, 3)
                    .map((m) => (m.file_hashes || '').slice(0, 60)),
            });
        }
    }
}

onMounted(async () => {
    await getMessagesForThread(threadId.value);
});

watch(
    () => threadId.value,
    async (newThreadId) => {
        if (newThreadId) {
            // Bump updated_at to reflect "last opened" ordering in sidebar
            const t = await db.threads.get(newThreadId);
            if (t) {
                const now = Math.floor(Date.now() / 1000);
                await upsert.thread({ ...t, updated_at: now });
            }
            await getMessagesForThread(newThreadId);
        }
    }
);

function onNewChat() {
    messageHistory.value = [];
    threadId.value = '';
    console.log('New chat started, cleared message history and thread ID');
}

function onChatSelected(chatId: string) {
    threadId.value = chatId;
}

// Optional enhancement: if needed, we can also watch for outgoing user messages from ChatContainer via a custom event
// and append to messageHistory immediately to avoid any initial blank state. Current fix defers parent overwrite during loading instead.
</script>

<style>
body {
    overflow-y: hidden; /* Prevents body scroll */
}
</style>
