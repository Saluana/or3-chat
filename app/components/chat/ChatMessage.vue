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
            v-if="props.message.role === 'user' && hashList.length && !expanded"
            class="absolute -top-2 -right-2 border-2 border-[var(--md-inverse-surface)] retro-shadow rounded-[4px] overflow-hidden w-14 h-14 bg-[var(--md-surface-container-lowest)] flex items-center justify-center group"
            @click="toggleExpanded"
            type="button"
            aria-label="Show attachments"
        >
            <template v-if="firstThumb && pdfMeta[firstThumb]">
                <div class="pdf-thumb w-full h-full">
                    <div
                        class="h-full line-clamp-2 flex items-center justify-center text-xs text-black dark:text-white"
                    >
                        {{ pdfDisplayName }}
                    </div>

                    <div class="pdf-thumb__ext" aria-hidden="true">PDF</div>
                </div>
            </template>
            <template
                v-else-if="
                    firstThumb && thumbnails[firstThumb]?.status === 'ready'
                "
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

        <div v-if="!editing" :class="innerClass" ref="contentEl">
            <!-- Retro loader extracted to component -->
            <LoadingGenerating
                v-if="props.message.role === 'assistant' && (props.message as any).pending && !hasContent && !message.reasoning_text"
                class="animate-in"
            />
            <div
                v-if="
                    props.message.role === 'assistant' &&
                    props.message.reasoning_text
                "
            >
                <LazyChatReasoningAccordion
                    hydrate-on-visible
                    :content="props.message.reasoning_text"
                    :streaming="isStreamingReasoning as boolean"
                    :pending="(props.message as any).pending"
                />
            </div>
            <div v-if="hasContent" class="message-body" v-html="rendered"></div>
        </div>
        <!-- Editing surface -->
        <div v-else class="w-full">
            <LazyChatMessageEditor
                hydrate-on-interaction="focus"
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
                <!-- Dynamically registered plugin actions -->
                <template v-for="action in extraActions" :key="action.id">
                    <UTooltip
                        :delay-duration="0"
                        :text="action.tooltip"
                        :teleport="true"
                    >
                        <UButton
                            :icon="action.icon"
                            color="info"
                            size="sm"
                            class="text-black dark:text-white/95 flex items-center justify-center"
                            @click="() => runExtraAction(action)"
                        ></UButton>
                    </UTooltip>
                </template>
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    reactive,
    ref,
    watch,
    onBeforeUnmount,
    nextTick,
    onMounted,
} from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';
import { parseFileHashes } from '~/db/files-util';
import { getFileMeta } from '~/db/files';
import { marked } from 'marked';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { useMessageEditing } from '~/composables/useMessageEditing';

import type { ChatMessage as ChatMessageType } from '~/utils/chat/types';

// Local UI message expects content to be a string (rendered markdown/html)
type UIMessage = Omit<ChatMessageType, 'content'> & {
    content: string;
    pending?: boolean;
    reasoning_text?: string | null;
};

const props = defineProps<{ message: UIMessage; threadId?: string }>();
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'branch', id: string): void;
    (e: 'edited', payload: { id: string; content: string }): void;
}>();

const isStreamingReasoning = computed(() => {
    return props.message.reasoning_text && !hasContent.value;
});

const outerClass = computed(() => ({
    'bg-primary text-white dark:text-black border-2 px-4 border-[var(--md-inverse-surface)] retro-shadow backdrop-blur-sm w-fit self-end ml-auto pb-5':
        props.message.role === 'user',
    'bg-white/5 border-2 border-[var(--md-inverse-surface)] w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none dark:text-white/95 dark:prose-headings:text-white/95! w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-pre:bg-[var(--md-surface-container)]/80 prose-pre:border-2 prose-pre:border-[var(--md-inverse-surface)] prose-pre:text-[var(--md-on-surface)] prose-code:text-[var(--md-on-surface)] prose-code:font-[inherit] prose-pre:font-[inherit] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

// Detect if assistant message currently has any textual content yet
const hasContent = computed(() => {
    const c: any = props.message.content;
    if (typeof c === 'string') return c.trim().length > 0;
    if (Array.isArray(c))
        return c.some((p: any) => p?.type === 'text' && p.text.trim().length);
    return false;
});

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() => {
    const raw = (props.message as any).file_hashes;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') return parseFileHashes(raw);
    return [];
});

// Render markdown/text. For assistant messages keep existing inline images during live stream.
// After reload (no inline imgs) we append placeholders from hashes so hydration can restore.
const rendered = computed(() => {
    const raw = props.message.content || '';
    const parsed = (marked.parse(raw) as string) || '';
    if (props.message.role === 'user') {
        return parsed.replace(/<img\b[^>]*>/gi, '');
    }
    const hasAnyImg = /<img\b/i.test(parsed);
    if (hasAnyImg) return parsed; // live streaming case retains inline imgs
    if (hashList.value.length) {
        const placeholders = hashList.value
            .map(
                (h) =>
                    `<div class=\"my-3\"><img data-file-hash=\"${h}\" alt=\"generated image\" class=\"rounded-md border-2 border-[var(--md-inverse-surface)] retro-shadow max-w-full opacity-60\" loading=\"lazy\" decoding=\"async\" /></div>`
            )
            .join('');
        return parsed + placeholders;
    }
    return parsed;
});

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

// (hashList defined earlier)

// Compact thumb preview support (attachments gallery handles full grid). Reuse global caches.
interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}
const thumbnails = reactive<Record<string, ThumbState>>({});
// PDF meta (name/kind) for hashes that are PDFs so we show placeholder instead of broken image
const pdfMeta = reactive<Record<string, { name?: string; kind: string }>>({});
const safePdfName = computed(() => {
    const h = firstThumb.value;
    if (!h) return 'document.pdf';
    const m = pdfMeta[h];
    return (m && m.name) || 'document.pdf';
});
// Short display (keep extension, truncate middle if long)
const pdfDisplayName = computed(() => {
    const name = safePdfName.value;
    const max = 18;
    if (name.length <= max) return name;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    const base = dot > 0 ? name.slice(0, dot) : name;
    const keep = max - ext.length - 3; // 3 for ellipsis
    if (keep <= 4) return base.slice(0, max - 3) + '...';
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return base.slice(0, head) + '…' + base.slice(base.length - tail) + ext;
});
const thumbCache = ((globalThis as any).__or3ThumbCache ||= new Map<
    string,
    ThumbState
>());
const thumbLoadPromises = ((globalThis as any).__or3ThumbInflight ||= new Map<
    string,
    Promise<void>
>());
// Reference counts per file hash so we can safely revoke object URLs when unused.
const thumbRefCounts = ((globalThis as any).__or3ThumbRefCounts ||= new Map<
    string,
    number
>());

function retainThumb(hash: string) {
    const prev = thumbRefCounts.get(hash) || 0;
    thumbRefCounts.set(hash, prev + 1);
}
function releaseThumb(hash: string) {
    const prev = thumbRefCounts.get(hash) || 0;
    if (prev <= 1) {
        thumbRefCounts.delete(hash);
        const state = thumbCache.get(hash);
        if (state?.url) {
            try {
                URL.revokeObjectURL(state.url);
            } catch {}
        }
        thumbCache.delete(hash);
    } else {
        thumbRefCounts.set(hash, prev - 1);
    }
}

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
    // If we already know it's a PDF just ensure meta exists.
    if (pdfMeta[h]) return;
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
            const [blob, meta] = await Promise.all([
                (await import('~/db/files')).getFileBlob(h),
                getFileMeta(h).catch(() => undefined),
            ]);
            if (meta && meta.kind === 'pdf') {
                pdfMeta[h] = { name: meta.name, kind: meta.kind };
                // Remove the temporary loading state since we won't have an image thumb
                delete thumbnails[h];
                return;
            }
            if (!blob) throw new Error('missing');
            if (blob.type === 'application/pdf') {
                pdfMeta[h] = { name: meta?.name, kind: 'pdf' };
                delete thumbnails[h];
                return;
            }
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

// Track current hashes used by this message for ref counting.
const currentHashes = new Set<string>();
// Load new hashes when list changes with diffing for retain/release.
watch(
    hashList,
    async (list) => {
        const nextSet = new Set(list);
        // Additions
        for (const h of nextSet) {
            if (!currentHashes.has(h)) {
                await ensureThumb(h);
                // Only retain if loaded and ready
                const state = thumbCache.get(h);
                if (state?.status === 'ready') retainThumb(h);
                currentHashes.add(h);
            }
        }
        // Removals
        for (const h of Array.from(currentHashes)) {
            if (!nextSet.has(h)) {
                currentHashes.delete(h);
                releaseThumb(h);
            }
        }
    },
    { immediate: true }
);

// Cleanup: release all thumbs used by this message.
onBeforeUnmount(() => {
    for (const h of currentHashes) releaseThumb(h);
    currentHashes.clear();
});
// Inline image hydration: replace <img data-file-hash> with object URL once ready
const contentEl = ref<HTMLElement | null>(null);
async function hydrateInlineImages() {
    // Only hydrate assistant messages (users have inline images stripped).
    if (props.message.role !== 'assistant') return;
    await nextTick();
    const root = contentEl.value;
    if (!root) return;
    const imgs = root.querySelectorAll(
        'img[data-file-hash]:not([data-hydrated])'
    );
    imgs.forEach((imgEl) => {
        const hash = imgEl.getAttribute('data-file-hash') || '';
        if (!hash) return;
        const state = thumbCache.get(hash) || thumbnails[hash];
        if (state && state.status === 'ready' && state.url) {
            (imgEl as HTMLImageElement).src = state.url;
            imgEl.setAttribute('data-hydrated', 'true');
            imgEl.classList.remove('opacity-60');
        }
    });
}
// Re-run hydration when rendered HTML changes or thumbnails update
watch(rendered, () => hydrateInlineImages());
watch(hashList, () => hydrateInlineImages());
onMounted(() => hydrateInlineImages());

// Mark oversized code blocks (purely cosmetic hook for future styling / fade)
onMounted(() => {
    nextTick(() => {
        const root = contentEl.value;
        if (!root) return;
        root.querySelectorAll('pre').forEach((el) => {
            if (el.scrollHeight > 380) el.classList.add('code-overflow');
        });
    });
});

watch(
    () =>
        Object.keys(thumbnails).map((h) => {
            const t = thumbnails[h]!; // state always initialized before use
            return t.status + ':' + (t.url || '');
        }),
    () => hydrateInlineImages()
);
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

import { forkThread } from '~/db/branching';

// Branch popover state
const branchMode = ref<'reference' | 'copy'>('copy');

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

// Extensible message actions (plugin registered)
// Narrow to expected role subset (exclude potential 'system' etc.)
const extraActions = useMessageActions({
    role: props.message.role as 'user' | 'assistant',
});

async function runExtraAction(action: ChatMessageAction) {
    try {
        await action.handler({
            message: props.message,
            threadId: props.threadId,
        });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        // eslint-disable-next-line no-console
        console.error('Message action error', action.id, e);
    }
}
</script>

<style scoped>
/* Large code block/layout guard */
.message-body pre {
    max-height: 380px;
    overflow: auto;
    position: relative;
    padding: 0.75rem 0.85rem;
    line-height: 1.3;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        'Liberation Mono', 'Courier New', monospace;
}
.message-body pre code {
    white-space: pre;
    word-break: normal;
    font-size: 0.78rem;
    tab-size: 4;
}
.message-body pre::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}
.message-body pre::-webkit-scrollbar-thumb {
    background: var(--md-inverse-surface);
    border-radius: 0;
}
.message-body pre::-webkit-scrollbar-track {
    background: transparent;
}
.message-body :not(pre) > code {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.78rem;
    padding: 2px 4px;
    border: 1px solid var(--md-inverse-surface);
    border-radius: 3px;
    background: var(--md-surface-container-lowest);
}
.message-body pre::after {
    content: '';
    position: sticky;
    left: 0;
    right: 0;
    bottom: 0;
    height: 14px;
    background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0),
        rgba(0, 0, 0, 0.45)
    );
    display: block;
    pointer-events: none;
}
@media (prefers-color-scheme: light) {
    .message-body pre::after {
        background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0),
            rgba(255, 255, 255, 0.85)
        );
    }
}
/* PDF compact thumb */
.pdf-thumb {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    background: linear-gradient(
        180deg,
        var(--md-surface-container-lowest) 0%,
        var(--md-surface-container-low) 100%
    );
    width: 100%;
    height: 100%;
    padding: 2px 2px 3px;
    box-shadow: 0 0 0 1px var(--md-inverse-surface) inset,
        2px 2px 0 0 var(--md-inverse-surface);
    font-family: 'VT323', monospace;
}
.pdf-thumb__icon {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--md-inverse-surface);
    width: 100%;
}
.pdf-thumb__name {
    font-size: 8px;
    line-height: 1.05;
    font-weight: 600;
    text-align: center;
    max-height: 3.2em;
    overflow: hidden;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    margin-top: 1px;
    padding: 0 1px;
    text-shadow: 0 1px 0 #000;
    color: var(--md-inverse-on-surface);
}
.pdf-thumb__ext {
    position: absolute;
    top: 0;
    left: 0;
    background: var(--md-inverse-surface);
    color: var(--md-inverse-on-surface);
    font-size: 7px;
    font-weight: 700;
    padding: 1px 3px;
    letter-spacing: 0.5px;
    box-shadow: 1px 1px 0 0 #000;
}
.pdf-thumb::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 10px;
    height: 10px;
    background: linear-gradient(
        135deg,
        var(--md-surface-container-low) 0%,
        var(--md-surface-container-high) 100%
    );
    clip-path: polygon(0 0, 100% 0, 100% 100%);
    box-shadow: -1px 1px 0 0 var(--md-inverse-surface);
}
</style>
