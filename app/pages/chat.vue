<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content @chatSelected="onChatSelected" />
        </template>
        <div class="flex-1 h-screen w-full">
            <ChatContainer
                :key="threadId || 'no-thread'"
                :message-history="messageHistory"
                :thread-id="threadId"
            />
        </div>
    </resizable-sidebar-layout>
</template>

<script lang="ts" setup>
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { db } from '~/db';
import { ref, onMounted } from 'vue';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref(''); // Replace with actual thread ID logic

async function getMessagesForThread(id: string) {
    if (!id) return;

    // FIX: use snake_case key that is actually indexed in Dexie
    const msgs = await db.messages.where('thread_id').equals(id).toArray();

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
            };
        });

        console.log('Messages for thread:', id, messageHistory.value);
    }
}

onMounted(async () => {
    await getMessagesForThread(threadId.value);
});

watch(
    () => threadId.value,
    async (newThreadId) => {
        if (newThreadId) {
            await getMessagesForThread(newThreadId);
        }
    }
);

function onChatSelected(chatId: string) {
    threadId.value = chatId;
}
</script>

<style>
body {
    overflow-y: hidden; /* Prevents body scroll */
}
</style>
