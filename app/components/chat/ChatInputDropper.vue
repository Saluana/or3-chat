<template>
    <div
        id="chat-input-main"
        ref="dropZoneRef"
        :class="[
            'chat-input-main flex flex-col bg-(--md-surface) mx-2 md:mx-0 items-stretch transition-all duration-300 relative cursor-text z-10',
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
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="chat-input-editor-container max-h-40 md:max-h-96 w-full overflow-y-auto wrap-break-word min-h-4 md:min-h-12"
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
                        <UPopover class="chat-input-settings-popover">
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
                                    v-model:model="selectedModel"
                                    v-model:web-search-enabled="
                                        webSearchEnabled
                                    "
                                    @open-system-prompts="
                                        showSystemPrompts = true
                                    "
                                    @open-model-catalog="
                                        showModelCatalog = true
                                    "
                                />
                            </template>
                        </UPopover>
                    </div>
                </div>

                <div
                    class="chat-input-composer-actions flex items-center gap-1 shrink-0"
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
                            :color="entry.action.color || 'neutral'"
                            :square="!entry.action.label"
                            :disabled="entry.disabled"
                            :aria-label="
                                entry.action.tooltip ||
                                entry.action.label ||
                                entry.action.id
                            "
                            @click="() => handleComposerAction(entry)"
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
                    <LazyChatModelSelect
                        hydrate-on-interaction="focus"
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
                        @click="handleSend"
                        :disabled="
                            loading ||
                            (!promptText.trim() && uploadedImages.length === 0)
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
            class="chat-input-attachments mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <!-- Images -->
            <div
                v-for="(image, index) in uploadedImages.filter(
                    (att) => att.kind === 'image'
                )"
                :key="'img-' + index"
                class="chat-input-attachment-image-container relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="chat-input-attachment-image w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <UButton
                    v-bind="attachmentRemoveBtnProps"
                    @click="() => removeImage(uploadedImages.indexOf(image))"
                    :disabled="loading"
                    aria-label="Remove image"
                />
                <div
                    class="chat-input-attachment-image-name absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[11px] p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
            </div>
            <!-- PDFs -->
            <div
                v-for="(pdf, index) in uploadedImages.filter(
                    (att) => att.kind === 'pdf'
                )"
                :key="'pdf-' + index"
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
                    @click="() => removeImage(uploadedImages.indexOf(pdf))"
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
        <lazy-modal-model-catalog v-model:showModal="showModelCatalog" />
        <LazyChatSystemPromptsModal
            hydrate-on-visible
            v-model:showModal="showSystemPrompts"
            :thread-id="props.threadId"
            :pane-id="props.paneId"
            @selected="handlePromptSelected"
            @closed="handlePromptModalClosed"
        />
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    nextTick,
    onMounted,
    onBeforeUnmount,
    watch,
    getCurrentInstance,
} from 'vue';
import { MAX_FILES_PER_MESSAGE } from '../../utils/files-constants';
import { reportError, err } from '~/utils/errors';
import { validateFile, persistAttachment } from './file-upload-utils';
import type { FileMeta } from '~/db/schema';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { Extension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { computed } from 'vue';
import { isMobile, state } from '~/state/global';
import {
    useToast,
    useUserApiKey,
    useOpenRouterAuth,
    useModelStore,
    useAiSettings,
} from '#imports';
import {
    useComposerActions,
    type ComposerActionEntry,
    type ComposerActionContext,
} from '#imports';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useButtonOverrides } from '~/composables/useTypedThemeOverrides';
import { useIcon } from '~/composables/useIcon';
import { useFileDialog, useDropZone, useLocalStorage } from '@vueuse/core';

const props = defineProps<{
    loading?: boolean;
    containerWidth?: number;
    threadId?: string;
    streaming?: boolean; // assistant response streaming
    paneId?: string; // provided by ChatContainer so the bridge can key this input
}>();

const iconLoading = useIcon('ui.loading');
const iconAttach = useIcon('chat.attach');
const iconModelSettings = useIcon('chat.model.settings');
const iconSend = useIcon('chat.send');
const iconStop = useIcon('chat.stop');
const iconUpload = useIcon('chat.upload');
const iconClose = useIcon('ui.close');

const { favoriteModels, getFavoriteModels } = useModelStore();
const { settings: aiSettings } = useAiSettings();
const webSearchEnabled = ref<boolean>(false);
const LAST_MODEL_KEY = 'last_selected_model';

// Use VueUse's useLocalStorage for persisted model selection
const persistedModel = useLocalStorage<string>(
    LAST_MODEL_KEY,
    'openai/gpt-oss-120b'
);

const suppressPersist = ref(false);

onMounted(async () => {
    const fave = await getFavoriteModels();
    // Favorite models loaded (log removed)
    if (process.client) {
        // Initialize selectedModel from persistedModel
        if (persistedModel.value) {
            selectedModel.value = persistedModel.value;
        }
        // If this is a brand-new chat (no threadId), honor fixed default from AI settings for initial display
        if (!props.threadId) {
            const set = aiSettings.value;
            const fixed =
                set?.defaultModelMode === 'fixed' ? set?.fixedModelId : null;
            if (fixed) {
                suppressPersist.value = true; // don't clobber last_selected_model on initial display
                selectedModel.value = fixed;
            }
        }
    }
});

onMounted(async () => {
    if (!process.client) return;
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
        const hooks = useHooks();
        await hooks.doAction('editor:request-extensions');

        // Allow plugins to add editor extensions via filter
        try {
            const filtered = await hooks.applyFilters(
                'ui.chat.editor:filter:extensions',
                extensions
            );
            if (Array.isArray(filtered)) {
                const next: Array<Extension | Node> = [];
                for (const item of filtered) {
                    // Accept both Extension and Node types (WorkflowNode is a Node)
                    if (item instanceof Extension || item instanceof Node)
                        next.push(item);
                }
                if (next.length) extensions = next;
            }
        } catch {}

        editor.value = new Editor({
            extensions,
            editorProps: {
                attributes: {
                    'aria-label': 'Message input',
                    role: 'textbox',
                },
            },
            onUpdate: ({ editor: ed }) => {
                promptText.value = ed.getText();
                autoResize();
            },
            onPaste: (event) => {
                handlePaste(event);
            },
            content: '',
        });
    } catch (err) {
        // Silently handle TipTap init failure
    }
});

onBeforeUnmount(() => {
    try {
        editor.value?.destroy();
    } catch (err) {
        // Silently handle TipTap destroy error
    }
    // Cleanup hidden file input logic removed (useFileDialog handles it)
    attachments.value.forEach(releaseAttachment);
});

// When starting a brand-new chat (threadId becomes falsy), honor fixed default from settings
watch(
    () => props.threadId,
    (tid) => {
        if (tid) return; // only when there is no thread yet (new chat)
        try {
            const set = aiSettings.value;
            if (set?.defaultModelMode === 'fixed' && set?.fixedModelId) {
                suppressPersist.value = true;
                selectedModel.value = set.fixedModelId;
            }
        } catch {}
    }
);

interface UploadedImage {
    file: File;
    url: string; // data URL preview
    name: string;
    hash?: string; // content hash after persistence
    status: 'pending' | 'ready' | 'error';
    error?: string;
    meta?: FileMeta;
    mime: string;
    kind: 'image' | 'pdf';
}

interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

const showModelCatalog = ref(false);
const showSystemPrompts = ref(false);

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
            webSearchEnabled: boolean;
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
}>();

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

// Theme overrides for buttons
const sendButtonProps = useButtonOverrides(
    { component: 'button', context: 'chat', identifier: 'chat.send' },
    {
        square: true,
        size: 'sm',
        color: 'primary',
        variant: 'solid',
        class: 'theme-btn disabled:opacity-40 text-white dark:text-black flex items-center justify-center',
    }
);

const stopButtonProps = useButtonOverrides(
    { component: 'button', context: 'chat', identifier: 'chat.stop' },
    {
        square: true,
        size: 'sm',
        color: 'error',
        variant: 'solid',
        class: 'theme-btn flex items-center justify-center text-[var(--md-on-error)] bg-[var(--md-error)]! hover:bg-[var(--md-error-hover)]! active:bg-[var(--md-error-active)]!',
    }
);

const attachButtonProps = useButtonOverrides(
    { component: 'button', context: 'chat', identifier: 'chat.attach' },
    {
        square: true,
        size: 'sm',
        color: 'info',
        class: 'theme-btn text-black dark:text-white flex items-center justify-center',
    }
);

const settingsButtonProps = useButtonOverrides(
    { component: 'button', context: 'chat', identifier: 'chat.settings' },
    {
        square: true,
        size: 'sm',
        color: 'info',
    }
);

const composerActionButtonProps = useButtonOverrides(
    {
        component: 'button',
        context: 'chat',
        identifier: 'chat.composer-action',
    },
    {
        size: 'sm',
        variant: 'ghost',
        class: 'theme-btn pointer-events-auto flex items-center gap-1',
        ui: { base: 'theme-btn' },
    }
);

const mainContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.input-main-container',
        isNuxtUI: false,
    });

    return overrides.value;
});

const containerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.input-container',
        isNuxtUI: false,
    });

    return overrides.value;
});

const editorProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.editor',
        isNuxtUI: false,
    });

    return overrides.value;
});

const attachmentPdfContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.attachment-pdf-container',
        isNuxtUI: false,
    });
    return overrides.value;
});

const attachmentTextContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.attachment-text-container',
        isNuxtUI: false,
    });
    return overrides.value;
});

const attachmentRemoveBtnProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'chat',
        identifier: 'chat.attachment-remove-btn',
        isNuxtUI: true,
    });
    const fallback = {
        type: 'button' as const,
        color: 'error' as const,
        variant: 'solid' as const,
        size: 'xs' as const,
        square: true as const,
        icon: iconClose.value,
        class: 'chat-input-attachment-remove-btn flex items-center justify-center absolute top-1 right-1 h-[22px] w-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white bg-[var(--md-error)]/85 hover:bg-[var(--md-error)]',
    };
    const overrideValue = (overrides.value as Record<string, unknown>) || {};
    const overrideClass =
        typeof overrideValue.class === 'string' ? overrideValue.class : '';
    const mergedClass = [fallback.class, overrideClass]
        .filter(Boolean)
        .join(' ');
    return {
        ...fallback,
        ...overrideValue,
        class: mergedClass,
    };
});

const dragOverlayProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'chat',
        identifier: 'chat.drag-overlay',
        isNuxtUI: false,
    });
    return overrides.value;
});

const attachments = ref<UploadedImage[]>([]);
// Backward compatibility: expose as uploadedImages for template
const uploadedImages = computed(() => attachments.value);
// Large pasted text blocks (> threshold)
interface LargeTextBlock {
    id: string;
    text: string;
    wordCount: number;
    preview: string;
    previewFull: string;
}
const largeTextBlocks = ref<LargeTextBlock[]>([]);
const LARGE_TEXT_WORD_THRESHOLD = 600;
function makeId() {
    return Math.random().toString(36).slice(2, 9);
}
const isDragging = ref(false);
const selectedModel = ref<string>('openai/gpt-oss-120b');
// hiddenFileInput removed
// hiddenFileInputListener removed
const imageSettings = ref<ImageSettings>({
    quality: 'medium',
    numResults: 2,
    size: '1024x1024',
});
const showSettingsDropdown = ref(false);

watch(selectedModel, (newModel) => {
    emit('model-change', newModel);
    if (process.client) {
        if (suppressPersist.value) {
            // Skip one-time persist when we programmatically set from settings
            suppressPersist.value = false;
            return;
        }
        // Persist via useLocalStorage
        persistedModel.value = newModel;
    }
});

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

const handlePaste = async (event: ClipboardEvent) => {
    const cd = event.clipboardData;
    if (!cd) return;
    // 1. Handle images and PDFs first (extended behavior)
    const items = cd.items;
    let handled = false;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        const mime = it.type || '';
        if (mime.startsWith('image/') || mime === 'application/pdf') {
            event.preventDefault();
            handled = true;
            const file = it.getAsFile();
            if (!file) continue;
            await processAttachment(
                file,
                file.name ||
                    `pasted-${
                        mime.startsWith('image/') ? 'image' : 'pdf'
                    }-${Date.now()}.${
                        mime === 'application/pdf' ? 'pdf' : 'png'
                    }`
            );
        }
    }
    if (handled) return; // skip text path if attachment already captured

    // 2. Large text detection
    const text = cd.getData('text/plain');
    if (!text) return; // allow normal behavior
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount >= LARGE_TEXT_WORD_THRESHOLD) {
        // Prevent the heavy text from entering the rich-text editor (lag source)
        event.preventDefault();
        event.stopPropagation();
        const prev = editor.value ? editor.value.getText() : '';
        const previewFull = text.slice(0, 800).trim();
        const preview =
            previewFull.split(/\s+/).slice(0, 12).join(' ') +
            (wordCount > 12 ? '…' : '');
        largeTextBlocks.value.push({
            id: makeId(),
            text,
            wordCount,
            preview,
            previewFull,
        });
        // TipTap may still stage an insertion despite preventDefault in some edge cases;
        // restore previous content on next tick to be safe.
        nextTick(() => {
            try {
                if (editor.value)
                    editor.value.commands.setContent(prev, {
                        emitUpdate: false,
                    });
            } catch {}
        });
    }
};

const {
    files: selectedFiles,
    open,
    reset: resetFileDialog,
} = useFileDialog({
    accept: 'image/*,application/pdf',
    multiple: true,
});

watch(selectedFiles, (files) => {
    if (files) {
        processFiles(files);
        resetFileDialog();
    }
});

const triggerFileInput = () => {
    emit('trigger-file-input');
    open();
};

const MAX_IMAGES = MAX_FILES_PER_MESSAGE;

function makePreviewUrl(file: File): string {
    try {
        return URL.createObjectURL(file);
    } catch {
        return '';
    }
}
function releaseAttachment(attachment: UploadedImage) {
    try {
        if (attachment.url && attachment.url.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.url);
        }
    } catch {
        /* noop */
    }
}

async function processAttachment(file: File, name?: string) {
    const mime = file.type || '';
    const validation = validateFile(file);
    if (!validation.ok) {
        reportError(err(validation.code, validation.message), {
            toast: true,
            tags: { domain: 'files', stage: 'select', mime, size: file.size },
        });
        return;
    }
    const kind = validation.kind;
    if (attachments.value.length >= MAX_IMAGES) return;
    const previewUrl = makePreviewUrl(file);
    const attachment: UploadedImage = {
        file,
        url: previewUrl,
        name: name || file.name,
        status: 'pending',
        mime,
        kind,
    };
    attachments.value.push(attachment);
    emit('image-add', attachment);
    await persistAttachment(attachment);
}

const processFiles = async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        if (attachments.value.length >= MAX_IMAGES) break;
        const file = files[i];
        if (!file) continue;
        await processAttachment(file);
    }
};

// handleFileChange removed (replaced by useFileDialog watcher)

const dropZoneRef = ref<HTMLElement | null>(null);

function onDropZoneDrop(files: File[] | null) {
    if (files && files.length > 0) {
        // Process each file directly
        for (const file of files) {
            processAttachment(file);
        }
    }
}

const { isOverDropZone } = useDropZone(dropZoneRef, {
    onDrop: onDropZoneDrop,
    dataTypes: (types) => {
        // Accept images and PDFs
        return types.some(
            (t) =>
                t.startsWith('image/') ||
                t === 'application/pdf' ||
                t === 'Files'
        );
    },
});

// Use isOverDropZone directly for UI state instead of isDragging for drop zone
// Keep isDragging for backward compatibility with other parts
watch(
    isOverDropZone,
    (v) => {
        isDragging.value = v;
    },
    { immediate: true }
);

// Legacy handlers kept as no-ops since useDropZone handles everything
const handleDrop = (event: DragEvent) => {
    // useDropZone handles this
};

const onDragOver = (event: DragEvent) => {
    // useDropZone handles this
};

const onDragLeave = (event: DragEvent) => {
    // useDropZone handles this
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

const removeImage = (index: number) => {
    const [removed] = attachments.value.splice(index, 1);
    if (removed) releaseAttachment(removed);
    emit('image-remove', index);
};

const removeTextBlock = (index: number) => {
    largeTextBlocks.value.splice(index, 1);
};

const handleSend = async () => {
    if (props.loading) return;
    // Block send while attachments are still hashing to avoid silent loss.
    const pendingAttachments = attachments.value.some(
        (att) => att.status === 'pending'
    );
    if (pendingAttachments) {
        useToast().add({
            title: 'Files are still uploading',
            description:
                'Please wait for attachments to finish before sending.',
            color: 'primary',
            duration: 2600,
        });
        return;
    }
    // Require OpenRouter connection (api key) before sending
    const { apiKey } = useUserApiKey();
    if (!apiKey.value) {
        const { startLogin } = useOpenRouterAuth();
        // Show toast with action to initiate login
        useToast().add({
            id: 'need-openrouter-login',
            title: 'Connect to OpenRouter',
            description: 'You need to log in before sending messages.',
            color: 'primary',
            duration: 5000,
            actions: [
                {
                    label: 'Login',
                    onClick: () => startLogin(),
                    size: 'sm',
                },
                {
                    label: 'Manually enter key',
                    onClick: (toast) => {
                        const apiKey = prompt(
                            'Please enter your OpenRouter API key:'
                        );

                        if (apiKey && apiKey.trim()) {
                            // Save the API key
                            state.value.openrouterKey = apiKey.trim();
                        }
                    },
                    size: 'sm',
                    variant: 'link',
                },
            ],
        });
        return;
    }
    if (
        promptText.value.trim() ||
        uploadedImages.value.length > 0 ||
        largeTextBlocks.value.length > 0
    ) {
        // Provide the current editor JSON to hooks so downstream filters (mentions)
        // can extract structured mentions before the text is flattened.
        try {
            const hooks = useHooks();
            const json = editor.value?.getJSON?.();
            // Fire as an action to avoid transforming data; listeners can stash it
            if (json) {
                await hooks.doAction('ui.chat.editor:action:before_send', json);
            }
        } catch (e) {
            // Silently handle editor JSON dispatch failure
        }

        emit('send', {
            text: promptText.value,
            images: attachments.value, // backward compatibility
            attachments: attachments.value, // new unified field
            largeTexts: largeTextBlocks.value,
            model: selectedModel.value,
            settings: imageSettings.value,
            webSearchEnabled: webSearchEnabled.value,
        });
        // Reset local state and editor content so placeholder shows again
        promptText.value = '';
        try {
            editor.value?.commands.clearContent();
        } catch (e) {
            // noop
        }
        // Release any blob URLs to avoid leaking when clearing attachments
        attachments.value.forEach(releaseAttachment);
        attachments.value = [];
        largeTextBlocks.value = [];
        autoResize();
    }
};

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
function triggerSend() {
    handleSend();
}
defineExpose({ setText, triggerSend });

onMounted(() => {
    if (props.paneId) {
        registerPaneInput(props.paneId, { setText, triggerSend });
    }
});
onBeforeUnmount(() => {
    if (props.paneId) unregisterPaneInput(props.paneId);
});

const handlePromptSelected = (id: string) => {
    if (!props.threadId) emit('pending-prompt-selected', id);
};

const handlePromptModalClosed = () => {
    /* modal closed */
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
    const inst = getCurrentInstance();
    componentRootRef.value = (inst?.proxy?.$el as HTMLElement) || null;
});

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
</script>

<style scoped>
/* Custom scrollbar for textarea */
/* Firefox */
textarea {
    scrollbar-width: thin;
    scrollbar-color: var(--md-primary) transparent;
}

/* WebKit */
textarea::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

textarea::-webkit-scrollbar-track {
    background: transparent;
}

textarea::-webkit-scrollbar-thumb {
    background: var(--md-primary);
    border-radius: 9999px;
}

textarea::-webkit-scrollbar-thumb:hover {
    background: color-mix(in oklab, var(--md-primary) 85%, black);
}

/* Focus states */
.group:hover .opacity-0 {
    opacity: 1;
}

/* Smooth transitions */
* {
    transition-property: color, background-color, border-color, opacity,
        transform;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
}

/* ProseMirror (TipTap) base styles */
/* TipTap base */
.prosemirror-host :deep(.ProseMirror) {
    outline: none;
    white-space: pre-wrap;
    min-height: 100%;
    width: 100%;
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}
.prosemirror-host {
    display: block;
    min-height: 3.5rem;
    width: 100%;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child) {
    position: relative;
}
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    /* Use design tokens; ensure sufficient contrast in dark mode */
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 30%);
    content: attr(data-placeholder);
    pointer-events: none;
    opacity: 0.85; /* increase for dark background readability */
    font-weight: normal;
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: 0;
}

/* Mention token styling inside the TipTap editor */
.prosemirror-host :deep(.mention) {
    background: var(--ui-bg-muted, #f3f4f6);
    color: var(--ui-text-highlighted, #1e40af);
    border-radius: 4px;
    padding: 0.125rem 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
}
.prosemirror-host :deep(.mention:hover) {
    background: var(--ui-bg-muted-hover, #e5e7eb);
}
.prosemirror-host :deep(.mention::before) {
    content: '📎';
    margin-right: 0.25rem;
    font-size: 0.875em;
}

/* Workflow tag styling inside the TipTap editor */
.prosemirror-host :deep(.workflow-tag) {
    background: var(--md-info, #e0e0ff);
    color: var(--md-on-tertiary-container, #1a1a66);
    border-radius: 4px;
    padding: 0.125rem 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
}

.prosemirror-host :deep(.workflow-tag::before) {
    content: '⚡';
    margin-right: 0.25rem;
    font-size: 0.875em;
}
</style>
