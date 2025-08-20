<template>
    <div :class="outerClass" class="p-2 rounded-md my-2">
        <div :class="innerClass" v-html="rendered"></div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

const props = defineProps<{ message: ChatMessage }>();

const outerClass = computed(() => ({
    'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end':
        props.message.role === 'user',
    'bg-white/5 border-2 w-full! retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] max-w-full p-4':
        props.message.role === 'assistant',
}));

const rendered = computed(() => marked.parse(props.message.content));
</script>

<style scoped></style>
