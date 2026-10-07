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
        class="p-2 min-w-[140px] max-w-full rounded-[var(--md-border-radius)] first:mt-3 first:mb-6 not-first:my-6 relative"
    >
        <component
            :is="customMessageRenderer"
            v-if="customMessageRenderer"
            :message="props.message"
            :thread-id="props.threadId"
            :retrieval-available="props.historyRetrievalAvailable"
            @view-compaction-source="emit('view-compaction-source', $event)"
            @content-resize="emit('content-resize')"
            @view-related-thread="emit('view-related-thread', $event)"
        />

        <section v-else-if="props.message.isWorkflow" class="space-y-2" aria-label="Workflow run">
            <div class="font-medium">{{ props.message.workflowState?.workflowName || 'Workflow' }}</div>
            <p class="text-sm opacity-70">
                Status: {{ props.message.workflowState?.executionState || 'unavailable' }}
            </p>
            <p v-if="props.message.workflowState?.prompt" class="text-sm whitespace-pre-wrap break-words">
                Prompt: {{ props.message.workflowState.prompt }}
            </p>
            <p v-if="workflowFallbackError" class="text-sm text-red-600 whitespace-pre-wrap break-words" role="alert">
                {{ workflowFallbackError }}
            </p>
            <p v-if="props.message.workflowState?.finalOutput" class="whitespace-pre-wrap break-words">
                {{ props.message.workflowState.finalOutput }}
            </p>
            <p v-else class="text-sm opacity-70">Open Workflows to view run details.</p>
        </section>

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
                        class="attachment-item flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-white/10 hover:bg-white/15 active:bg-white/20 transition-all cursor-pointer shadow-sm backdrop-blur-sm"
                        @click="toggleExpanded"
                        :aria-label="'View attachment ' + (idx + 1)"
                    >
                        <!-- PDF thumbnail -->
                        <template v-if="pdfMeta[hash]">
                            <div
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-red-500/30 rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] border-red-400/30"
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
                                :data-file-hash="hash"
                                :width="thumbnails[hash]?.width"
                                :height="thumbnails[hash]?.height"
                                :style="
                                    thumbnails[hash]?.width &&
                                    thumbnails[hash]?.height
                                        ? {
                                              aspectRatio: `${thumbnails[hash]?.width} / ${thumbnails[hash]?.height}`,
                                          }
                                        : undefined
                                "
                                :alt="'Attachment ' + (idx + 1)"
                                class="attachment-thumb w-10 h-10 object-cover rounded-[var(--md-border-radius-small,var(--md-border-radius))]"
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
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-white/10 rounded-[var(--md-border-radius-small,var(--md-border-radius))] animate-pulse"
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
                                class="attachment-icon w-10 h-10 flex items-center justify-center bg-white/10 rounded-[var(--md-border-radius-small,var(--md-border-radius))]"
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
                        class="attachment-more flex items-center justify-center px-4 py-1.5 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-white/10 hover:bg-white/15 active:bg-white/20 transition-all cursor-pointer text-[13px] font-medium shadow-sm backdrop-blur-sm"
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
                <p
                    v-if="responseError"
                    role="alert"
                    aria-label="Response failed"
                    class="mb-3 text-sm text-error whitespace-pre-wrap wrap-anywhere"
                >
                    {{ responseError }}
                </p>
                <p v-else-if="responseStopped" role="status" class="mb-3 text-sm opacity-70">
                    Response stopped. You can retry or continue the conversation.
                </p>
                <!-- Retro loader extracted to component -->
                <LoadingGenerating
                    v-if="
                        props.message.role === 'assistant' &&
                        props.message.pending &&
                        !hasContent &&
                        !hasOrderedAssistantParts &&
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
                    <ReasoningAccordion
                        class="reasoning-accordion"
                        :content="props.message.reasoning_text"
                        :streaming="isStreamingReasoning as boolean"
                        :pending="props.message.pending === true"
                    />
                </div>

                <!-- Tool Call Indicators -->
                <ChatToolCallIndicator
                    v-if="
                        props.message.role === 'assistant' &&
                        !hasOrderedAssistantParts &&
                        Array.isArray(props.message.toolCalls) &&
                        props.message.toolCalls.length > 0
                    "
                    :tool-calls="props.message.toolCalls"
                    @resize="emit('content-resize')"
                />

                <div
                    v-if="hasContent || hasOrderedAssistantParts"
                    :class="[
                        'message-body min-w-0 max-w-full overflow-x-hidden',
                        `cm-body-${roleVariant}`,
                    ]"
                >
                    <div
                        v-if="props.message.role === 'user'"
                        :class="[
                            'whitespace-pre-wrap wrap-anywhere max-w-full relative',
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
                    <template v-else-if="hasOrderedAssistantParts">
                        <template
                            v-for="part in orderedAssistantBlocks"
                            :key="part.id"
                        >
                            <StreamMarkdown
                                v-if="part.type === 'text'"
                                :content="processAssistantMarkdown(part.text)"
                                :shiki-theme="currentShikiTheme"
                                :class="[
                                    streamMdClasses,
                                    'cm-markdown-assistant',
                                ]"
                                :allowed-image-prefixes="[
                                    'data:image/',
                                    'blob:',
                                ]"
                                :parse-incomplete-markdown="
                                    props.message.pending === true &&
                                    part.id === lastOrderedTextPartId
                                "
                                code-block-show-line-numbers
                                class="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0 prose-headings:first:mt-5!"
                            />
                            <ChatToolCallIndicator
                                v-else
                                :tool-calls="part.toolCalls"
                                @resize="emit('content-resize')"
                            />
                        </template>
                    </template>
                    <StreamMarkdown
                        :key="props.message.id"
                        v-else
                        :content="processedAssistantMarkdown"
                        :shiki-theme="currentShikiTheme"
                        :class="[streamMdClasses, 'cm-markdown-assistant']"
                        :allowed-image-prefixes="['data:image/', 'blob:']"
                        :parse-incomplete-markdown="
                            props.message.pending === true
                        "
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

            <!-- Desktop actions overlap the border; narrow panes keep them in flow. -->
            <div
                v-if="!editing && interactive"
                :class="[
                    'cm-actions flex z-10',
                    `cm-actions-${roleVariant}`,
                ]"
            >
                <UFieldGroup
                    class="bg-(--md-surface) rounded-[var(--md-border-radius-small,var(--md-border-radius))] cm-action-group"
                >
                    <UTooltip
                        :delay-duration="500"
                        text="Copy"
                        :teleport="true"
                    >
                        <UButton
                            v-bind="copyButtonProps"
                            aria-label="Copy message"
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
                            aria-label="Retry message"
                            :disabled="props.retryDisabled"
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
                            aria-label="Continue generation"
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
                            aria-label="Branch conversation"
                            :disabled="props.message.pending === true || branching"
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
                            aria-label="Edit message"
                            @click="wrappedBeginEdit"
                        ></UButton>
                    </UTooltip>
                    <!-- Dynamically registered plugin actions -->
                    <template v-for="action in extraActions" :key="action.id">
                        <UTooltip
                            :delay-duration="500"
                            :text="action.disabledReason?.(messageActionContext()) || action.tooltip"
                            :teleport="true"
                        >
                            <UButton
                                v-bind="pluginActionButtonProps"
                                :icon="action.icon"
                                :aria-label="action.tooltip || action.id"
                                :disabled="action.disabled?.(messageActionContext())"
                                @click="() => runExtraAction(action)"
                            ></UButton>
                        </UTooltip>
                    </template>
                </UFieldGroup>
            </div>
        </template>
        <ThreadChildLinks v-if="props.message.id && !props.message.pending" :thread-id="props.threadId" :message-id="props.message.id" :tool-result-message-ids="props.message.toolResultMessageIds"
            @navigate="emit('view-related-thread', $event)" />
    </div>
</template>

<script setup lang="ts">
import ThreadChildLinks from './ThreadChildLinks.vue';
import {
    computed,
    ref,
    watch,
    nextTick,
    onMounted,
} from 'vue';
import LoadingGenerating from './LoadingGenerating.vue';
import MessageAttachmentsGallery from './MessageAttachmentsGallery.vue';
import { shallowRef } from 'vue';
import { useToast } from '#imports';
import { presentError } from '~~/shared/errors';
import { getWorkspaceGeneration } from '~/db/client';
import type {
    ToolCallInfo,
    UiChatMessage,
    UiChatMessagePart,
} from '~/utils/chat/uiMessages';
import type { ChatMessageAction } from '~/composables/chat/useMessageActions';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import ReasoningAccordion from './ReasoningAccordion.vue';
import { useRafFn, useClipboard } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useMessageThumbnails } from '~/composables/chat/useMessageThumbnails';
import {
    processAssistantMarkdown,
    useMessageMarkdown,
} from '~/composables/chat/useMessageMarkdown';
import { useMessageEditing } from '~/composables/chat/useMessageEditing';
import { useMessageActions } from '~/composables/chat/useMessageActions';
import { resolveMessageRenderer } from '~/composables/chat/message-renderers';

// UI message now exposed as UiChatMessage with .text field
type UIMessage = UiChatMessage & { pre_html?: string };
type MessageWithUiState = UIMessage & { _expanded?: boolean };
const props = withDefaults(
    defineProps<{
        message: MessageWithUiState;
        threadId?: string;
        interactive?: boolean;
        retryDisabled?: boolean;
        compactionAction?: { start: (anchorMessageId?: string) => Promise<void>; blockedReason?: string };
        historyRetrievalAvailable?: boolean;
    }>(),
    { interactive: true },
);
const toast = useToast();
const responseStopped = computed(() => props.message.role === 'assistant' && !props.message.pending &&
    ['stopped', 'Background response aborted', 'aborted'].includes(props.message.error ?? ''));
const responseError = computed(() => props.message.role === 'assistant' && !props.message.pending &&
    props.message.error && !responseStopped.value
    ? presentError(props.message.errorEnvelope ?? props.message.error, { code: 'ERR_STREAM_FAILURE' }).message : null);
const customMessageRenderer = computed(
    () => resolveMessageRenderer(props.message)?.component ?? null
);
const workflowFallbackError = computed(() =>
    Object.values(props.message.workflowState?.nodeStates ?? {})
        .find((node) => node.status === 'error' && node.error)?.error ?? null
);
const emit = defineEmits<{
    (e: 'retry', id: string): void;
    (e: 'continue', id: string): void;
    (e: 'branch', id: string, source?: { originThreadId: string; anchorMessageId: string; generation: number }): void;
    (e: 'edited', payload: { id: string; content: string }): void;
    (e: 'begin-edit', id: string): void;
    (e: 'cancel-edit', id: string): void;
    (e: 'save-edit', id: string): void;
    (e: 'content-resize'): void;
    (e: 'view-compaction-source', target: { threadId: string; messageId: string; originThreadId: string; scrollMessageId?: string }): void;
    (e: 'view-related-thread', target: { threadId: string; originThreadId: string; anchorMessageId: string; generation: number }): void;
}>();

const copyIcon = useIcon('chat.message.copy');
const retryIcon = useIcon('chat.message.retry');
const continueIcon = useIcon('chat.message.continue');
const branchIcon = useIcon('chat.message.branch');
const editIcon = useIcon('chat.message.edit');

const copyButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.copy',
    isNuxtUI: true,
});
const retryButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.retry',
    isNuxtUI: true,
});
const continueButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.continue',
    isNuxtUI: true,
});
const branchButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.branch',
    isNuxtUI: true,
});
const editButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.edit',
    isNuxtUI: true,
});
const pluginActionButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.plugin-action',
    isNuxtUI: true,
});
const saveEditButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.save-edit',
    isNuxtUI: true,
});
const cancelEditButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'message',
    identifier: 'message.cancel-edit',
    isNuxtUI: true,
});
const messageContainerOverrides = useThemeOverrides(
    computed(() => ({
        component: 'div',
        context: 'message',
        identifier:
            props.message.role === 'user'
                ? 'message.user-container'
                : 'message.assistant-container',
        isNuxtUI: false,
    }))
);

// Theme overrides for message buttons
const copyButtonProps = computed(() => ({
    icon: copyIcon.value,
    color: 'info' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...copyButtonOverrides.value,
}));

const retryButtonProps = computed(() => ({
    icon: retryIcon.value,
    color: 'info' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...retryButtonOverrides.value,
}));

const continueButtonProps = computed(() => ({
    icon: continueIcon.value || 'heroicons:play-20-solid',
    color: 'success' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...continueButtonOverrides.value,
}));

const branchButtonProps = computed(() => ({
    icon: branchIcon.value,
    color: 'info' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...branchButtonOverrides.value,
}));

const editButtonProps = computed(() => ({
    icon: editIcon.value,
    color: 'info' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...editButtonOverrides.value,
}));

const pluginActionButtonProps = computed(() => ({
    color: 'info' as const,
    size: 'sm' as const,
    class: 'text-black dark:text-white/95 flex items-center justify-center',
    ...pluginActionButtonOverrides.value,
}));

const saveEditButtonProps = computed(() => ({
    size: 'sm' as const,
    color: 'success' as const,
    class: 'theme-btn',
    ...saveEditButtonOverrides.value,
}));

const cancelEditButtonProps = computed(() => ({
    size: 'sm' as const,
    color: 'error' as const,
    class: 'theme-btn',
    ...cancelEditButtonOverrides.value,
}));

const messageContainerProps = computed(() => messageContainerOverrides.value);

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
    'bg-primary text-white dark:text-white/95 retro-message-user px-4 backdrop-blur-sm w-fit max-w-full self-end ml-auto pb-5 min-w-0':
        props.message.role === 'user',
    'bg-white/5 retro-message-assistant w-full backdrop-blur-sm min-w-0':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    // Added Tailwind Typography per-element utilities for tables (no custom CSS)
    'prose max-w-none dark:text-white/95 dark:prose-headings:text-white/95! w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-pre:bg-[var(--md-surface-container)]/80 prose-pre:border-[length:var(--md-border-width-subtle,var(--md-border-width))] prose-pre:border-[color:var(--md-border-color)] prose-pre:text-[var(--md-on-surface)] prose-code:text-[var(--md-on-surface)] prose-code:font-[inherit] prose-pre:font-[inherit] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5 prose-':
        props.message.role === 'assistant',
}));

// Detect if assistant message currently has any textual content yet
const hasContent = computed(() => (props.message.text || '').trim().length > 0);
const orderedAssistantParts = computed(() =>
    props.message.role === 'assistant' && Array.isArray(props.message.parts)
        ? props.message.parts
        : []
);
type OrderedAssistantBlock =
    | Extract<UiChatMessagePart, { type: 'text' }>
    | {
          id: string;
          type: 'tools';
          toolCalls: ToolCallInfo[];
      };
const orderedAssistantBlocks = computed<OrderedAssistantBlock[]>(() => {
    const blocks: OrderedAssistantBlock[] = [];
    for (const part of orderedAssistantParts.value) {
        if (part.type === 'text') {
            blocks.push(part);
            continue;
        }
        const previous = blocks.at(-1);
        if (previous?.type === 'tools') {
            previous.toolCalls.push(part.toolCall);
            continue;
        }
        blocks.push({
            id: `${part.id}:group`,
            type: 'tools',
            toolCalls: [part.toolCall],
        });
    }
    return blocks;
});
const hasOrderedAssistantParts = computed(
    () => orderedAssistantParts.value.length > 0
);
const lastOrderedTextPartId = computed(
    () =>
        [...orderedAssistantParts.value]
            .reverse()
            .find((part) => part.type === 'text')?.id
);

const messageThumbRef = computed(() => props.message);
const {
    hashList,
    thumbnails,
    pdfMeta,
    maxDisplayedThumbs,
    displayedHashes,
    getAttachmentName,
    expanded,
    toggleExpanded,
} = useMessageThumbnails(messageThumbRef);

const { assistantMarkdown, processedAssistantMarkdown, currentShikiTheme } =
    useMessageMarkdown(computed(() => props.message));
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
            if (state.width && state.height) {
                img.width = state.width;
                img.height = state.height;
                img.style.aspectRatio = `${state.width} / ${state.height}`;
            }
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
const thumbnailSignature = computed(() =>
    hashList.value
        .map((hash) => {
            const state = thumbnails[hash];
            return state?.status === 'ready'
                ? `${hash}:ready:${state.url ?? ''}`
                : `${hash}:${state?.status ?? 'missing'}`;
        })
        .join('|')
);

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

watch(
    [
        assistantMarkdown,
        () => props.message.role,
        () => props.message.pending,
        thumbnailSignature,
    ],
    () => {
        if (props.message.role !== 'assistant') return;

        const now = Date.now();
        const isPending = props.message.pending === true;
        if (isPending && now - lastHydrateCheck < HYDRATE_THROTTLE_MS) {
            return;
        }
        lastHydrateCheck = now;
        rafHydrate.resume();
    },
    { immediate: true }
);

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
            toast.add({
                title: 'Message copied',
                description:
                    'The message content has been copied to your clipboard.',
                duration: 2000,
            });
        })
        .catch(() => {
            toast.add({
                title: 'Copy failed',
                description: 'Could not copy message to clipboard.',
                color: 'error',
                duration: 2000,
            });
        });
}

function onRetry() {
    if (props.retryDisabled) return;
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
    if (branching.value || props.message.pending) return;
    branching.value = true;
    const messageId = props.message.id;
    const originThreadId = props.threadId || '';
    const generation = getWorkspaceGeneration();
    if (!messageId) { branching.value = false; return; }
    try {
        // For assistant messages we now allow direct anchoring (captures assistant content in branch).
        // If "retry" semantics desired, a separate Retry action still uses retryBranch.
        const res = await forkThread({
            sourceThreadId: originThreadId,
            anchorMessageId: messageId,
            mode: branchMode.value,
            titleOverride: branchTitle.value || undefined,
        });
        emit('branch', res.thread.id, { originThreadId, anchorMessageId: messageId, generation });
        toast.add({
            title: 'Branched',
            description: `New branch: ${res.thread.title}`,
            color: 'primary',
            duration: 2200,
        });
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : 'Error creating branch';
        toast.add({
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
const registeredActions = useMessageActions({
    role: actionRole,
});
const messageActionContext = () => ({ message: props.message, threadId: props.threadId, compaction: props.compactionAction });
const extraActions = computed(() => registeredActions.value.filter((action) => !action.visible || action.visible(messageActionContext())));

async function runExtraAction(action: ChatMessageAction) {
    try {
        if (action.disabled?.(messageActionContext())) return;
        await action.handler(messageActionContext());
    } catch (e: unknown) {
        const description =
            e instanceof Error ? e.message : 'Error running action';
        try {
            toast.add({
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
    transition: transform var(--app-motion-duration-fast, 0.15s)
        var(--app-motion-easing-standard, ease);
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

/* Use one transform for desktop positioning. Individual translate utilities
   can survive a mobile transform reset after CSS optimization. */
.cm-actions {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translate(-50%, 50%);
    /* Size the desktop strip independently of a short message bubble. */
    width: max-content;
    min-width: 0;
}

.cm-action-group {
    min-width: 0;
    max-width: 100%;
    flex-wrap: nowrap;
}

@media (width < 768px), (pointer: coarse) {
    .cm-actions {
        position: static;
        transform: none;
        width: auto;
        max-width: 100%;
        justify-content: center;
        align-items: center;
        padding-block: 6px;
        margin-top: 0.75rem;
    }

    .cm-action-group {
        flex-wrap: wrap;
        justify-content: center;
        column-gap: 0;
        row-gap: 12px;
        opacity: 1 !important;
    }

    /* Match the layer of theme size utilities; the 44px floor is provided by
       the hit region rather than the painted strip. */
    @layer utilities {
        .cm-action-group :deep(button) {
            position: relative;
            width: 44px;
            min-width: 44px;
            height: 32px !important;
            min-height: 32px !important;
            padding: 0 !important;
            flex-shrink: 0;
            margin-inline: 0 !important;
        }
    }

    .cm-action-group :deep(button::before) {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 44px;
        height: 44px;
        transform: translate(-50%, -50%);
    }
}

/* A split pane can be phone-sized even in a desktop browser. */
@container chat-pane (width < 768px) {
    .cm-actions {
        position: static;
        transform: none;
        width: auto;
        max-width: 100%;
        justify-content: center;
        align-items: center;
        padding-block: 6px;
        margin-top: 0.75rem;
    }

    .cm-action-group {
        flex-wrap: wrap;
        justify-content: center;
        column-gap: 0;
        row-gap: 12px;
        opacity: 1 !important;
    }

    @layer utilities {
        .cm-action-group :deep(button) {
            position: relative;
            width: 44px;
            min-width: 44px;
            height: 32px !important;
            min-height: 32px !important;
            padding: 0 !important;
            flex-shrink: 0;
            margin-inline: 0 !important;
        }
    }

    .cm-action-group :deep(button::before) {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 44px;
        height: 44px;
        transform: translate(-50%, -50%);
    }
}
</style>
