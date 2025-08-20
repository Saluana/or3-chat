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
                    v-for="(message, index) in messages"
                    :key="index + message.role"
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
type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

let message;
const thread = ref<any>(null);
// Seed the conversation and use the composable's messages (which stream updates)
const initialMessages: ChatMessage[] = [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'How are you?' },
];

import { useHookEffect } from '~/composables/useHookEffect';

useHookEffect(
    'ai.chat.send:action:after',
    (payload) => {
        // payload: the final message or a response object (adapt to your app's shape)
        console.log('Full message received', payload);

        if (!thread.value) {
            thread.value = payload.threadId;
        }

        // e.g. scroll chat, play sound, analytics
    },
    { kind: 'action' } // optional, documents intent and ensures correct handling
);

const { messages, sendMessage, loading } = useChat(
    initialMessages,
    thread.value ? thread.value : undefined
);

function onSend(payload: any) {
    sendMessage(payload.text);
}
</script>

<style></style>
