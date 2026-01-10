<template>
    <div
        class="workflow-chat-message w-full max-w-full"
        :class="['group', messageContainerProps?.class || '']"
        :data-theme-target="messageContainerProps?.['data-theme-target']"
        :data-theme-matches="messageContainerProps?.['data-theme-matches']"
    >
        <!-- Workflow Execution Status (Progress/Steps) -->
        <div v-if="props.message.workflowState" class="mb-4">
            <WorkflowExecutionStatus
                :workflow-state="props.message.workflowState"
            />
        </div>

        <!-- Final Output - only shown when workflow completes -->
        <div
            v-if="showResultBox"
            class="workflow-output relative bg-[var(--md-surface)] rounded-[var(--md-border-radius)] p-4 border border-[var(--md-outline-variant)]"
        >
            <!-- Label -->
            <div
                class="absolute top-0 left-0 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--md-on-surface-variant)] bg-[var(--md-surface-container)] rounded-br rounded-tl-[var(--md-border-radius)] border-b border-r border-[var(--md-outline-variant)]"
            >
                Result
            </div>

            <!-- Content -->
            <div class="mt-4">
                <StreamMarkdown
                    :content="outputContent"
                    :shiki-theme="currentShikiTheme"
                    code-block-show-line-numbers
                    class="cm-markdown-assistant prose max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 w-full min-w-full or3-prose prose-pre:max-w-full prose-pre:overflow-x-auto leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] dark:text-white/95 dark:prose-headings:text-white/95! prose-pre:bg-(--md-surface-container)/80 prose-pre:border-(--md-border-width) prose-pre:border-(--md-border-color) prose-pre:text-(--md-on-surface) prose-pre:font-[inherit] prose-code:text-(--md-on-surface) prose-code:font-[inherit]"
                />
            </div>
        </div>

        <!-- Action buttons (Copy, Retry, etc) - Reusing similar layout to ChatMessage but simplified -->
        <div
            class="flex justify-end mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
            <UButtonGroup
                class="bg-(--md-surface) rounded-(--md-border-radius) shadow-sm border border-(--md-outline-variant) overflow-hidden"
            >
                <UTooltip
                    :delay-duration="500"
                    text="Copy Result"
                    :teleport="true"
                >
                    <UButton
                        v-bind="copyButtonProps"
                        @click="copyResult"
                    ></UButton>
                </UTooltip>
                <UTooltip
                    v-if="canRetry"
                    :delay-duration="500"
                    text="Retry from failed node"
                    :teleport="true"
                >
                    <UButton v-bind="retryButtonProps" @click="retryFromHere" />
                </UTooltip>
                <!-- Add more actions like Retry/Stop here if needed in future -->
            </UButtonGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useClipboard } from '@vueuse/core';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { deriveStartNodeId } from '~/utils/chat/workflow-types';
import WorkflowExecutionStatus from './WorkflowExecutionStatus.vue';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import { useNuxtApp } from '#app';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { useToast } from '#imports';

const props = defineProps<{
    message: UiChatMessage;
}>();

const toast = useToast();
const nuxtApp = useNuxtApp();

// Theme
const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
const currentShikiTheme = computed(() => {
    const themeObj = themePlugin.value;
    const themeName = themeObj.current?.value ?? themeObj.get();
    return String(themeName).startsWith('dark')
        ? 'github-dark'
        : 'github-light';
});

// Prefer finalOutput, fall back to live streaming text so the last message always renders as Markdown.
// finalOutput is set once on finalize; finalStreamingText updates during execution.
const outputContent = computed(() => {
    const wf = props.message.workflowState;
    if (!wf) return '';
    if (wf.finalOutput && typeof wf.finalOutput === 'string') {
        return wf.finalOutput;
    }
    if (wf.finalStreamingText && typeof wf.finalStreamingText === 'string') {
        return wf.finalStreamingText;
    }
    return '';
});

// Show the result box when there is any content (streaming or final)
const showResultBox = computed(() => outputContent.value.length > 0);

const canRetry = computed(() => {
    const wf = props.message.workflowState;
    if (!wf) return false;
    // Check if workflow is in a retryable state
    const isRetryableState = ['error', 'interrupted', 'stopped'].includes(
        wf.executionState as string
    );
    if (!isRetryableState) return false;
    // Derive start node from utility
    const startNodeId = deriveStartNodeId({
        resumeState: wf.resumeState,
        failedNodeId: wf.failedNodeId,
        currentNodeId: wf.currentNodeId,
        nodeStates: wf.nodeStates,
        lastActiveNodeId: wf.lastActiveNodeId,
    });
    return Boolean(startNodeId);
});

// Styles
const messageContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'message',
        identifier: 'message.workflow-container',
        isNuxtUI: false,
    });
    return overrides.value;
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.copy',
        isNuxtUI: true,
    });

    return {
        icon: useIcon('chat.message.copy').value,
        color: 'neutral' as const,
        variant: 'ghost' as const,
        size: 'xs' as const,
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
        icon: useIcon('ui.refresh').value,
        color: 'primary' as const,
        variant: 'ghost' as const,
        size: 'xs' as const,
        ...overrides.value,
    };
});

const { copy } = useClipboard({ legacy: true });

function copyResult() {
    if (!outputContent.value) return;
    copy(outputContent.value)
        .then(() => {
            toast.add({
                title: 'Copied to clipboard',
                color: 'success',
                icon: useIcon('ui.check').value,
            });
        })
        .catch(() => {
            toast.add({
                title: 'Copy failed',
                color: 'error',
            });
        });
}

async function retryFromHere() {
    if (!canRetry.value) return;
    const svc = nuxtApp.$workflowSlash;
    if (!svc?.retry) return;
    const ok = await svc.retry(props.message.id);
    if (ok) {
        toast.add({
            title: 'Retry started',
            color: 'info',
            icon: useIcon('ui.check').value,
        });
    }
}

onMounted(async () => {
    // Preload shiki themes for code highlighting
    await useShikiHighlighter();
});
</script>

<style scoped>
@import '~/assets/css/or3-prose.css';
</style>
