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
                <div
                    v-for="(message, index) in messages"
                    :key="index + message.role"
                    :class="{
                        'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end':
                            message.role === 'user',
                        'bg-white/5 border-2 w-full! retro-shadow backdrop-blur-sm':
                            message.role === 'assistant',
                    }"
                    class="p-2 rounded-md my-2"
                >
                    <div
                        :class="{
                            'prose prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] max-w-full p-4':
                                message.role === 'assistant',
                        }"
                        v-html="marked.parse(message.content)"
                    ></div>
                </div>
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
import { marked } from 'marked';
type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

let message;
// Seed the conversation and use the composable's messages (which stream updates)
const initialMessages: ChatMessage[] = [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'How are you?' },
];

const { messages, sendMessage, loading } = useChat(initialMessages);

function onSend(payload: any) {
    sendMessage(payload.text);
}
</script>

<style></style>
