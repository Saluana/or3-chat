<template>
    <div
        :class="[
            `cm-${roleVariant}`,
            'chat-message-container',
            'group',
            outerClass,
            messageContainerProps?.class || '',
        ]"
        :data-theme-matches="messageContainerProps?.['data-theme-matches']"
        class="p-2 min-w-[140px] rounded-[var(--md-border-radius)] first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <!-- Workflow Message Handling -->
        <WorkflowChatMessage
            v-if="props.message.isWorkflow && workflowsEnabled"
            :message="props.message"
        />

        <!-- Regular Chat Message Handling -->
        <template v-else>
            <!-- Attachments bar (above message content) -->
            <div
                v-if="props.message.role === 'user' && hashList.length"
                class="attachments-bar mb-3"
            >
                <!-- Collapsed: show compact row of thumbnails -->
                <div
                    v-if="!expanded"
                    class="attachments-row flex flex-wrap gap-2.5"
                >
                    <button
                        v-for="(hash, idx) in displayedHashes"
                        :key="hash"
                        type="button"
                        class="attachment-item flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 transition-all cursor-pointer shadow-sm backdrop-blur-sm"
                        @click="toggleExpanded"
                        :aria-label="'View attachment ' + (idx + 1)"
                    >
                        <!-- PDF thumbnail -->
                        <template v-if="pdfMeta[hash]">
                            <div
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-red-500/30 rounded-lg border border-red-400/30"
                            >
                                <span
                                    class="text-[11px] font-bold text-red-200 tracking-wide"
                                    >PDF</span
                                >
                            </div>
                            <div
                                class="attachment-info flex flex-col min-w-0 gap-0.5"
                            >
                                <span
                                    class="attachment-name text-[13px] font-medium truncate max-w-[140px] leading-tight"
                                >
                                    {{ getAttachmentName(hash) }}
                                </span>
                                <span
                                    class="attachment-type text-[11px] opacity-50"
                                    >Document</span
                                >
                            </div>
                        </template>
                        <!-- Image thumbnail -->
                        <template
                            v-else-if="thumbnails[hash]?.status === 'ready'"
                        >
                            <img
                                :src="thumbnails[hash]?.url"
                                :alt="'Attachment ' + (idx + 1)"
                                class="attachment-thumb w-10 h-10 object-cover rounded-lg"
                                draggable="false"
                            />
                            <div
                                class="attachment-info flex flex-col min-w-0 gap-0.5"
                            >
                                <span
                                    class="attachment-name text-[13px] font-medium truncate max-w-[140px] leading-tight"
                                >
                                    Image {{ idx + 1 }}
                                </span>
                                <span
                                    class="attachment-type text-[11px] opacity-50"
                                    >Image</span
                                >
                            </div>
                        </template>
                        <!-- Loading state -->
                        <template
                            v-else-if="thumbnails[hash]?.status === 'loading'"
                        >
                            <div
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-white/10 rounded-lg animate-pulse"
                            >
                                <span class="text-xs opacity-40">···</span>
                            </div>
                            <div
                                class="attachment-info flex flex-col min-w-0 gap-0.5"
                            >
                                <span
                                    class="attachment-name text-[13px] font-medium opacity-40"
                                    >Loading...</span
                                >
                            </div>
                        </template>
                        <!-- Error state -->
                        <template v-else>
                            <div
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-white/10 rounded-lg"
                            >
                                <span class="text-xs opacity-40">?</span>
                            </div>
                            <div
                                class="attachment-info flex flex-col min-w-0 gap-0.5"
                            >
                                <span
                                    class="attachment-name text-[13px] font-medium opacity-40"
                                    >File</span
                                >
                            </div>
                        </template>
                    </button>
                    <!-- Show more indicator if there are hidden attachments -->
                    <button
                        v-if="hashList.length > maxDisplayedThumbs"
                        type="button"
                        class="attachment-more flex items-center justify-center px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 transition-all cursor-pointer text-[13px] font-medium shadow-sm backdrop-blur-sm"
                        @click="toggleExpanded"
                    >
                        +{{ hashList.length - maxDisplayedThumbs }} more
                    </button>
                </div>
            </div>

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
                    v-if="
                        props.message.role === 'assistant' &&
                        props.message.pending &&
                        !hasContent &&
                        !props.message.reasoning_text
                    "
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
                        :pending="props.message.pending === true"
                    />
                </div>

                <!-- Tool Call Indicators -->
                <ChatToolCallIndicator
                    v-if="
                        props.message.role === 'assistant' &&
                        Array.isArray(props.message.toolCalls) &&
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
                        :class="[
                            'whitespace-pre-wrap relative',
                            'cm-text-user',
                        ]"
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
                            {{
                                isUserMessageCollapsed
                                    ? 'Read more'
                                    : 'Show less'
                            }}
                        </button>
                    </div>
                    <StreamMarkdown
                        :key="props.message.id"
                        v-else
                        :content="processedAssistantMarkdown"
                        :shiki-theme="currentShikiTheme"
                        :class="[streamMdClasses, 'cm-markdown-assistant']"
                        :allowed-image-prefixes="['data:image/', 'blob:']"
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
                <div
                    class="cm-editor-actions flex w-full justify-end gap-2 mt-2"
                >
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
                    <UTooltip
                        :delay-duration="500"
                        text="Copy"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="copyButtonProps"
                            @click="copyMessage"
                        ></UButton>
                    </UTooltip>
                    <UTooltip
                        :delay-duration="500"
                        text="Retry"
                        :popper="{ strategy: 'fixed' }"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="retryButtonProps"
                            @click="onRetry"
                        ></UButton>
                    </UTooltip>
                    <UTooltip
                        v-if="showContinueButton"
                        :delay-duration="500"
                        text="Continue"
                        :popper="{ strategy: 'fixed' }"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="continueButtonProps"
                            @click="onContinue"
                        ></UButton>
                    </UTooltip>
                    <UTooltip
                        :delay-duration="500"
                        text="Branch"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="branchButtonProps"
                            @click="onBranch"
                        ></UButton>
                    </UTooltip>
                    <UTooltip
                        :delay-duration="500"
                        text="Edit"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="editButtonProps"
                            @click="wrappedBeginEdit"
                        ></UButton>
                    </UTooltip>
                    <!-- Dynamically registered plugin actions -->
                    <template v-for="action in extraActions" :key="action.id">
                        <UTooltip
                            :delay-duration="500"
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
        </template>
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
import WorkflowChatMessage from './WorkflowChatMessage.vue';
import { useOr3Config } from '~/composables/useOr3Config';
import { parseHashes } from '~/utils/files/attachments';
import { getFileMeta } from '~/db/files';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { shallowRef } from 'vue';
import { useToast } from '#imports';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import type { ChatMessageAction } from '~/composables/chat/useMessageActions';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import { useNuxtApp } from '#app';
import { useRafFn, useClipboard } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import {
    useThumbnailUrlCache,
    type ThumbState,
} from '~/composables/core/useThumbnailUrlCache';

// UI message now exposed as UiChatMessage with .text field
type UIMessage = UiChatMessage & { pre_html?: string };
type MessageWithUiState = UIMessage & { _expanded?: boolean };
const props = defineProps<{ message: MessageWithUiState; threadId?: string }>();
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'continue', id: string): void;
    (e: 'branch', id: string): void;
    (e: 'edited', payload: { id: string; content: string }): void;
    (e: 'begin-edit', id: string): void;
    (e: 'cancel-edit', id: string): void;
    (e: 'save-edit', id: string): void;
}>();

// Feature flag check for workflows
const or3Config = useOr3Config();
const workflowsEnabled = computed(() => or3Config.features.workflows.enabled);

// Theme overrides for message buttons
const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.copy',
        isNuxtUI: true,
    });

    return {
        icon: useIcon('chat.message.copy').value,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...overrides.value,
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
        icon: useIcon('chat.message.retry').value,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...overrides.value,
    };
});

const continueButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.continue',
        isNuxtUI: true,
    });
    const continueIcon =
        useIcon('chat.message.continue').value || 'heroicons:play-20-solid';

    return {
        icon: continueIcon,
        color: 'success' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...overrides.value,
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
        icon: useIcon('chat.message.branch').value,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...overrides.value,
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
        icon: useIcon('chat.message.edit').value,
        color: 'info' as const,
        size: 'sm' as const,
        class: 'text-black dark:text-white/95 flex items-center justify-center',
        ...overrides.value,
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
        ...overrides.value,
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
        ...overrides.value,
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
        ...overrides.value,
    };
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

const showContinueButton = computed(
    () =>
        props.message.role === 'assistant' &&
        Boolean(props.message.error) &&
        (props.message.text?.length ?? 0) > 0
);

const isStreamingReasoning = computed(() => {
    return Boolean(props.message.reasoning_text) && !hasContent.value;
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
    parseHashes(props.message.file_hashes)
);

// Unified markdown already provided via UiChatMessage.text -> transform file-hash placeholders to inert spans
const assistantMarkdown = computed(() =>
    props.message.role === 'assistant' ? props.message.text || '' : ''
);
// Regex to match legacy file-hash image markdown syntax
const FILE_HASH_IMG_RE = /!\[[^\]]*]\(file-hash:([a-f0-9-]{6,})\)/gi;
const processedAssistantMarkdown = computed(() => {
    if (props.message.role !== 'assistant') return '';
    // Transform file-hash: URLs to use a placeholder image with hash in alt attribute
    // This avoids browser console errors from trying to load invalid file-hash: URLs
    // The hydrateInlineImages function will replace these with actual blob URLs
    return assistantMarkdown.value.replace(
        FILE_HASH_IMG_RE,
        (_, hash) => `![file-hash:${hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`
    );
});

// Dynamic Shiki theme: map current theme (light/dark*/light*) to github-light / github-dark
const nuxtApp = useNuxtApp();
const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
const currentShikiTheme = computed(() => {
    const themeObj = themePlugin.value;
    const themeName = themeObj.current?.value ?? themeObj.get();
    return String(themeName).startsWith('dark')
        ? 'github-dark'
        : 'github-light';
});
// Debug watchers removed (can reintroduce with import.meta.dev guards if needed)
// Patch ensureThumb with logs if not already
// NOTE: ensureThumb already defined above; add debug via wrapper pattern not reassignment.
// (Could also inline logs inside original definition; keeping wrapper commented for reference.)
// console.debug('[ChatMessage] debug hook installed for ensureThumb');

// Editing (extracted)
// Wrap message in a shallowRef so if parent swaps the object (stream tail -> finalized),
// editing composable always sees latest.
const messageRef = shallowRef<MessageWithUiState>(props.message);
watch(
    () => props.message,
    (m) => {
        messageRef.value = m;
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
        const rootEl = editorRoot.value;
        const textarea = rootEl?.querySelector('textarea') || null;
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
    const id = props.message.id;
    beginEdit();
    if (editing.value && id) emit('begin-edit', id);
}
function wrappedCancelEdit() {
    const id = props.message.id;
    cancelEdit();
    if (id) emit('cancel-edit', id);
}
async function saveEdit() {
    await internalSaveEdit();
    if (!editing.value) {
        const id = props.message.id;
        if (id) emit('edited', { id, content: draft.value });
        if (id) emit('save-edit', id);
    }
}

// (hashList defined earlier)

// Compact thumb preview support (attachments gallery handles full grid).
type LocalThumbState = ThumbState | { status: 'loading' };
const thumbnails = reactive<Record<string, LocalThumbState>>({});
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

// Maximum number of attachment thumbnails to show in collapsed view
const maxDisplayedThumbs = 4;
const displayedHashes = computed(() =>
    hashList.value.slice(0, maxDisplayedThumbs)
);

// Get display name for an attachment
function getAttachmentName(hash: string): string {
    const meta = pdfMeta[hash];
    if (meta?.name) {
        const name = meta.name;
        const max = 20;
        if (name.length <= max) return name;
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 ? name.slice(dot) : '';
        const base = dot > 0 ? name.slice(0, dot) : name;
        const keep = max - ext.length - 2;
        return base.slice(0, keep) + '…' + ext;
    }
    return 'Document';
}

// Shared thumbnail object URL cache (global singleton with ref-count + grace cleanup)
const thumbUrlCache = useThumbnailUrlCache({ graceMs: 30000 });
const retainThumb = thumbUrlCache.retain;
const releaseThumb = thumbUrlCache.release;

// Per-message persistent UI state stored directly on the message object to
// survive virtualization recycling without external maps.
const expanded = ref<boolean>(props.message._expanded === true);
watch(expanded, (v) => {
    props.message._expanded = v;
});
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
    const cached = thumbUrlCache.get(h);
    if (cached) {
        thumbnails[h] = cached;
        return;
    }
    thumbnails[h] = { status: 'loading' };

    try {
        const state = await thumbUrlCache.ensure(h, async () => {
            const [blob, meta] = await Promise.all([
                (await import('~/db/files')).getFileBlob(h),
                getFileMeta(h).catch(() => undefined),
            ]);

            if (meta && meta.kind === 'pdf') {
                pdfMeta[h] = { name: meta.name, kind: meta.kind };
                return null;
            }
            if (!blob) return null;
            if (blob.type === 'application/pdf') {
                pdfMeta[h] = { name: meta?.name, kind: 'pdf' };
                return null;
            }
            return blob;
        });

        if (state) {
            thumbnails[h] = state;
        } else {
            // PDF or intentionally skipped
            delete thumbnails[h];
        }
    } catch {
        const errState: ThumbState = { status: 'error' };
        thumbnails[h] = errState;
    }
}

// Track current hashes used by this message for ref counting.
const currentHashes = new Set<string>();
let isComponentActive = true;

// Load new hashes when list changes with diffing for retain/release.
watch(
    hashList,
    async (list) => {
        const nextSet = new Set(list);
        // Additions - identify new hashes to load
        const newHashes: string[] = [];
        for (const h of nextSet) {
            if (!currentHashes.has(h)) {
                // Pre-warm local reactive state from global cache immediately to prevent flash
                if (!thumbnails[h]) {
                    const cached = thumbUrlCache.get(h);
                    if (cached) {
                        thumbnails[h] = cached;
                    } else {
                        thumbnails[h] = { status: 'loading' };
                        newHashes.push(h);
                    }
                } else if (thumbnails[h].status === 'loading') {
                    newHashes.push(h);
                }
            }
        }

        // Load all new thumbnails in parallel for faster loading
        if (newHashes.length > 0) {
            await Promise.all(newHashes.map((h) => ensureThumb(h)));
        }

        // Register successfully loaded thumbnails
        for (const h of nextSet) {
            if (!currentHashes.has(h)) {
                const state = thumbUrlCache.get(h);
                if (state?.status === 'ready') {
                    if (!isComponentActive) {
                        retainThumb(h);
                        releaseThumb(h);
                        return;
                    }
                    retainThumb(h);
                    currentHashes.add(h);
                }
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
    isComponentActive = false;
    for (const h of currentHashes) releaseThumb(h);
    currentHashes.clear();
});
// Inline image hydration: replace placeholder <img> src once ready
const contentEl = ref<HTMLElement | null>(null);
async function hydrateInlineImages() {
    // Only hydrate assistant messages (users have inline images stripped).
    if (props.message.role !== 'assistant') return;
    await nextTick();
    const root = contentEl.value;
    if (!root) return;

    // Prefer the new alt-based markers; keep src selectors for backward compatibility
    // with older persisted messages that may still contain invalid src values.
    const images = root.querySelectorAll(
        'img[alt^="file-hash:"], img[src^="file-hash:"], img[src^="blob:file-hash/"]'
    );

    images.forEach((imgEl) => {
        const img = imgEl as HTMLImageElement;
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';

        // handle file-hash:uuid in src (legacy/blob) OR in alt (current)
        let hash = '';
        if (src.startsWith('file-hash:') || src.startsWith('blob:file-hash/')) {
            hash = src.replace(/^.*file-hash[:/]/, '');
        } else if (alt.startsWith('file-hash:')) {
            hash = alt.replace('file-hash:', '');
        }

        // Skip if already hydrated (sometimes src changes but base src attr remains?)
        if (img.dataset.hydrated === 'true') return;

        const state = thumbnails[hash];
        if (state?.status === 'ready' && state.url) {
            img.src = state.url;
            img.dataset.hydrated = 'true';
            img.dataset.fileHash = hash;
            // distinct class for loaded images vs placeholders
            img.classList.remove(
                'or3-img-ph',
                'w-[120px]',
                'h-[120px]',
                'bg-[var(--md-surface-container-lowest)]',
                'opacity-60'
            );
            img.classList.add('retro-inline-image-placeholder', 'inline-block');
        } else if (!img.classList.contains('or3-img-ph')) {
            // Apply placeholder styles while waiting
            img.classList.add(
                'or3-img-ph',
                'retro-inline-image-placeholder',
                'inline-block',
                'w-[120px]',
                'h-[120px]',
                'bg-[var(--md-surface-container-lowest)]',
                'opacity-60'
            );
        }
    });
}
// Consolidated hydration + thumbnail readiness effect with throttling
const rafHydrate = useRafFn(
    async () => {
        // run once per frame, then pause until explicitly resumed
        rafHydrate.pause();
        await hydrateInlineImages();
    },
    { immediate: false }
);

// Throttle hydration checks to avoid excessive re-renders during streaming
let lastHydrateCheck = 0;
const HYDRATE_THROTTLE_MS = 200; // Only check every 200ms during streaming

watchEffect(() => {
    if (props.message.role !== 'assistant') return; // only assistants hydrate

    // Throttle during streaming to reduce CPU load
    const now = Date.now();
    const isPending = props.message.pending === true;
    if (isPending && now - lastHydrateCheck < HYDRATE_THROTTLE_MS) {
        return;
    }
    lastHydrateCheck = now;

    // reactive deps: markdown text, hash list, thumb states
    void assistantMarkdown.value;
    void hashList.value.length;
    void Object.keys(thumbnails)
        .map((h) => {
            const st = thumbnails[h];
            return st?.status === 'ready'
                ? `ready:${st.url ?? ''}`
                : st?.status;
        })
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
        } catch (e: unknown) {
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

const { copy: copyToClipboard } = useClipboard({ legacy: true });

function copyMessage() {
    copyToClipboard(props.message.text || '')
        .then(() => {
            useToast().add({
                title: 'Message copied',
                description:
                    'The message content has been copied to your clipboard.',
                duration: 2000,
            });
        })
        .catch(() => {
            useToast().add({
                title: 'Copy failed',
                description: 'Could not copy message to clipboard.',
                color: 'error',
                duration: 2000,
            });
        });
}

function onRetry() {
    const id = props.message.id;
    if (!id) return;
    emit('retry', id);
}

function onContinue() {
    const id = props.message.id;
    if (!id) return;
    emit('continue', id);
}

import { forkThread } from '~/db/branching';

// Branch popover state
const branchMode = ref<'reference' | 'copy'>('copy');

const branchTitle = ref('');
const branching = ref(false);

async function onBranch() {
    if (branching.value) return;
    branching.value = true;
    const messageId = props.message.id;
    if (!messageId) return;
    try {
        // For assistant messages we now allow direct anchoring (captures assistant content in branch).
        // If "retry" semantics desired, a separate Retry action still uses retryBranch.
        const res = await forkThread({
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
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : 'Error creating branch';
        useToast().add({
            title: 'Branch failed',
            description: message,
            color: 'error',
            duration: 3000,
        });
    } finally {
        branching.value = false;
    }
}

// Extensible message actions (plugin registered)
// Narrow to expected role subset (exclude potential 'system' etc.)
const actionRole: 'user' | 'assistant' =
    props.message.role === 'assistant' ? 'assistant' : 'user';
const extraActions = useMessageActions({
    role: actionRole,
});

async function runExtraAction(action: ChatMessageAction) {
    try {
        await action.handler({
            message: props.message,
            threadId: props.threadId,
        });
    } catch (e: unknown) {
        const description =
            e instanceof Error ? e.message : 'Error running action';
        try {
            useToast().add({
                title: 'Action failed',
                description,
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

/* Attachment bar items */
.attachment-item {
    max-width: 200px;
    min-height: 44px;
}

.attachment-item:hover .attachment-thumb {
    transform: scale(1.02);
}

.attachment-thumb {
    transition: transform 0.15s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.attachment-icon {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.attachment-name {
    color: inherit;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.attachment-type {
    color: inherit;
}

.attachment-more {
    min-height: 44px;
}
</style>
