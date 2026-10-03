<template>
    <ChatComposerShell
        id="chat-input-main"
        ref="composerShell"
        size="sm"
        :class="[
            isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'hover:border-(--md-primary) focus-within:border-(--md-primary) dark:focus-within:border-gray-600',
            loading ? 'opacity-90 pointer-events-auto' : '',
            mainContainerProps?.class || '',
        ]"
        :data-theme-target="mainContainerProps?.['data-theme-target']"
        :data-theme-matches="mainContainerProps?.['data-theme-matches']"
        @click="handleContainerClick"
    >
        <div class="chat-input-inner-container flex flex-col gap-3.5 m-3.5">
            <ChatContextMeter :state="contextPreview.state.value" @refresh="contextPreview.refresh()" />
            <div v-if="sendBlock" role="status" aria-live="polite" class="space-y-2 text-xs">
                <p>{{ sendBlock.error || 'Context full. Compact, edit the request, or choose a larger model.' }}</p>
                <div class="flex flex-wrap gap-2">
                    <UButton v-if="props.compactThread" size="xs" variant="soft" color="neutral" :disabled="Boolean(props.compactionBlockedReason) || props.loading" @click.stop="props.compactThread()">Compact</UButton>
                    <UButton size="xs" variant="ghost" color="neutral" @click.stop="showModelCatalog = true">Choose model</UButton>
                    <UButton v-if="sendBlock.reason === 'context_full' && !('userMessageId' in sendBlock && sendBlock.userMessageId)" size="xs" variant="ghost" color="neutral" :disabled="props.loading" @click.stop="handleSend({ inspectLossyRequest: true })">Inspect lossy send</UButton>
                </div>
                <details v-if="lossyPreview" open>
                    <summary class="cursor-pointer py-2">Omit {{ lossyPreview.omitted_turn_count }} old turns ({{ lossyPreview.omitted_message_count }} messages) for this request</summary>
                    <p>The original history stays saved. This request excludes only the entries below.</p>
                    <ul class="max-h-40 overflow-y-auto space-y-1 py-2" aria-label="Messages omitted from this request">
                        <li v-for="row in lossyPreview.omitted_messages" :key="row.position">{{ row.position + 1 }} · {{ row.role }} · {{ row.excerpt }}</li>
                    </ul>
                    <div class="flex gap-2">
                        <UButton size="xs" variant="soft" color="warning" :disabled="props.loading" @click.stop="handleSend({ lossyConfirmation: lossyPreview })">Send with these omissions</UButton>
                        <UButton size="xs" variant="ghost" color="neutral" @click.stop="lossyPreview = undefined">Cancel</UButton>
                    </div>
                </details>
            </div>
            <div v-if="compactionInProgress" role="status" aria-live="polite" class="flex items-center justify-between gap-2 text-xs">
                <span>{{ props.compactionState?.status }} summary · {{ compactionModel }}</span>
                <UButton size="xs" variant="ghost" color="neutral" @click.stop="emit('cancel-compaction')">Cancel</UButton>
            </div>
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="chat-input-editor-container w-full overflow-y-auto wrap-anywhere min-h-4 md:min-h-12"
                    :class="editorProps?.class || ''"
                    :data-theme-target="editorProps?.['data-theme-target']"
                    :data-theme-matches="editorProps?.['data-theme-matches']"
                >
                    <!-- TipTap Editor -->
                    <EditorContent
                        v-if="editor"
                        class="chat-input-editor prosemirror-host"
                        :editor="(editor as any)"
                        :data-theme-target="editorProps?.['data-theme-target']"
                        :data-theme-matches="
                            editorProps?.['data-theme-matches']
                        "
                    ></EditorContent>

                    <div
                        class="chat-input-loading-indicator absolute top-1 right-1 flex items-center gap-2"
                        v-if="loading"
                    >
                        <UIcon
                            :name="iconLoading"
                            class="w-4 h-4 animate-spin opacity-70"
                        />
                    </div>
                </div>
            </div>

            <!-- Bottom Controls -->
            <div
                class="chat-input-bottom-controls flex flex-wrap gap-2.5 w-full items-center"
            >
                <div
                    class="chat-input-bottom-controls-left relative flex-1 flex items-center gap-2 shrink min-w-0"
                >
                    <!-- Attachment Button -->
                    <!-- Attachment Button -->
                    <div class="chat-input-attachment-btn relative shrink-0">
                        <UButton
                            v-bind="attachButtonProps"
                            @click="triggerFileInput"
                            type="button"
                            aria-label="Add attachments"
                            :disabled="loading"
                        >
                            <UIcon :name="iconAttach" class="w-4 h-4" />
                        </UButton>
                    </div>
                    <!-- Settings Button (stub) -->
                    <div class="chat-input-settings-btn relative shrink-0">
                        <ClientOnly>
                            <UPopover
                                v-model:open="settingsPopoverOpen"
                                class="chat-input-settings-popover"
                                :content="{ side: 'top', collisionPadding: 16 }"
                                :ui="{
                                    content:
                                        'data-[state=open]:animate-[scale-in_170ms_ease-out] data-[state=closed]:animate-[scale-out_120ms_ease-in] motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none',
                                }"
                            >
                                <UButton
                                    v-bind="settingsButtonProps"
                                    label="Open"
                                    type="button"
                                    aria-label="Settings"
                                    :disabled="loading"
                                >
                                    <UIcon
                                        :name="iconModelSettings"
                                        class="w-4 h-4"
                                    />
                                </UButton>
                                <template #content>
                                    <ChatSettingsPopover
                                        :container-width="containerWidth"
                                        :loading="loading"
                                        :streaming="props.streaming"
                                        :thinking-supported="modelSupportsThinking"
                                        :reasoning-efforts="
                                            modelReasoningEfforts
                                        "
                                        :reasoning-default-effort="
                                            modelDefaultReasoningEffort
                                        "
                                        :thread-id="props.threadId"
                                        :pane-id="promptOwnerId"
                                        :prompt-selection-revision="promptSelectionRevision"
                                        v-model:model="selectedModel"
                                        v-model:model-variant="modelVariant"
                                        v-model:thinking-enabled="
                                            thinkingEnabled
                                        "
                                        v-model:reasoning-effort="
                                            reasoningEffort
                                        "
                                        @close="settingsPopoverOpen = false"
                                        @open-system-prompts="
                                            openSystemPromptsFromSettings
                                        "
                                        @open-model-catalog="
                                            openModelCatalogFromSettings
                                        "
                                        @pending-prompt-selected="
                                            (id: string) => emit('pending-prompt-selected', id)
                                        "
                                        @prompt-selected="promptSelectionRevision++"
                                    />
                                </template>
                            </UPopover>
                        </ClientOnly>
                    </div>
                    <span
                        v-if="promptBadge"
                        class="hidden max-w-40 truncate rounded-full border border-[var(--md-border-color)] px-2 py-1 text-xs text-[var(--md-on-surface-variant)] sm:inline-block"
                        :title="promptBadge"
                        :aria-label="`System prompt: ${promptBadge}`"
                    >
                        {{ promptBadge }}
                    </span>
                </div>

                <div
                    class="chat-input-composer-actions order-first flex w-full min-w-0 flex-wrap items-center gap-1"
                    v-if="composerActions.length"
                >
                    <UTooltip
                        v-for="entry in composerActions"
                        :key="`composer-action-${entry.action.id}`"
                        :delay-duration="0"
                        :text="entry.action.tooltip || entry.action.label"
                    >
                        <UButton
                            v-bind="composerActionButtonProps"
                            :aria-label="entry.action.tooltip || entry.action.label || entry.action.id"
                            :disabled="entry.disabled"
                            @click="handleComposerAction(entry)"
                        >
                            <UIcon :name="entry.action.icon" class="w-4 h-4" />
                            <span
                                v-if="entry.action.label"
                                class="text-xs font-medium"
                            >
                                {{ entry.action.label }}
                            </span>
                        </UButton>
                    </UTooltip>
                </div>

                <!-- Model Selector extracted -->
                <div
                    v-if="!isMobile && containerWidth && containerWidth > 400"
                    class="chat-input-model-select hidden sm:block sm:flex-1 min-w-0 sm:min-w-[200px] sm:max-w-full"
                >
                    <component
                        :is="$theme.activeComponents.value['model-selector']"
                        v-model:model="selectedModel"
                        :loading="loading"
                        class="w-full min-w-0 max-w-full"
                    />
                </div>

                <!-- Send / Stop Button -->
                <div class="chat-input-bottom-controls-right">
                    <UButton
                        class="chat-input-send-btn"
                        v-if="!props.streaming"
                        v-bind="sendButtonProps"
                        @click="handleSendClick"
                        :disabled="
                            loading ||
                            (!promptText.trim() &&
                                uploadedImages.length === 0 &&
                                largeTextBlocks.length === 0)
                        "
                        type="button"
                        aria-label="Send message"
                    >
                        <UIcon :name="iconSend" class="w-4 h-4" />
                    </UButton>
                    <UButton
                        class="chat-input-stop-btn"
                        v-else
                        v-bind="stopButtonProps"
                        @click="emit('stop-stream')"
                        type="button"
                        aria-label="Stop generation"
                    >
                        <UIcon :name="iconStop" class="w-4 h-4" />
                    </UButton>
                </div>
            </div>
        </div>

        <!-- Attachment Thumbnails (Images + Large Text Blocks) -->
        <div
            v-if="uploadedImages.length > 0 || largeTextBlocks.length > 0"
            class="chat-input-attachments mx-3.5 mb-3.5 grid gap-3"
        >
            <!-- Images -->
            <div
                v-for="image in imageAttachments"
                :key="image.key"
                class="chat-input-attachment-image-container relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (image.displayIndex + 1)"
                    class="chat-input-attachment-image w-full h-full object-cover rounded-[var(--md-border-radius-small,var(--md-border-radius))] shadow-sm border-[length:var(--md-border-width)] border-gray-200 dark:border-gray-700"
                />
                <UButton
                    v-bind="attachmentRemoveBtnProps"
                    @click="removeImage(image.index)"
                    :disabled="loading"
                    aria-label="Remove image"
                />
                <div
                    class="chat-input-attachment-image-name absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[11px] p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] rounded-b-[var(--md-border-radius-small,var(--md-border-radius))]"
                >
                    {{ image.name }}
                </div>
            </div>
            <!-- PDFs -->
            <div
                v-for="pdf in pdfAttachments"
                :key="pdf.key"
                :class="[
                    'chat-input-attachment-pdf-container relative group aspect-square overflow-hidden flex items-center justify-center bg-(--md-surface-container-low) p-2 text-center',
                    attachmentPdfContainerProps?.class || '',
                ]"
                :data-theme-target="
                    attachmentPdfContainerProps?.['data-theme-target']
                "
                :data-theme-matches="
                    attachmentPdfContainerProps?.['data-theme-matches']
                "
            >
                <div
                    class="chat-input-attachment-pdf-inner flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="chat-input-attachment-pdf-inner-label text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >PDF</span
                    >
                    <span
                        class="chat-input-attachment-pdf-inner-name text-[11px] leading-snug line-clamp-4 px-1 wrap-break-word"
                        :title="pdf.name"
                        >{{ pdf.name }}</span
                    >
                </div>
                <UButton
                    v-bind="attachmentRemoveBtnProps"
                    @click="removeImage(pdf.index)"
                    :disabled="loading"
                    aria-label="Remove PDF"
                />
            </div>
            <!-- Large Text Blocks -->
            <div
                v-for="(block, tIndex) in largeTextBlocks"
                :key="'txt-' + block.id"
                :class="[
                    'chat-input-attachment-text-container relative group aspect-square overflow-hidden flex items-center justify-center bg-(--md-surface-container-low) p-2 text-center',
                    attachmentTextContainerProps?.class || '',
                ]"
                :data-theme-target="
                    attachmentTextContainerProps?.['data-theme-target']
                "
                :data-theme-matches="
                    attachmentTextContainerProps?.['data-theme-matches']
                "
            >
                <div
                    class="chat-input-attachment-text-inner flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="chat-input-attachment-text-inner-label text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >TXT</span
                    >
                    <span
                        class="chat-input-attachment-text-inner-name text-[11px] leading-snug line-clamp-4 px-1 wrap-break-word"
                        :title="block.previewFull"
                    >
                        {{ block.preview }}
                    </span>
                    <span
                        class="chat-input-attachment-text-inner-wordcount mt-1 text-[10px] opacity-70"
                        >{{ block.wordCount }}w</span
                    >
                </div>
                <UButton
                    v-bind="attachmentRemoveBtnProps"
                    @click="removeTextBlock(tIndex)"
                    :disabled="loading"
                    aria-label="Remove text block"
                />
            </div>
        </div>

        <!-- Drag and Drop Overlay -->
        <div
            v-if="isDragging"
            :class="[
                'chat-input-drag-and-drop-overlay absolute inset-0 bg-blue-50 dark:bg-blue-900/20 border-blue-500 flex items-center justify-center z-50',
                dragOverlayProps?.class || '',
            ]"
            :data-theme-target="dragOverlayProps?.['data-theme-target']"
            :data-theme-matches="dragOverlayProps?.['data-theme-matches']"
        >
            <div class="text-center">
                <UIcon
                    :name="iconUpload"
                    class="w-12 h-12 mx-auto mb-3 text-blue-500"
                />
                <p class="text-blue-600 dark:text-blue-400 text-sm font-medium">
                    Drop images here to upload
                </p>
            </div>
        </div>
        <ClientOnly>
            <component
                v-if="modelCatalogActivated"
                :is="$theme.activeComponents.value['model-catalog-modal']"
                v-model:showModal="showModelCatalog"
            />
            <OpenRouterKeyModal v-if="keyModalActivated" v-model:open="showKeyModal" />
        </ClientOnly>
    </ChatComposerShell>
</template>

<script setup lang="ts">
import ChatContextMeter from './ChatContextMeter.vue';
import { useContextPreview } from '~/composables/chat/useContextPreview';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import {
    computed,
    ref,
    nextTick,
    shallowRef,
    onMounted,
    onBeforeUnmount,
    watch,
    getCurrentInstance,
    defineAsyncComponent,
} from 'vue';
import { useOr3Config } from '~/composables/useOr3Config';
import { useSystemPromptsModal } from '~/composables/chat/useSystemPromptsModal';
import { getPrompt } from '~/db/prompts';
import { getThreadSystemPrompt } from '~/db/threads';
import { usePanePendingPrompt } from '~/composables/core/usePanePrompt';
import {
    DEFAULT_PROMPT_SELECTION,
    DISABLED_PROMPT_SELECTION,
} from '~/utils/chat/prompt-utils';
import { resolveOpenRouterKeyAvailability } from '~/core/auth/openRouterKeyAvailability';
import { guardPendingAttachmentSend } from '~/composables/chat/pendingAttachmentGuard';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Extension, Node, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { isMobile } from '~/state/global';
import {
    useToast,
    useUserApiKey,
    useOpenRouterAuth,
    useRuntimeConfig,
} from '#imports';
import {
    useComposerActions,
    type ComposerActionEntry,
    type ComposerActionContext,
} from '#imports';
import { useHooks } from '~/core/hooks/useHooks';
import { trustedEditorRevision } from '~/composables/plugins/trusted-editor';
import { useIcon } from '~/composables/useIcon';
import {
    registerPaneInput,
    unregisterPaneInput,
} from '~/composables/chat/useChatInputBridge';
import type {
    ImageSettings,
    LargeTextBlock,
    UploadedImage,
} from '~/components/chat/chat-input/types';
import { useChatInputAttachments } from '~/components/chat/chat-input/useChatInputAttachments';
import ChatComposerShell from '~/components/chat/ChatComposerShell.vue';
import { useChatModelSelection } from '~/composables/chat/useChatModelSelection';
import { useChatAttachmentDisplay } from '~/composables/chat/useChatAttachmentDisplay';
import { useChatInputTheme } from '~/composables/chat/useChatInputTheme';
import {
    hasDurableSendAcceptance,
    type RegisterSendResult,
    type SendResult,
} from '~/utils/chat/types';
import { useWorkspaceTabDrafts } from '~/composables/core/useWorkspaceTabDrafts';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import {
    sanitizeModelVariant,
    type OpenRouterModelVariant,
} from '~~/shared/openrouter/model-variants';

const OpenRouterKeyModal = defineAsyncComponent(
    () => import('~/components/chat/OpenRouterKeyModal.vue')
);

function isEditorExtension(value: unknown): value is Extension | Node {
    if (value instanceof Extension || value instanceof Node) return true;
    if (!value || typeof value !== 'object') return false;
    const candidate = value as {
        type?: unknown;
        name?: unknown;
        config?: unknown;
        configure?: unknown;
    };
    // Installed trusted packages may bundle a second TipTap constructor. Its
    // extension instances still follow the shape consumed by Editor.
    return (candidate.type === 'extension' || candidate.type === 'node') &&
        typeof candidate.name === 'string' && candidate.name.length > 0 &&
        candidate.config !== null && typeof candidate.config === 'object' &&
        typeof candidate.configure === 'function';
}

function contentForEditor(doc: JSONContent, editor: Editor): JSONContent {
    const convert = (node: JSONContent, parent?: string): JSONContent => {
        if (node.type && !editor.schema.nodes[node.type]) {
            const label = [node.attrs?.label, node.attrs?.name, node.attrs?.id]
                .find((value): value is string => typeof value === 'string') ?? '';
            const text = node.type === 'workflow' ? `/${label}` : label;
            return parent === 'paragraph'
                ? { type: 'text', text }
                : { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
        }
        return node.content
            ? { ...node, content: node.content.map((child) => convert(child, node.type)) }
            : node;
    };
    return convert(doc);
}

const props = defineProps<{
    loading?: boolean;
    containerWidth?: number;
    threadId?: string;
    streaming?: boolean; // assistant response streaming
    paneId?: string; // provided by ChatContainer so the bridge can key this input
    tabId?: string; // owns ephemeral composer state across pane switches
    contextRevision?: unknown;
    compactThread?: () => Promise<void>;
    compactionBlockedReason?: string;
    compactionState?: import('~/composables/chat/useThreadCompaction').ThreadCompactionState;
}>();

const iconLoading = useIcon('ui.loading');
const iconAttach = useIcon('chat.attach');
const iconModelSettings = useIcon('chat.model.settings');
const iconSend = useIcon('chat.send');
const iconStop = useIcon('chat.stop');
const iconUpload = useIcon('chat.upload');
const iconClose = useIcon('ui.close');

const runtimeConfig = useRuntimeConfig();
// Resolve injected dependencies while setup is active. Event handlers can run
// after the component's setup context has gone away, especially after a slow
// network response or a plugin hook, and must not call inject-backed composables.
const toast = useToast();
const { apiKey } = useUserApiKey();
const { startLogin } = useOpenRouterAuth();
const hooks = useHooks();
const openRouterAvailability = computed(() =>
    resolveOpenRouterKeyAvailability(runtimeConfig.public?.openRouter)
);
const allowUserOverride = computed(
    () => openRouterAvailability.value.allowUserOverride
);
const hasInstanceKey = computed(
    () => openRouterAvailability.value.hasInstanceKey
);
let componentDisposed = false;
let editorBuild = 0;

async function initializeEditor(replaceExisting = false) {
    if (!process.client) return;
    const build = ++editorBuild;
    try {
        // Minimal shortcut: Enter sends, Shift+Enter = newline
        const enterToSend = Extension.create({
            name: 'enterToSend',
            addKeyboardShortcuts() {
                return {
                    Enter: () => {
                        // Disable auto-send on mobile; allow normal newline
                        if (isMobile.value) return false;
                        // Respect Shift+Enter for newline
                        const ev = window.event as KeyboardEvent | undefined;
                        if (ev?.shiftKey) return false;
                        handleSend();
                        return true; // prevent default newline
                    },
                    'Shift-Enter': () => false, // explicit newline
                };
            },
        });

        // Collect extensions (plugins can augment via hooks)
        let extensions: Array<Extension | Node> = [
            enterToSend,
            Placeholder.configure({
                // Use a placeholder:
                placeholder: 'Write something …',
            }),
            StarterKit.configure({
                // The composer sends plain text. Keep pasted URLs editable
                // instead of turning them into links that navigate on click.
                link: false,
                bold: false,
                italic: false,
                strike: false,
                code: false,
                blockquote: false,
                heading: false,
                bulletList: false,
                orderedList: false,
                codeBlock: false,
                horizontalRule: false,
                dropcursor: false,
                gapcursor: false,
            }),
        ];

        // Request mentions extension (lazy loads if plugin is installed)
        await hooks.doAction('editor:request-extensions');
        if (componentDisposed || build !== editorBuild) return;

        // Allow plugins to add editor extensions via filter
        try {
            const filtered = await hooks.applyFilters(
                'ui.chat.editor:filter:extensions',
                extensions
            );
            if (Array.isArray(filtered)) {
                const next: Array<Extension | Node> = [];
                for (const item of filtered) {
                    if (isEditorExtension(item)) next.push(item);
                }
                if (next.length) extensions = next;
            }
        } catch {}
        if (componentDisposed || build !== editorBuild) return;

        const nextEditor = new Editor({
            extensions,
            editorProps: {
                attributes: {
                    'aria-label': 'Message input',
                    role: 'textbox',
                },
            },
            onUpdate: ({ editor: ed }) => {
                promptText.value = ed.getText();
                if (!restoringDraft.value) scheduleDraftCapture(props.tabId);
                autoResize();
            },
            onPaste: (event) => {
                handlePaste(event, editor.value);
            },
            content: '',
        });
        if (componentDisposed || build !== editorBuild) {
            nextEditor.destroy();
            return;
        }
        const previous = editor.value;
        const previousJson = replaceExisting ? previous?.getJSON() : undefined;
        const text = replaceExisting ? previous?.getText({ blockSeparator: '\n' }) ?? promptText.value : '';
        const selection = previous?.state.selection.from ?? 1;
        const wasFocused = previous?.isFocused ?? false;
        previous?.destroy();
        editor.value = nextEditor;
        if (replaceExisting && previous) {
            nextEditor.commands.setContent(
                previousJson ? contentForEditor(previousJson, nextEditor) : text,
                { emitUpdate: false }
            );
            promptText.value = nextEditor.getText();
            nextEditor.commands.setTextSelection(
                Math.min(selection, nextEditor.state.doc.content.size)
            );
            if (wasFocused) nextEditor.commands.focus();
        } else {
            await restoreDraft(props.tabId);
        }
    } catch (err) {
        // Silently handle TipTap init failure
    }
}

onMounted(async () => {
    await initializeEditor();
    if (props.paneId && !componentDisposed) {
        registerPaneInput(props.paneId, { setText, focus, triggerSend });
    }
});
watch(trustedEditorRevision, () => {
    if (!componentDisposed) void initializeEditor(true);
});

onBeforeUnmount(() => {
    componentDisposed = true;
    editorBuild++;
    draftRestoreRevision++;
    clearDraftCaptureTimer();
    if (props.tabId) captureDraft(props.tabId);
    else releaseAll();
    try {
        editor.value?.destroy();
    } catch (err) {
        // Silently handle TipTap destroy error
    }
    // With tabs, the draft store owns blob URLs until send/discard/Undo expiry.
    // The legacy host has no draft owner, so it still releases them on unmount.
});

const showModelCatalog = ref(false);
const showKeyModal = ref(false);
const modelCatalogActivated = ref(false);
const keyModalActivated = ref(false);
watch(showModelCatalog, (open) => {
    if (open) modelCatalogActivated.value = true;
});
watch(showKeyModal, (open) => {
    if (open) keyModalActivated.value = true;
});
const settingsPopoverOpen = ref(false);
const promptOwnerId = computed(() => props.tabId ?? props.paneId);
const stagedPromptId = usePanePendingPrompt(promptOwnerId);
const promptSelectionRevision = ref(0);
const promptBadge = ref('');
watch(settingsPopoverOpen, (open) => {
    if (open) promptSelectionRevision.value++;
});
watch(
    () => [props.threadId, stagedPromptId.value, promptSelectionRevision.value],
    async (_value, _oldValue, onCleanup) => {
        let cancelled = false;
        onCleanup(() => {
            cancelled = true;
        });
        try {
            const selection = props.threadId
                ? await getThreadSystemPrompt(props.threadId)
                : stagedPromptId.value;
            let label = '';
            if (selection === DISABLED_PROMPT_SELECTION)
                label = 'Prompt disabled';
            else if (selection && selection !== DEFAULT_PROMPT_SELECTION) {
                const prompt = await getPrompt(selection);
                label = prompt?.title ?? 'Unavailable prompt';
            }
            if (!cancelled) promptBadge.value = label;
        } catch {
            if (!cancelled) promptBadge.value = '';
        }
    },
    { immediate: true }
);
const systemPromptsModal = useSystemPromptsModal();
watch(systemPromptsModal.isOpen, (open) => {
    if (!open) promptSelectionRevision.value++;
});

function openSystemPrompts() {
    systemPromptsModal.open({
        mode: 'home',
        threadId: props.threadId,
        paneId: promptOwnerId.value,
        onSelected: handlePromptSelected,
    });
}

function openSystemPromptsFromSettings() {
    settingsPopoverOpen.value = false;
    openSystemPrompts();
}

function openModelCatalogFromSettings() {
    settingsPopoverOpen.value = false;
    showModelCatalog.value = true;
}

const emit = defineEmits<{
    (
        e: 'send',
        payload: {
            text: string;
            images: UploadedImage[]; // backward compatibility
            attachments: UploadedImage[]; // new unified field
            largeTexts: LargeTextBlock[];
            model: string;
            settings: ImageSettings;
            modelVariant: OpenRouterModelVariant;
            thinkingEnabled: boolean;
            reasoningEffort: string | null;
            editorDoc?: Record<string, unknown>;
            registerResult: RegisterSendResult;
            inspectLossyRequest?: boolean;
            lossyConfirmation?: import('~/utils/chat/lossy-request').LossyRequestPreview;
        }
    ): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
    (e: 'pending-prompt-selected', promptId: string | null): void;
    (e: 'stop-stream'): void; // New event for stopping the stream
    (e: 'resize', payload: { height: number }): void;
    (e: 'cancel-compaction'): void;
}>();

const {
    selectedModel,
    modelVariant,
    thinkingEnabled,
    reasoningEffort,
    modelReasoningEfforts,
    modelDefaultReasoningEffort,
    modelSupportsThinking,
} = useChatModelSelection({
    threadId: () => props.threadId,
    onChange: (modelId) => emit('model-change', modelId),
});

const promptText = ref('');
// Fallback textarea ref (used while TipTap not yet integrated / or fallback active)
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const editor = ref<Editor | null>(null);

const composerActionContext = (): ComposerActionContext => ({
    editor: editor.value as any,
    threadId: props.threadId ?? null,
    paneId: props.paneId ?? null,
    isStreaming: !!props.streaming,
    isMobile: isMobile.value,
    isLoading: !!props.loading,
    compactThread: props.compactThread,
    compactionBlockedReason: props.compactionBlockedReason,
});

const composerActions = useComposerActions(composerActionContext);

async function handleComposerAction(entry: ComposerActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(composerActionContext());
    } catch (error) {
        // Silently handle composer action failure
    }
}

const {
    sendButtonProps,
    stopButtonProps,
    attachButtonProps,
    settingsButtonProps,
    composerActionButtonProps,
    mainContainerProps,
    containerProps,
    editorProps,
    attachmentPdfContainerProps,
    attachmentTextContainerProps,
    attachmentRemoveBtnProps,
    dragOverlayProps,
} = useChatInputTheme(iconClose);

const or3Config = useOr3Config();
const MAX_IMAGES = or3Config.limits.maxFilesPerMessage;
const composerShell = ref<{ rootElement: HTMLElement | null } | null>(null);

const {
    attachments,
    uploadedImages,
    largeTextBlocks,
    dropZoneRef,
    isDragging,
    removeImage,
    removeTextBlock,
    clearAll,
    releaseAll,
    replaceDraft,
    handlePaste,
    openFileDialog,
} = useChatInputAttachments({
    maxFiles: MAX_IMAGES,
    onImageAdd: (attachment) => emit('image-add', attachment),
    onImageRemove: (index) => emit('image-remove', index),
});
const imageSettings = ref<ImageSettings>({
    quality: 'medium',
    numResults: 2,
    size: '1024x1024',
});
const contextPreview = useContextPreview({ threadId: () => props.threadId, model: selectedModel,
    text: promptText, extraText: () => largeTextBlocks.value.map((block) => block.text).join('\n\n'),
    hasMedia: () => attachments.value.length > 0, promptSelection: stagedPromptId,
    revision: () => props.contextRevision });
const compactionInProgress = computed(() => props.compactionState && ['capturing', 'generating', 'correcting', 'committing'].includes(props.compactionState.status));
const compactionModel = computed(() => props.compactionState && 'model' in props.compactionState ? props.compactionState.model : '');
const tabDrafts = useWorkspaceTabDrafts();
const { settings: aiSettings, ensureLoaded: ensureAiSettingsLoaded } =
    useAiSettings();
const restoringDraft = ref(false);
let draftRestoreRevision = 0;
let draftCaptureTimer: ReturnType<typeof setTimeout> | undefined;

function clearDraftCaptureTimer(): void {
    if (draftCaptureTimer) clearTimeout(draftCaptureTimer);
    draftCaptureTimer = undefined;
}

function scheduleDraftCapture(tabId = props.tabId): void {
    if (!tabId || restoringDraft.value) return;
    clearDraftCaptureTimer();
    draftCaptureTimer = setTimeout(() => {
        draftCaptureTimer = undefined;
        captureDraft(tabId);
    }, 120);
}

function captureDraft(tabId = props.tabId): void {
    if (!tabId) return;
    tabDrafts.write(tabId, {
        version: 1,
        text: promptText.value,
        editorJson: editor.value?.getJSON() as Record<string, unknown> | undefined,
        attachments: attachments.value,
        largeTextBlocks: largeTextBlocks.value,
        composer: {
            model: selectedModel.value,
            modelVariant: modelVariant.value,
            thinkingEnabled: thinkingEnabled.value,
            reasoningEffort: reasoningEffort.value,
            imageSettings: { ...imageSettings.value },
        },
        updatedAt: Date.now(),
    });
}

async function restoreDraft(tabId = props.tabId): Promise<void> {
    const revision = ++draftRestoreRevision;
    if (!tabId) {
        restoringDraft.value = false;
        return;
    }
    const draft = tabDrafts.read(tabId);
    restoringDraft.value = true;
    try {
        promptText.value = draft?.text ?? '';
        replaceDraft(draft?.attachments ?? [], draft?.largeTextBlocks ?? []);
        editor.value?.commands.setContent(
            draft?.editorJson ?? draft?.text ?? '',
            { emitUpdate: false }
        );
        if (draft?.composer) {
            selectedModel.value = draft.composer.model;
            // Migrate legacy drafts that stored the web-search toggle.
            modelVariant.value = sanitizeModelVariant(
                draft.composer.modelVariant ??
                    (draft.composer.webSearchEnabled === true
                        ? 'online'
                        : undefined)
            );
            thinkingEnabled.value = draft.composer.thinkingEnabled;
            reasoningEffort.value = draft.composer.reasoningEffort;
            imageSettings.value = { ...draft.composer.imageSettings };
        } else {
            // New chat: apply the dashboard default variant.
            try {
                await ensureAiSettingsLoaded?.();
            } catch {}
            if (
                componentDisposed ||
                revision !== draftRestoreRevision ||
                props.tabId !== tabId
            ) return;
            modelVariant.value = sanitizeModelVariant(
                aiSettings.value?.defaultModelVariant
            );
        }
    } finally {
        await nextTick();
        if (!componentDisposed && revision === draftRestoreRevision) {
            restoringDraft.value = false;
            autoResize();
        }
    }
}

watch(
    () => props.tabId,
    async (next, previous) => {
        clearDraftCaptureTimer();
        if (previous) captureDraft(previous);
        await restoreDraft(next);
    }
);

watch([attachments, largeTextBlocks], () => scheduleDraftCapture(props.tabId), {
    deep: true,
});
watch(
    [selectedModel, modelVariant, thinkingEnabled, reasoningEffort, imageSettings],
    () => scheduleDraftCapture(props.tabId),
    { deep: true }
);

const { imageAttachments, pdfAttachments } =
    useChatAttachmentDisplay(uploadedImages);

// hiddenFileInput removed
// hiddenFileInputListener removed
const showSettingsDropdown = ref(false);

const autoResize = async () => {
    await nextTick();
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
        textareaRef.value.style.height =
            Math.min(textareaRef.value.scrollHeight, 384) + 'px';
    }
};

const handlePromptInput = () => {
    emit('prompt-change', promptText.value);
    autoResize();
};

const triggerFileInput = () => {
    emit('trigger-file-input');
    openFileDialog();
};

/**
 * Focus the editor when clicking on non-interactive areas of the container.
 * This makes the entire chat input container feel clickable.
 */
const handleContainerClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target) return;

    // List of interactive elements that should NOT trigger focus
    const interactiveTags = [
        'BUTTON',
        'INPUT',
        'TEXTAREA',
        'SELECT',
        'A',
        'LABEL',
    ];
    const interactiveRoles = [
        'button',
        'link',
        'menuitem',
        'option',
        'tab',
        'textbox',
        'combobox',
        'listbox',
    ];

    // Check if the clicked element or any of its ancestors is interactive
    let el: HTMLElement | null = target;
    while (el && el !== dropZoneRef.value) {
        // Check tag name
        if (interactiveTags.includes(el.tagName)) return;
        // Check role attribute
        const role = el.getAttribute('role');
        if (role && interactiveRoles.includes(role)) return;
        // Check if it's a TipTap/ProseMirror editor content (already handles its own focus)
        if (
            el.classList.contains('ProseMirror') ||
            el.classList.contains('tiptap')
        )
            return;
        // Check contenteditable
        if (el.isContentEditable) return;
        // Check for click handlers via data attributes (some UI libraries use these)
        if (el.hasAttribute('data-radix-collection-item')) return;
        el = el.parentElement;
    }

    // Focus the editor
    if (editor.value) {
        editor.value.commands.focus('end');
    }
};

const sendBlock = shallowRef<Extract<SendResult, { status: 'rejected' | 'failed' }>>();
const lossyPreview = shallowRef<import('~/utils/chat/lossy-request').LossyRequestPreview>();
const stopContextWorkspace = subscribeActiveWorkspaceDb(() => { sendBlock.value = undefined; lossyPreview.value = undefined; });
onBeforeUnmount(stopContextWorkspace);
watch(() => [props.threadId, props.contextRevision, selectedModel.value, modelVariant.value,
    thinkingEnabled.value, reasoningEffort.value, promptText.value, attachments.value, largeTextBlocks.value],
    () => { sendBlock.value = undefined; lossyPreview.value = undefined; });
async function handleSend(decision: { inspectLossyRequest?: boolean; lossyConfirmation?: import('~/utils/chat/lossy-request').LossyRequestPreview } = {}): Promise<SendResult> {
    const result = await performSend(decision);
    if ((result.status === 'rejected' || result.status === 'failed') && ['context_full', 'model_metadata_unavailable', 'invalid_context_limit', 'invalid_output_limit'].includes(result.reason)) {
        sendBlock.value = result;
        if (result.status === 'rejected') lossyPreview.value = result.lossyPreview;
    }
    return result;
}
const performSend = async (decision: { inspectLossyRequest?: boolean; lossyConfirmation?: import('~/utils/chat/lossy-request').LossyRequestPreview }): Promise<SendResult> => {
    if (props.loading) return { status: 'rejected', reason: 'busy' };
    if (
        !guardPendingAttachmentSend(attachments.value, toast, {
            description: 'Please wait for attachments to finish before sending.',
            duration: 2600,
        })
    ) {
        return { status: 'rejected', reason: 'client_limit' };
    }
    // Require OpenRouter connection (api key) before sending
    if (!apiKey.value && !hasInstanceKey.value) {
        if (!allowUserOverride.value) {
            toast.add({
                title: 'Instance key required',
                description:
                    'This deployment requires a managed OpenRouter key. Contact your administrator.',
                color: 'primary',
                duration: 5000,
            });
            return { status: 'rejected', reason: 'missing_credentials' };
        }
        // Show toast with action to initiate login
        toast.add({
            id: 'need-openrouter-login',
            title: 'Connect to OpenRouter',
            description: 'You need an OpenRouter API key to send messages.',
            color: 'primary',
            duration: 8000,
            actions: [
                {
                    label: 'Connect',
                    onClick: () => startLogin(),
                    size: 'sm',
                },
                {
                    label: 'Paste a key',
                    onClick: () => {
                        showKeyModal.value = true;
                    },
                    size: 'sm',
                    variant: 'link',
                },
            ],
        });
        return { status: 'rejected', reason: 'missing_credentials' };
    }
    if (
        promptText.value.trim() ||
        uploadedImages.value.length > 0 ||
        largeTextBlocks.value.length > 0
    ) {
        // Provide the current editor JSON to hooks so downstream filters (mentions)
        // can extract structured mentions before the text is flattened.
        const editorDoc = editor.value?.getJSON?.();
        const submittedEditorDoc = editorDoc ? structuredClone(editorDoc) : undefined;
        const submittedText = promptText.value;
        const submittedAttachments = attachments.value.slice();
        const submittedLargeTexts = largeTextBlocks.value.slice();
        const submittedTabId = props.tabId; const submittedThreadId = props.threadId;
        const submittedWorkspaceGeneration = getWorkspaceGeneration();
        try {
            const json = submittedEditorDoc ? structuredClone(submittedEditorDoc) : undefined;
            // Fire as an action to avoid transforming data; listeners can stash it
            if (json && !decision.inspectLossyRequest) {
                await hooks.doAction('ui.chat.editor:action:before_send', json);
            }
        } catch (e) {
            // Silently handle editor JSON dispatch failure
        }

        let sendResult: Promise<SendResult> | null = null;
        let durableAcceptance: Promise<SendResult> | null = null;
        emit('send', {
            ...decision,
            editorDoc: submittedEditorDoc,
            text: promptText.value,
            images: attachments.value, // backward compatibility
            attachments: attachments.value, // new unified field
            largeTexts: largeTextBlocks.value,
            model: selectedModel.value,
            settings: imageSettings.value,
            modelVariant: modelVariant.value,
            thinkingEnabled:
                thinkingEnabled.value && modelSupportsThinking.value,
            reasoningEffort:
                thinkingEnabled.value && modelSupportsThinking.value
                    ? reasoningEffort.value ?? null
                    : null,
            registerResult: (result, acceptance = result) => {
                sendResult = result;
                durableAcceptance = acceptance;
            },
        });
        // A parent that cannot accept the request leaves the draft untouched.
        if (!sendResult) {
            return {
                status: 'failed',
                requestId: 'composer-send',
                reason: 'stream_error',
                error: 'No chat submission handler accepted the request.',
            };
        }
        let acceptance: SendResult;
        try {
            acceptance = await (durableAcceptance ?? sendResult);
        } catch (error) {
            return {
                status: 'failed',
                requestId: 'composer-send',
                reason: 'stream_error',
                error: error instanceof Error ? error.message : String(error),
            };
        }
        if (!hasDurableSendAcceptance(acceptance) || acceptance.status === 'failed' || acceptance.status === 'aborted') return acceptance;
        // Admission can await model/server preparation while the user edits or
        // navigates. Clear only the exact submitted draft in its owning view.
        if (getWorkspaceGeneration() !== submittedWorkspaceGeneration || props.tabId !== submittedTabId
            || submittedThreadId && props.threadId !== submittedThreadId || promptText.value !== submittedText
            || JSON.stringify(editor.value?.getJSON?.()) !== JSON.stringify(submittedEditorDoc)
            || attachments.value.length !== submittedAttachments.length || attachments.value.some((row, index) => row !== submittedAttachments[index])
            || largeTextBlocks.value.length !== submittedLargeTexts.length || largeTextBlocks.value.some((row, index) => row !== submittedLargeTexts[index])) {
            return await sendResult;
        }
        clearDraftCaptureTimer();
        tabDrafts.discard(props.tabId);
        // Reset local state and editor content so placeholder shows again
        promptText.value = '';
        try {
            editor.value?.commands.clearContent();
        } catch (e) {
            // noop
        }
        // Release any blob URLs to avoid leaking when clearing attachments
        clearAll();
        autoResize();
        try {
            return await sendResult;
        } catch (error) {
            return {
                status: 'failed',
                requestId: 'composer-send',
                reason: 'stream_error',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    return { status: 'rejected', reason: 'filtered' };
};

function handleSendClick(): void {
    void handleSend();
}

// Imperative bridge API (used by programmatic pane plugin sends)
function setText(t: string) {
    promptText.value = t;
    try {
        if (editor.value) {
            editor.value.commands.setContent(t, { emitUpdate: true });
        }
    } catch {}
    autoResize();
}
function focus() {
    editor.value?.commands.focus('end');
}
function triggerSend(): Promise<SendResult> {
    return handleSend();
}
defineExpose({ setText, focus, triggerSend });

onBeforeUnmount(() => {
    if (props.paneId) unregisterPaneInput(props.paneId);
});

const handlePromptSelected = (id: string) => {
    promptSelectionRevision.value++;
    if (!props.threadId) emit('pending-prompt-selected', id);
};

// Emit live height via useResizeObserver (VueUse handles cleanup automatically)
import { useResizeObserver } from '@vueuse/core';

const componentRootRef = ref<HTMLElement | null>(null);
let lastHeight: number | null = null;

const readEntryHeight = (entry: ResizeObserverEntry): number | null => {
    const target = entry.target as HTMLElement;
    const borderSize = Array.isArray(entry.borderBoxSize)
        ? entry.borderBoxSize[0]
        : entry.borderBoxSize;
    if (borderSize && typeof borderSize.blockSize === 'number') {
        return borderSize.blockSize;
    }
    if (entry.contentRect && typeof entry.contentRect.height === 'number') {
        return entry.contentRect.height;
    }
    // Fallback – should rarely run, but keeps behavior consistent if box sizes unavailable
    return target?.offsetHeight ?? null;
};

onMounted(() => {
    dropZoneRef.value = composerShell.value?.rootElement ?? null;
    const inst = getCurrentInstance();
    const rootEl = inst?.proxy?.$el;
    // Hydration-mismatch recovery can leave $el pointing at a bare text
    // node; ResizeObserver only accepts Element targets, so fall back to
    // the composer shell's root element in that case.
    componentRootRef.value =
        rootEl instanceof HTMLElement
            ? rootEl
            : (composerShell.value?.rootElement ?? null);
});

if (import.meta.client) {
    useResizeObserver(componentRootRef, (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const nextHeight = readEntryHeight(entry);
        if (nextHeight == null) return;
        // Round to whole px so we don't emit micro-deltas that cause extra renders
        const normalized = Math.round(nextHeight);
        if (lastHeight === normalized) return;
        lastHeight = normalized;
        emit('resize', { height: normalized });
    });
}
</script>

<style scoped src="./ChatInputDropper.css"></style>
