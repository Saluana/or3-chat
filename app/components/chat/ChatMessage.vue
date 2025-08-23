<template>
    <div :class="outerClass" class="p-2 rounded-md my-2">
        <div :class="innerClass" v-html="rendered"></div>
        <div
            v-if="hashList.length"
            class="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
        >
            <div
                v-for="h in hashList"
                :key="h"
                class="relative aspect-square border-2 border-black rounded-[3px] retro-shadow overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-lowest)]"
            >
                <template v-if="thumbnails[h]?.status === 'ready'">
                    <img
                        :src="thumbnails[h].url"
                        :alt="'file ' + h.slice(0, 8)"
                        class="object-cover w-full h-full"
                        draggable="false"
                    />
                </template>
                <template v-else-if="thumbnails[h]?.status === 'error'">
                    <div class="text-[10px] text-center px-1 text-error">
                        failed
                    </div>
                </template>
                <template v-else>
                    <div class="animate-pulse text-[10px] opacity-70">
                        loading
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watchEffect } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { getFileBlob } from '~/db/files';
import { marked } from 'marked';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null; // serialized array
};

import type { ChatMessage as ChatMessageType } from '~/composables/useAi';

// Local UI message expects content to be a string (rendered markdown/html)
type UIMessage = Omit<ChatMessageType, 'content'> & { content: string };

const props = defineProps<{ message: UIMessage }>();

const outerClass = computed(() => ({
    'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end':
        props.message.role === 'user',
    'bg-white/5 border-2 w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

const rendered = computed(() => marked.parse(props.message.content));

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() => {
    const raw = (props.message as any).file_hashes;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') return parseFileHashes(raw);
    return [];
});

interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string; // object URL
}

const thumbnails = reactive<Record<string, ThumbState>>({});

watchEffect(async () => {
    for (const h of hashList.value) {
        if (thumbnails[h]) continue; // already loading/loaded
        thumbnails[h] = { status: 'loading' };
        try {
            const blob = await getFileBlob(h);
            if (!blob) throw new Error('missing');
            const url = URL.createObjectURL(blob);
            thumbnails[h] = { status: 'ready', url };
        } catch (e) {
            thumbnails[h] = { status: 'error' };
        }
    }
});
</script>

<style scoped></style>
