<template>
    <div class="blank2-chat-shell">
        <ChatInputDropper
            class="blank2-chat-dropper"
            v-bind="attrs"
            :loading="props.loading"
            :container-width="props.containerWidth"
            :thread-id="props.threadId"
            :streaming="props.streaming"
            :pane-id="props.paneId"
            @send="forwardSend"
            @prompt-change="forwardPromptChange"
            @image-add="forwardImageAdd"
            @image-remove="forwardImageRemove"
            @model-change="forwardModelChange"
            @settings-change="forwardSettingsChange"
            @trigger-file-input="emit('trigger-file-input')"
            @pending-prompt-selected="forwardPendingPromptSelected"
            @stop-stream="emit('stop-stream')"
            @resize="forwardResize"
        />
    </div>
</template>

<script setup lang="ts">
import { useAttrs } from 'vue';
import ChatInputDropper from '~/components/chat/ChatInputDropper.vue';
import type {
    ImageSettings,
    LargeTextBlock,
    UploadedImage,
} from '~/components/chat/chat-input/types';

defineOptions({ inheritAttrs: false });

type ChatInputSendPayload = {
    text: string;
    images: UploadedImage[];
    attachments: UploadedImage[];
    largeTexts: LargeTextBlock[];
    model: string;
    settings: ImageSettings;
    webSearchEnabled: boolean;
};

type ResizePayload = {
    height: number;
};

const props = defineProps<{
    loading?: boolean;
    containerWidth?: number;
    threadId?: string;
    streaming?: boolean;
    paneId?: string;
}>();

const emit = defineEmits<{
    (e: 'send', payload: ChatInputSendPayload): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
    (e: 'pending-prompt-selected', promptId: string | null): void;
    (e: 'stop-stream'): void;
    (e: 'resize', payload: ResizePayload): void;
}>();

const attrs = useAttrs();

function forwardSend(payload: ChatInputSendPayload) {
    emit('send', payload);
}

function forwardPromptChange(value: string) {
    emit('prompt-change', value);
}

function forwardImageAdd(image: UploadedImage) {
    emit('image-add', image);
}

function forwardImageRemove(index: number) {
    emit('image-remove', index);
}

function forwardModelChange(model: string) {
    emit('model-change', model);
}

function forwardSettingsChange(settings: ImageSettings) {
    emit('settings-change', settings);
}

function forwardPendingPromptSelected(promptId: string | null) {
    emit('pending-prompt-selected', promptId);
}

function forwardResize(payload: ResizePayload) {
    emit('resize', payload);
}
</script>

<style scoped>
/* ── Shell: centers & constrains the input ── */
.blank2-chat-shell {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 0 1rem;
}

/* ── Pill container ── */
:deep(.blank2-chat-dropper.chat-input-main) {
    position: relative;
    overflow: visible;
    margin: 0 !important;
    border: 1px solid color-mix(in srgb, var(--md-outline) 18%, transparent);
    border-radius: 28px;
    background: color-mix(in srgb, var(--md-surface) 92%, white 8%);
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--md-outline) 6%, transparent),
        0 1px 3px rgba(0, 0, 0, 0.04),
        0 4px 12px -4px rgba(0, 0, 0, 0.06);
    transition:
        border-color 0.25s ease,
        box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.2s ease;
}

:deep(.blank2-chat-dropper.chat-input-main:focus-within) {
    border-color: color-mix(in srgb, var(--md-primary) 45%, transparent);
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--md-primary) 12%, transparent),
        0 0 0 4px color-mix(in srgb, var(--md-primary) 6%, transparent),
        0 2px 8px rgba(0, 0, 0, 0.06),
        0 8px 24px -8px rgba(0, 0, 0, 0.08);
}

:deep(.blank2-chat-dropper.chat-input-main:hover:not(:focus-within)) {
    border-color: color-mix(in srgb, var(--md-outline) 32%, transparent);
    box-shadow:
        0 0 0 1px color-mix(in srgb, var(--md-outline) 8%, transparent),
        0 2px 6px rgba(0, 0, 0, 0.05),
        0 6px 18px -6px rgba(0, 0, 0, 0.07);
}

/* ── Inner spacing ── */
:deep(.blank2-chat-dropper .chat-input-inner-container) {
    margin: 0 !important;
    padding: 0.5rem 0 !important;
    gap: 0 !important;
}

/* ── Hide model selector & composer actions ── */
:deep(.blank2-chat-dropper .chat-input-composer-actions),
:deep(.blank2-chat-dropper .chat-input-model-select) {
    display: none !important;
}

/* ── Bottom controls: anchor to bottom of pill ── */
:deep(.blank2-chat-dropper .chat-input-bottom-controls) {
    position: absolute !important;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    height: 3.5rem;
    margin: 0 !important;
    padding: 0 !important;
    flex-wrap: nowrap !important;
    gap: 0 !important;
    pointer-events: none;
}

:deep(.blank2-chat-dropper .chat-input-bottom-controls-left),
:deep(.blank2-chat-dropper .chat-input-bottom-controls-right) {
    position: absolute !important;
    bottom: 0;
    top: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: none !important;
    min-width: 0 !important;
    pointer-events: auto;
}

:deep(.blank2-chat-dropper .chat-input-bottom-controls-left) {
    left: 0.75rem;
}

:deep(.blank2-chat-dropper .chat-input-bottom-controls-right) {
    right: 0.75rem;
}

/* ── Editor area ── */
:deep(.blank2-chat-dropper .chat-input-editor-container) {
    min-height: 2.5rem !important;
    max-height: 10rem !important;
    padding: 0 3.25rem 0 5.5rem !important;
    background: transparent;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--md-outline) 25%, transparent) transparent;
}

:deep(.blank2-chat-dropper .chat-input-editor),
:deep(.blank2-chat-dropper .ProseMirror) {
    min-height: 2.5rem !important;
    display: flex;
    align-items: center;
    padding: 0;
    font-size: 0.975rem;
    line-height: 1.5;
    color: var(--md-on-surface);
    font-weight: 400;
    letter-spacing: 0.005em;
}

:deep(.blank2-chat-dropper .ProseMirror p) {
    margin: 0;
    width: 100%;
}

:deep(.blank2-chat-dropper .ProseMirror p.is-editor-empty:first-child::before) {
    color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
    opacity: 1;
    font-weight: 400;
}

/* ── Loading spinner ── */
:deep(.blank2-chat-dropper .chat-input-loading-indicator) {
    bottom: 1rem;
    top: auto;
    right: 3.5rem;
    transform: none;
    opacity: 0.6;
}

/* ── Action buttons (attach / settings) ── */
:deep(.blank2-chat-dropper .chat-input-attachment-btn button),
:deep(.blank2-chat-dropper .chat-input-settings-btn button) {
    min-height: 2rem;
    width: 2rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent !important;
    box-shadow: none !important;
    color: color-mix(in srgb, var(--md-on-surface) 55%, transparent) !important;
    transition:
        background-color 0.2s ease,
        color 0.2s ease,
        transform 0.15s ease;
}

:deep(.blank2-chat-dropper .chat-input-attachment-btn button:hover),
:deep(.blank2-chat-dropper .chat-input-settings-btn button:hover) {
    background: color-mix(in srgb, var(--md-primary) 8%, transparent) !important;
    color: var(--md-primary) !important;
    transform: scale(1.08);
}

:deep(.blank2-chat-dropper .chat-input-attachment-btn button:active),
:deep(.blank2-chat-dropper .chat-input-settings-btn button:active) {
    transform: scale(0.95);
}

:deep(.blank2-chat-dropper .chat-input-attachment-btn .w-4),
:deep(.blank2-chat-dropper .chat-input-settings-btn .w-4) {
    width: 1rem;
    height: 1rem;
}

/* ── Send / Stop button ── */
:deep(.blank2-chat-dropper .chat-input-send-btn),
:deep(.blank2-chat-dropper .chat-input-stop-btn) {
    min-height: 2rem;
    width: 2rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--md-primary) !important;
    color: var(--md-on-primary) !important;
    box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.12),
        0 2px 8px -2px color-mix(in srgb, var(--md-primary) 30%, transparent);
    transition:
        transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
        box-shadow 0.25s ease,
        opacity 0.2s ease;
}

:deep(.blank2-chat-dropper .chat-input-send-btn:hover),
:deep(.blank2-chat-dropper .chat-input-stop-btn:hover) {
    transform: scale(1.08);
    box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.15),
        0 4px 14px -3px color-mix(in srgb, var(--md-primary) 40%, transparent);
}

:deep(.blank2-chat-dropper .chat-input-send-btn:active),
:deep(.blank2-chat-dropper .chat-input-stop-btn:active) {
    transform: scale(0.92);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

:deep(.blank2-chat-dropper .chat-input-send-btn:disabled) {
    opacity: 0.35;
    transform: none;
    box-shadow: none;
    cursor: default;
}

:deep(.blank2-chat-dropper .chat-input-send-btn .w-4),
:deep(.blank2-chat-dropper .chat-input-stop-btn .w-4) {
    width: 0.875rem;
    height: 0.875rem;
}

:deep(.blank2-chat-dropper .chat-input-stop-btn) {
    background: var(--md-error) !important;
    box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.12),
        0 2px 8px -2px color-mix(in srgb, var(--md-error) 30%, transparent);
}

/* ── Attachments grid: above input like ChatGPT ── */
:deep(.blank2-chat-dropper .chat-input-attachments) {
    order: -1;
    position: relative;
    z-index: 1;
    margin: 0.75rem 0.75rem 0;
    padding: 0;
    gap: 0.5rem;
    grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
}

/* ── Responsive ── */
@media (max-width: 640px) {
    .blank2-chat-shell {
        padding: 0 0.5rem;
    }

    :deep(.blank2-chat-dropper .chat-input-editor),
    :deep(.blank2-chat-dropper .ProseMirror) {
        font-size: 0.925rem;
    }

    :deep(.blank2-chat-dropper .chat-input-editor-container) {
        min-height: 2.5rem !important;
        padding: 0 3.25rem 0 5rem !important;
    }

    :deep(.blank2-chat-dropper .chat-input-bottom-controls) {
        height: 3.5rem;
    }

    :deep(.blank2-chat-dropper .chat-input-inner-container) {
        padding: 0.5rem 0 !important;
    }

    :deep(.blank2-chat-dropper .chat-input-bottom-controls-left) {
        left: 0.5rem;
    }

    :deep(.blank2-chat-dropper .chat-input-bottom-controls-right) {
        right: 0.5rem;
    }

    :deep(.blank2-chat-dropper .chat-input-attachments) {
        margin: 0.5rem 0.5rem 0;
    }

    :deep(.blank2-chat-dropper .chat-input-attachment-btn button),
    :deep(.blank2-chat-dropper .chat-input-settings-btn button) {
        min-height: 1.75rem;
        width: 1.75rem;
    }

    :deep(.blank2-chat-dropper .chat-input-send-btn),
    :deep(.blank2-chat-dropper .chat-input-stop-btn) {
        min-height: 1.75rem;
        width: 1.75rem;
    }

    :deep(.blank2-chat-dropper .chat-input-attachments) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

/* ── Dark mode refinements ── */
@media (prefers-color-scheme: dark) {
    :deep(.blank2-chat-dropper.chat-input-main) {
        background: color-mix(in srgb, var(--md-surface) 90%, white 10%);
        border-color: color-mix(in srgb, var(--md-outline) 30%, transparent);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--md-outline) 15%, transparent),
            0 1px 4px rgba(0, 0, 0, 0.3),
            0 4px 16px -4px rgba(0, 0, 0, 0.4);
    }

    :deep(.blank2-chat-dropper.chat-input-main:hover:not(:focus-within)) {
        border-color: color-mix(in srgb, var(--md-outline) 55%, transparent);
    }

    :deep(.blank2-chat-dropper.chat-input-main:focus-within) {
        border-color: color-mix(in srgb, var(--md-primary) 60%, transparent);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--md-primary) 25%, transparent),
            0 0 0 4px color-mix(in srgb, var(--md-primary) 12%, transparent),
            0 2px 8px rgba(0, 0, 0, 0.3),
            0 8px 24px -8px rgba(0, 0, 0, 0.4);
    }

    :deep(.blank2-chat-dropper .ProseMirror p.is-editor-empty:first-child::before) {
        color: color-mix(in srgb, var(--md-on-surface) 50%, transparent);
    }

    :deep(.blank2-chat-dropper .chat-input-attachment-btn button),
    :deep(.blank2-chat-dropper .chat-input-settings-btn button) {
        color: color-mix(in srgb, var(--md-on-surface) 70%, transparent) !important;
    }

    :deep(.blank2-chat-dropper .chat-input-attachment-btn button:hover),
    :deep(.blank2-chat-dropper .chat-input-settings-btn button:hover) {
        background: color-mix(in srgb, var(--md-primary) 15%, transparent) !important;
    }
}

[data-theme="blank"].dark {
    :deep(.blank2-chat-dropper.chat-input-main) {
        background: color-mix(in srgb, var(--md-surface) 90%, white 10%);
        border-color: color-mix(in srgb, var(--md-outline) 30%, transparent);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--md-outline) 15%, transparent),
            0 1px 4px rgba(0, 0, 0, 0.3),
            0 4px 16px -4px rgba(0, 0, 0, 0.4);
    }

    :deep(.blank2-chat-dropper.chat-input-main:hover:not(:focus-within)) {
        border-color: color-mix(in srgb, var(--md-outline) 55%, transparent);
    }

    :deep(.blank2-chat-dropper.chat-input-main:focus-within) {
        border-color: color-mix(in srgb, var(--md-primary) 60%, transparent);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--md-primary) 25%, transparent),
            0 0 0 4px color-mix(in srgb, var(--md-primary) 12%, transparent),
            0 2px 8px rgba(0, 0, 0, 0.3),
            0 8px 24px -8px rgba(0, 0, 0, 0.4);
    }

    :deep(.blank2-chat-dropper .ProseMirror p.is-editor-empty:first-child::before) {
        color: color-mix(in srgb, var(--md-on-surface) 50%, transparent);
    }

    :deep(.blank2-chat-dropper .chat-input-attachment-btn button),
    :deep(.blank2-chat-dropper .chat-input-settings-btn button) {
        color: color-mix(in srgb, var(--md-on-surface) 70%, transparent) !important;
    }

    :deep(.blank2-chat-dropper .chat-input-attachment-btn button:hover),
    :deep(.blank2-chat-dropper .chat-input-settings-btn button:hover) {
        background: color-mix(in srgb, var(--md-primary) 15%, transparent) !important;
    }
}
</style>
