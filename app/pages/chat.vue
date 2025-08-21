<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content @chatSelected="onChatSelected" />
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
import { db } from '~/db';
import { ref, onMounted, watch } from 'vue';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref(''); // Replace with actual thread ID logic

async function getMessagesForThread(id: string) {
    if (!id) return;

    // Use thread_id index and ensure stable ordering by index (then created_at) and skip deleted
    let msgs = await db.messages
        .where('thread_id')
        .equals(id)
        .and((m: any) => !m.deleted)
        .sortBy('index');

    // Extra stability: tie-break on created_at if indexes are equal
    msgs = msgs.sort(
        (a: any, b: any) => a.index - b.index || a.created_at - b.created_at
    );

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
