<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div class="absolute inset-0 overflow-y-auto sm:pt-3.5 pb-[165px]">
            <div
                class="mx-auto flex w-full max-w-[768px] flex-col space-y-12 px-4 pb-10 pt-safe-offset-10"
            >
                <div
                    v-for="message in messages"
                    :key="message.content"
                    :class="{
                        'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end':
                            message.role === 'user',
                        'bg-white/5 border-2 w-full! retro-shadow backdrop-blur-sm':
                            message.role === 'assistant',
                    }"
                    class="p-2 rounded-md my-2"
                >
                    <div :class="{ prose: message.role === 'assistant' }">
                        {{ message.content }}
                    </div>
                </div>
            </div>
        </div>
        <div class="absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full px-2 sm:px-3.5 flex justify-center"
            >
                <chat-input-dropper
                    @send="onSend"
                    class="pointer-events-auto w-full max-w-[768px] mx-auto mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const messages = ref<ChatMessage[]>([
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'How are you?' },
]);

const chat = useChat(messages.value);

function onSend(payload: any) {
    console.log(payload);
}
</script>

<style></style>
