<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div
            class="absolute w-full h-screen overflow-y-scroll sm:pt-3.5 pb-[165px]"
        >
            <div
                class="mx-auto flex w-full max-w-[768px] flex-col space-y-12 pb-10 pt-safe-offset-10"
            >
                <ChatMessage
                    v-for="(message, index) in messages || []"
                    :key="
                        message.id ||
                        message.stream_id ||
                        `${index}-${message.role}`
                    "
                    :message="message"
                />
            </div>
        </div>
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center pr-[11px]"
            >
                <chat-input-dropper
                    @send="onSend"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch } from 'vue';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
};

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessage[];
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(useChat(props.messageHistory, props.threadId));

watch(
    () => props.threadId,
    () => {
        chat.value = useChat(props.messageHistory, props.threadId);
    }
);

// Keep composable messages in sync when parent provides an updated messageHistory
watch(
    () => props.messageHistory,
    (mh) => {
        if (!chat.value) return;
        // Prefer to update the internal messages array directly to avoid remount flicker
        chat.value.messages.value = [...(mh || [])];
    }
);

// Stable bindings for template consumption
const messages = computed<ChatMessage[]>(() => chat.value.messages.value);
const loading = computed(() => chat.value.loading.value);

function onSend(payload: any) {
    chat.value.sendMessage(payload.text);
}
</script>

<style></style>
