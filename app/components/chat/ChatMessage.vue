<template>
    <div
        :class="[
            `cm-${roleVariant}`,
            'chat-message-container',
            outerClass,
            messageContainerProps?.class || '',
        ]"
        :data-theme-target="messageContainerProps?.['data-theme-target']"
        :data-theme-matches="messageContainerProps?.['data-theme-matches']"
        :style="{
            paddingRight:
                props.message.role === 'user' && hashList.length && !expanded
                    ? '80px'
                    : '16px',
        }"
        class="p-2 min-w-[140px] rounded-[var(--md-border-radius)] first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <!-- Compact thumb (collapsed state) -->
        <button
            v-if="props.message.role === 'user' && hashList.length && !expanded"
            :class="[
                'attachment-thumb-button absolute -top-2 -right-2 overflow-hidden w-14 h-14 bg-[var(--md-surface-container-lowest)] flex items-center justify-center group',
                attachmentThumbButtonProps?.class || '',
            ]"
            :data-theme-target="
                attachmentThumbButtonProps?.['data-theme-target']
            "
            :data-theme-matches="
                attachmentThumbButtonProps?.['data-theme-matches']
            "
            @click="toggleExpanded"
            type="button"
            aria-label="Show attachments"
        >
            <template v-if="firstThumb && pdfMeta[firstThumb]">
                <div class="pdf-thumb retro-pdf-thumb w-full h-full">
                    <div
                        class="h-full line-clamp-2 flex items-center justify-center text-xs text-black dark:text-white"
                    >
                        {{ pdfDisplayName }}
                    </div>

                    <div
                        class="pdf-thumb__ext retro-pdf-thumb-ext"
                        aria-hidden="true"
                    >
                        PDF
                    </div>
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
                    class="attachment-thumb-image object-cover w-full h-full"
                    draggable="false"
                />
            </template>
            <template
                v-else-if="
                    firstThumb && thumbnails[firstThumb]?.status === 'error'
                "
            >
                <span class="attachment-thumb-error text-[10px] text-error"
                    >err</span
                >
            </template>
            <template v-else>
                <span
                    class="attachment-thumb-loading text-[10px] animate-pulse opacity-70"
                    >…</span
                >
            </template>
            <span
                v-if="hashList.length > 1"
                class="attachment-thumb-count absolute bottom-0 right-0 text-[14px] font-semibold bg-black/70 text-white px-1"
                >+{{ hashList.length - 1 }}</span
            >
        </button>

        <div
            v-if="!editing"
            :class="[
                'loading-wrapper',
                `cm-content-${roleVariant}`,
                innerClass,
            ]"
            ref="contentEl"
        >
            <!-- Retro loader extracted to component -->
            <LoadingGenerating
                v-if="props.message.role === 'assistant' && (props.message as any).pending && !hasContent && !message.reasoning_text"
                class="loading-generating animate-in"
            />
            <div
                class="reasoning-accordion-wrapper"
                v-if="
                    props.message.role === 'assistant' &&
                    props.message.reasoning_text
                "
            >
                <LazyChatReasoningAccordion
                    class="reasoning-accordion"
                    hydrate-on-visible
                    :content="props.message.reasoning_text"
                    :streaming="isStreamingReasoning as boolean"
                    :pending="(props.message as any).pending"
                />
            </div>

            <!-- Tool Call Indicators -->
            <ChatToolCallIndicator
                v-if="
                    props.message.role === 'assistant' &&
                    props.message.toolCalls &&
                    props.message.toolCalls.length > 0
                "
                :tool-calls="props.message.toolCalls"
            />

            <div
                v-if="hasContent"
                :class="[
                    'message-body min-w-0 max-w-full overflow-x-hidden',
                    `cm-body-${roleVariant}`,
                ]"
            >
                <div
                    v-if="props.message.role === 'user'"
                    :class="['whitespace-pre-wrap relative', 'cm-text-user']"
                >
                    <div
                        :class="{
                            'line-clamp-6 overflow-hidden':
                                isUserMessageCollapsed && shouldCollapse,
                        }"
                    >
                        {{ props.message.text }}
                    </div>
                    <button
                        v-if="shouldCollapse"
                        @click="toggleUserMessage"
                        class="mt-2 text-sm underline hover:no-underline opacity-80 hover:opacity-100 transition-opacity"
                    >
                        {{ isUserMessageCollapsed ? 'Read more' : 'Show less' }}
                    </button>
                </div>
                <StreamMarkdown
                    :key="props.message.id"
                    v-else
                    :content="processedAssistantMarkdown"
                    :shiki-theme="currentShikiTheme"
                    :class="[streamMdClasses, 'cm-markdown-assistant']"
                    :allowed-image-prefixes="['data:image/']"
                    code-block-show-line-numbers
                    class="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0 prose-headings:first:mt-5!"
                />
                <!-- legacy rendered html path removed -->
            </div>
        </div>
        <!-- Editing surface -->
        <div
            v-else
            :class="['w-full', `cm-editor-${roleVariant}`]"
            ref="editorRoot"
        >
            <LazyChatMessageEditor
                hydrate-on-interaction="focus"
                v-model="draft"
                :autofocus="true"
                :focus-delay="120"
            />
            <div class="cm-editor-actions flex w-full justify-end gap-2 mt-2">
                <UButton
                    v-bind="saveEditButtonProps"
                    @click="saveEdit"
                    :loading="saving"
                    >Save</UButton
                >
                <UButton
                    v-bind="cancelEditButtonProps"
                    @click="wrappedCancelEdit"
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
            :class="[
                'absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap',
                `cm-actions-${roleVariant}`,
            ]"
        >
            <UButtonGroup
                class="bg-[var(--md-surface)] rounded-[var(--md-border-radius)] cm-action-group"
            >
                <UTooltip :delay-duration="0" text="Copy" :teleport="true">
                    <UButton
                        v-bind="copyButtonProps"
                        @click="copyMessage"
                    ></UButton>
                </UTooltip>
                <UTooltip
                    :delay-duration="0"
                    text="Retry"
                    :popper="{ strategy: 'fixed' }"
                    :teleport="true"
                >
                    <UButton
                        v-bind="retryButtonProps"
                        @click="onRetry"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Branch" :teleport="true">
                    <UButton
                        v-bind="branchButtonProps"
                        @click="onBranch"
                    ></UButton>
                </UTooltip>
                <UTooltip :delay-duration="0" text="Edit" :teleport="true">
                    <UButton
                        v-bind="editButtonProps"
                        @click="wrappedBeginEdit"
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
                            v-bind="pluginActionButtonProps"
                            :icon="action.icon"
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
    watchEffect,
} from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';
import { parseHashes } from '~/utils/files/attachments';
import { getFileMeta } from '~/db/files';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { shallowRef } from 'vue';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import { useNuxtApp } from '#app';
import { useRafFn } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';

// UI message now exposed as UiChatMessage with .text field
type UIMessage = UiChatMessage & { pre_html?: string };
const props = defineProps<{ message: UIMessage; threadId?: string }>();
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'branch', id: string): void;
    (e: 'edited', payload: { id: string; content: string }): void;
    (e: 'begin-edit', id: string): void;
    (e: 'cancel-edit', id: string): void;
    (e: 'save-edit', id: string): void;
}>();

// Theme overrides for message buttons
const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.copy',
        isNuxtUI: true,
    });

    return {
        icon: 'pixelarticons:copy' as const,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...(overrides.value as any),
    };
});

const retryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.retry',
        isNuxtUI: true,
    });

    return {
        icon: 'pixelarticons:reload' as const,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...(overrides.value as any),
    };
});

const branchButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.branch',
        isNuxtUI: true,
    });

    return {
        icon: 'pixelarticons:git-branch' as const,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...(overrides.value as any),
    };
});

const editButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.edit',
        isNuxtUI: true,
    });

    return {
        icon: 'pixelarticons:edit-box' as const,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...(overrides.value as any),
    };
});

const pluginActionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.plugin-action',
        isNuxtUI: true,
    });

    return {
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...(overrides.value as any),
    };
});

const saveEditButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.save-edit',
        isNuxtUI: true,
    });

    return {
        size: 'sm' as const,
        color: 'success' as const,
        class: 'theme-btn',
        ...(overrides.value as any),
    };
});

const cancelEditButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.cancel-edit',
        isNuxtUI: true,
    });

    return {
        size: 'sm' as const,
        color: 'error' as const,
        class: 'theme-btn',
        ...(overrides.value as any),
    };
});

const attachmentThumbButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.attachment-thumb',
        isNuxtUI: false,
    });

    return overrides.value;
});

const messageContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'message',
        identifier:
            props.message.role === 'user'
                ? 'message.user-container'
                : 'message.assistant-container',
        isNuxtUI: false,
    });

    return overrides.value;
});

const roleVariant = computed<'user' | 'assistant'>(() =>
    props.message.role === 'user' ? 'user' : 'assistant'
);

const isStreamingReasoning = computed(() => {
    return props.message.reasoning_text && !hasContent.value;
});

// User message collapse/expand
const isUserMessageCollapsed = ref(true);
const shouldCollapse = computed(() => {
    if (props.message.role !== 'user') return false;
    const lines = (props.message.text || '').split('\n').length;
    return lines > 6;
});

function toggleUserMessage() {
    isUserMessageCollapsed.value = !isUserMessageCollapsed.value;
}

const outerClass = computed(() => ({
    'bg-primary text-white dark:text-white/95 retro-message-user px-4 backdrop-blur-sm w-fit self-end ml-auto pb-5 min-w-0':
        props.message.role === 'user',
    'bg-white/5 retro-message-assistant w-full backdrop-blur-sm min-w-0':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    // Added Tailwind Typography per-element utilities for tables (no custom CSS)
    'prose max-w-none dark:text-white/95 dark:prose-headings:text-white/95! w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-pre:bg-[var(--md-surface-container)]/80 prose-pre:border-[var(--md-border-width)] prose-pre:border-[color:var(--md-border-color)] prose-pre:text-[var(--md-on-surface)] prose-code:text-[var(--md-on-surface)] prose-code:font-[inherit] prose-pre:font-[inherit] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5 prose-':
        props.message.role === 'assistant',
}));

// Detect if assistant message currently has any textual content yet
const hasContent = computed(() => (props.message.text || '').trim().length > 0);

// Extract hash list (serialized JSON string or array already?)
const hashList = computed<string[]>(() =>
    parseHashes((props.message as any).file_hashes)
);

// Unified markdown already provided via UiChatMessage.text -> transform file-hash placeholders to inert spans
const assistantMarkdown = computed(() =>
    props.message.role === 'assistant' ? props.message.text || '' : ''
);
const FILE_HASH_IMG_RE = /!\[[^\]]*]\(file-hash:([a-f0-9]{6,})\)/gi;
const processedAssistantMarkdown = computed(() => {
    if (props.message.role !== 'assistant') return '';
    return (assistantMarkdown.value || '').replace(
        FILE_HASH_IMG_RE,
        (_m, h) =>
            `<span class=\"or3-img-ph retro-inline-image-placeholder inline-block w-[120px] h-[120px] bg-[var(--md-surface-container-lowest)] opacity-60\" data-file-hash=\"${h}\" aria-label=\"generated image\"></span>`
    );
});

// Dynamic Shiki theme: map current theme (light/dark*/light*) to github-light / github-dark
const nuxtApp = useNuxtApp() as any;
const currentShikiTheme = computed(() => {
    const themeObj = nuxtApp?.$theme;
    let t: any = 'light';
    if (themeObj) {
        if (themeObj.current && 'value' in themeObj.current)
            t = themeObj.current.value;
        else if (typeof themeObj.get === 'function') t = themeObj.get();
    }
    return String(t).startsWith('dark') ? 'github-dark' : 'github-light';
});
// Debug watchers removed (can reintroduce with import.meta.dev guards if needed)
// Patch ensureThumb with logs if not already
// NOTE: ensureThumb already defined above; add debug via wrapper pattern not reassignment.
// (Could also inline logs inside original definition; keeping wrapper commented for reference.)
// console.debug('[ChatMessage] debug hook installed for ensureThumb');

// Editing (extracted)
// Wrap message in a shallowRef so if parent swaps the object (stream tail -> finalized),
// editing composable always sees latest.
const messageRef = shallowRef(props.message as any);
watch(
    () => props.message,
    (m) => {
        messageRef.value = m as any;
    }
);
const {
    editing,
    draft,
    saving,
    beginEdit,
    cancelEdit,
    saveEdit: internalSaveEdit,
} = useMessageEditing(messageRef);
// Ensure focus cursor moves to end when entering edit mode (including for tail assistant post-stream)
const editorRoot = ref<HTMLElement | null>(null);
const IS_IOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent || '');
function focusEditorAtEnd() {
    let tries = 0;
    const maxTries = 25; // allow up to ~1.5s (25 * 60ms) for lazy editor mount on iOS
    const attempt = () => {
        const rootEl: any = editorRoot.value || null;
        let textarea: HTMLTextAreaElement | null = null;
        if (rootEl) {
            textarea = rootEl.querySelector('textarea');
            if (!textarea && rootEl.$el) {
                textarea = rootEl.$el.querySelector?.('textarea') || null;
            }
        }
        if (textarea) {
            try {
                // iOS sometimes needs scroll into view before focus sticks
                if (IS_IOS) textarea.scrollIntoView?.({ block: 'center' });
                textarea.focus();
                const setSel = () => {
                    try {
                        const len = textarea!.value.length;
                        textarea!.setSelectionRange(len, len);
                    } catch {}
                };
                // Use both rAF and timeout to satisfy iOS timing quirks
                requestAnimationFrame(setSel);
                setTimeout(setSel, 0);
            } catch {}
        } else if (tries++ < maxTries) {
            setTimeout(attempt, IS_IOS ? 60 : 40);
        }
    };
    attempt();
}
watch(
    () => editing.value,
    (v) => {
        if (v) {
            // nextTick not strictly needed due to retry loop, but helps initial timing
            nextTick(() => focusEditorAtEnd());
        }
    }
);
// Wrap begin/cancel/save to emit lifecycle events for container scroll suppression
function wrappedBeginEdit() {
    const id = (props.message as any).id;
    beginEdit();
    if (editing.value && id) emit('begin-edit', id);
}
function wrappedCancelEdit() {
    const id = (props.message as any).id;
    cancelEdit();
    if (id) emit('cancel-edit', id);
}
async function saveEdit() {
    await internalSaveEdit();
    if (!editing.value) {
        const id = (props.message as any).id;
        if (id) emit('edited', { id, content: draft.value });
        if (id) emit('save-edit', id);
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
    if (pdfMeta[h]) {
        return;
    }
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
// Inline image hydration: replace <span data-file-hash> markers with <img> once ready
const contentEl = ref<HTMLElement | null>(null);
async function hydrateInlineImages() {
    // Only hydrate assistant messages (users have inline images stripped).
    if (props.message.role !== 'assistant') return;
    await nextTick();
    const root = contentEl.value;
    if (!root) return;
    const spans = root.querySelectorAll(
        'span.or3-img-ph[data-file-hash]:not([data-hydrated])'
    );
    spans.forEach((span) => {
        const hash = span.getAttribute('data-file-hash') || '';
        if (!hash) return;
        const state = thumbCache.get(hash) || thumbnails[hash];
        if (state && state.status === 'ready' && state.url) {
            const img = document.createElement('img');
            img.setAttribute('data-file-hash', hash);
            img.setAttribute('data-hydrated', 'true');
            img.src = state.url;
            img.alt = 'generated image';
            img.className = span.className.replace('opacity-60', '');
            span.replaceWith(img);
        }
    });
}
// Consolidated hydration + thumbnail readiness effect
const rafHydrate = useRafFn(
    async () => {
        // run once per frame, then pause until explicitly resumed
        rafHydrate.pause();
        await hydrateInlineImages();
    },
    { immediate: false }
);
watchEffect(() => {
    if (props.message.role !== 'assistant') return; // only assistants hydrate
    // reactive deps: markdown text, hash list, thumb states
    void assistantMarkdown.value;
    void hashList.value.length;
    void Object.keys(thumbnails)
        .map((h) => thumbnails[h]?.status + (thumbnails[h]?.url || ''))
        .join('|');
    rafHydrate.resume();
});

// Detect if message has math or code content
const hasMathContent = computed(() => {
    const text = props.message.text || '';
    return /\$\$[\s\S]*?\$\$|\$[^\$\n]+\$/.test(text);
});
const hasCodeContent = computed(() => {
    const text = props.message.text || '';
    return /```[\s\S]*?```|`[^`\n]+`/.test(text);
});

// Load KaTeX CSS during idle time only if message has math
const loadKaTeXOnIdle = () => {
    if (!hasMathContent.value) return; // Skip if no math
    const idleLoader = (callback: () => void) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 2000 }); // Fallback after 2s
        } else {
            setTimeout(callback, 0); // Polyfill for older browsers
        }
    };
    idleLoader(() => {
        import('katex/dist/katex.min.css').catch((e) => {
            if (import.meta.dev)
                console.warn('[ChatMessage] KaTeX CSS load error:', e);
        });
    });
};

// Load Shiki highlighter during idle time only if message has code
const loadShikiOnIdle = () => {
    if (props.message.role !== 'assistant' || !hasCodeContent.value) return;
    const idleLoader = (callback: () => void) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 2000 });
        } else {
            setTimeout(callback, 0);
        }
    };
    idleLoader(() => {
        try {
            useShikiHighlighter();
        } catch (e) {
            if (import.meta.dev)
                console.warn('[ChatMessage] Shiki load error:', e);
        }
    });
};

onMounted(() => {
    rafHydrate.resume();
    loadKaTeXOnIdle();
    loadShikiOnIdle();
});

// Thumbnail status watcher removed (covered by consolidated watchEffect)
import { useToast } from '#imports';
function copyMessage() {
    navigator.clipboard.writeText(props.message.text || '');

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

// Classes applied to <StreamMarkdown> (joined string for TS friendliness)
const streamMdClasses = [
    'w-full min-w-full prose prose-pre:font-mono or3-prose prose-pre:max-w-full prose-pre:overflow-x-auto',
].join(' ');
</script>

<style scoped>
@import '~/assets/css/or3-prose.css';

.line-clamp-6 {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6; /* standard property for compatibility */
    -webkit-box-orient: vertical;
    overflow: hidden;
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
}
</style>
