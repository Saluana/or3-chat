<template>
    <div
        :class="outerClass"
        :style="{
            paddingRight:
                props.message.role === 'user' && hashList.length && !expanded
                    ? '80px'
                    : '0',
        }"
        class="p-2 rounded-md first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <!-- Compact thumb (collapsed state) -->
        <button
            v-if="hashList.length && !expanded"
            class="absolute -top-2 -right-2 border-2 border-black retro-shadow rounded-[4px] overflow-hidden w-14 h-14 bg-[var(--md-surface-container-lowest)] flex items-center justify-center group"
            @click="toggleExpanded"
            type="button"
            aria-label="Show attachments"
        >
            <template
                v-if="firstThumb && thumbnails[firstThumb]?.status === 'ready'"
            >
                <img
                    :src="thumbnails[firstThumb!]?.url"
                    :alt="'attachment ' + firstThumb.slice(0, 6)"
                    class="object-cover w-full h-full"
                    draggable="false"
                />
            </template>
            <template
                v-else-if="
                    firstThumb && thumbnails[firstThumb]?.status === 'error'
                "
            >
                <span class="text-[10px] text-error">err</span>
            </template>
            <template v-else>
                <span class="text-[10px] animate-pulse opacity-70">…</span>
            </template>
            <span
                v-if="hashList.length > 1"
                class="absolute bottom-0 right-0 text-[14px] font-semibold bg-black/70 text-white px-1"
                >+{{ hashList.length - 1 }}</span
            >
        </button>

        <div :class="innerClass" v-html="rendered"></div>

        <!-- Expanded grid -->
        <div
            v-if="hashList.length && expanded"
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
            <button
                class="col-span-full mt-1 justify-self-start text-xs underline text-[var(--md-primary)]"
                type="button"
                @click="toggleExpanded"
                aria-label="Hide attachments"
            >
                Hide attachments
            </button>
        </div>

        <!-- Action buttons: overlap bubble border half outside -->
        <div
            class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
        >
            <UButtonGroup
                :class="{
                    'bg-primary': props.message.role === 'user',
                    'bg-white': props.message.role === 'assistant',
                }"
                class="rounded-[3px]"
            >
                <UTooltip :delay-duration="0" text="Copy">
                    <UButton
                        @click="copyMessage"
                        icon="pixelarticons:copy"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Retry">
                    <UButton
                        icon="pixelarticons:reload"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                        @click="onRetry"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Branch">
                    <UButton
                        @click="onBranch"
                        icon="pixelarticons:git-branch"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Edit">
                    <UButton
                        icon="pixelarticons:edit-box"
                        color="info"
                        size="sm"
                        class="text-black flex items-center justify-center"
                    ></UButton>
                </UTooltip>
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watchEffect, ref } from 'vue';
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

const props = defineProps<{ message: UIMessage; threadId?: string }>();
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'branch', id: string): void;
}>();

const outerClass = computed(() => ({
    'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end pb-5':
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

const expanded = ref(false);
const firstThumb = computed(() => hashList.value[0]);
function toggleExpanded() {
    if (!hashList.value.length) return;
    expanded.value = !expanded.value;
}

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
import { useToast } from '#imports';
function copyMessage() {
    navigator.clipboard.writeText(props.message.content);

    useToast().add({
        title: 'Message copied',
        description: 'The message content has been copied to your clipboard.',
        duration: 2000,
    });
}

function onRetry() {
    const id = (props.message as any).id;
    if (!id) return;
    emit('retry', id);
}

import { forkThread, retryBranch } from '~/db/branching';

// Branch popover state
const branchMode = ref<'reference' | 'copy'>('copy');
const branchModes = [
    { label: 'Reference', value: 'reference' },
    { label: 'Copy', value: 'copy' },
];
const branchTitle = ref('');
const branching = ref(false);

async function onBranch() {
    if (branching.value) return;
    branching.value = true;
    const messageId = (props.message as any).id;
    if (!messageId) return;
    try {
        let res: any;
        // For assistant messages we now allow direct anchoring (captures assistant content in branch).
        // If "retry" semantics desired, a separate Retry action still uses retryBranch.
        res = await forkThread({
            sourceThreadId: props.threadId || '',
            anchorMessageId: messageId,
            mode: branchMode.value,
            titleOverride: branchTitle.value || undefined,
        });
        emit('branch', res.thread.id);
        useToast().add({
            title: 'Branched',
            description: `New branch: ${res.thread.title}`,
            color: 'primary',
            duration: 2200,
        });
    } catch (e: any) {
        useToast().add({
            title: 'Branch failed',
            description: e?.message || 'Error creating branch',
            color: 'error',
            duration: 3000,
        });
    } finally {
        branching.value = false;
    }
}
</script>

<style scoped></style>
