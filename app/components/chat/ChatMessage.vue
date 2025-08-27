<template>
    <div
        :class="outerClass"
        :style="{
            paddingRight:
                props.message.role === 'user' && hashList.length && !expanded
                    ? '80px'
                    : '16px',
        }"
        class="p-2 min-w-[140px] rounded-md first:mt-3 first:mb-6 not-first:my-6 relative"
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

        <div v-if="!editing" :class="innerClass" v-html="rendered"></div>
        <!-- Editing surface -->
        <div v-else class="w-full">
            <MessageEditor
                v-model="draft"
                :autofocus="true"
                :focus-delay="120"
            />
            <div class="flex w-full justify-end gap-2 mt-2">
                <UButton
                    size="sm"
                    color="success"
                    class="retro-btn"
                    @click="saveEdit"
                    :loading="saving"
                    >Save</UButton
                >
                <UButton
                    size="sm"
                    color="error"
                    class="retro-btn"
                    @click="cancelEdit"
                    >Cancel</UButton
                >
            </div>
        </div>

        <!-- Expanded grid -->
        <MessageAttachmentsGallery
            v-if="hashList.length && expanded"
            :hashes="hashList"
            @collapse="toggleExpanded"
        />

        <!-- Action buttons: overlap bubble border half outside -->
        <div
            v-if="!editing"
            class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
        >
            <UButtonGroup
                :class="{
                    'bg-primary': props.message.role === 'user',
                    'bg-white': props.message.role === 'assistant',
                }"
                class="rounded-[3px]"
            >
                <UTooltip :delay-duration="0" text="Copy" :teleport="true">
                    <UButton
                        @click="copyMessage"
                        icon="pixelarticons:copy"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip
                    :delay-duration="0"
                    text="Retry"
                    :popper="{ strategy: 'fixed' }"
                    :teleport="true"
                >
                    <UButton
                        icon="pixelarticons:reload"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                        @click="onRetry"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Branch" :teleport="true">
                    <UButton
                        @click="onBranch"
                        icon="pixelarticons:git-branch"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Edit" :teleport="true">
                    <UButton
                        icon="pixelarticons:edit-box"
                        color="info"
                        size="sm"
                        class="text-black dark:text-white/95 flex items-center justify-center"
                        @click="beginEdit"
                    ></UButton>
                </UTooltip>
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { parseFileHashes } from '~/db/files-util';
import { marked } from 'marked';
import MessageEditor from './MessageEditor.vue';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { useMessageEditing } from '~/composables/useMessageEditing';

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
    (e: 'edited', payload: { id: string; content: string }): void;
}>();

const outerClass = computed(() => ({
    'bg-primary text-white dark:text-black border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end ml-auto pb-5':
        props.message.role === 'user',
    'bg-white/5 border-2 w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none dark:text-white/95 w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

const rendered = computed(() => marked.parse(props.message.content));

// Editing (extracted)
const {
    editing,
    draft,
    saving,
    beginEdit,
    cancelEdit,
    saveEdit: internalSaveEdit,
} = useMessageEditing(props.message);
async function saveEdit() {
    await internalSaveEdit();
    if (!editing.value) {
        const id = (props.message as any).id;
        if (id) emit('edited', { id, content: draft.value });
    }
}

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() => {
    const raw = (props.message as any).file_hashes;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') return parseFileHashes(raw);
    return [];
});

// Compact thumb preview support (attachments gallery handles full grid). Reuse global caches.
interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}
const thumbnails = reactive<Record<string, ThumbState>>({});
const thumbCache = ((globalThis as any).__or3ThumbCache ||= new Map<
    string,
    ThumbState
>());
const thumbLoadPromises = ((globalThis as any).__or3ThumbInflight ||= new Map<
    string,
    Promise<void>
>());

// Per-message persistent UI state stored directly on the message object to
// survive virtualization recycling without external maps.
const expanded = ref<boolean>(
    (props.message as any)._expanded === true || false
);
watch(expanded, (v) => ((props.message as any)._expanded = v));
const firstThumb = computed(() => hashList.value[0]);
function toggleExpanded() {
    if (!hashList.value.length) return;
    expanded.value = !expanded.value;
}

async function ensureThumb(h: string) {
    if (thumbnails[h] && thumbnails[h].status === 'ready') return;
    const cached = thumbCache.get(h);
    if (cached) {
        thumbnails[h] = cached;
        return;
    }
    if (thumbLoadPromises.has(h)) {
        await thumbLoadPromises.get(h);
        const after = thumbCache.get(h);
        if (after) thumbnails[h] = after;
        return;
    }
    thumbnails[h] = { status: 'loading' };
    const p = (async () => {
        try {
            const blob = await (await import('~/db/files')).getFileBlob(h);
            if (!blob) throw new Error('missing');
            const url = URL.createObjectURL(blob);
            const ready: ThumbState = { status: 'ready', url };
            thumbCache.set(h, ready);
            thumbnails[h] = ready;
        } catch {
            const err: ThumbState = { status: 'error' };
            thumbCache.set(h, err);
            thumbnails[h] = err;
        } finally {
            thumbLoadPromises.delete(h);
        }
    })();
    thumbLoadPromises.set(h, p);
    await p;
}

// Load new hashes when list changes (avoid generic watchEffect re-trigger churn)
watch(
    hashList,
    (list) => {
        for (const h of list) ensureThumb(h);
    },
    { immediate: true }
);

// Cleanup: revoke object URLs only if not cached elsewhere (we keep cache for performance).
// Optional: Could implement LRU eviction later.
onBeforeUnmount(() => {
    // No action: retaining cache avoids flicker if user scrolls away and back.
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
