<template>
    <div
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="handleDrop"
        :class="[
            'flex flex-col bg-(--md-surface)  border-2 border-(--md-inverse-surface) mx-2 md:mx-0 items-stretch transition-all duration-300 relative retro-shadow hover:shadow-xl focus-within:shadow-xl cursor-text z-10 rounded-[3px]',
            isDragging
                ? 'border-(--app-dropzone-active-border) bg-(--app-dropzone-active-bg)'
                : 'hover:border-(--md-primary) focus-within:border-(--md-primary)',
            loading ? 'opacity-90 pointer-events-auto' : '',
        ]"
    >
        <div class="flex flex-col gap-3.5 m-3.5">
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="max-h-[160px] md:max-h-96 w-full overflow-y-auto break-words min-h-[1rem] md:min-h-[3rem]"
                >
                    <!-- TipTap Editor -->
                    <EditorContent
                        :editor="editor as Editor"
                        class="prosemirror-host"
                    ></EditorContent>

                    <div
                        v-if="loading"
                        class="absolute top-1 right-1 flex items-center gap-2"
                    >
                        <UIcon
                            name="pixelarticons:loader"
                            class="w-4 h-4 animate-spin opacity-70"
                        />
                    </div>
                </div>
            </div>

            <!-- Bottom Controls -->
            <div class="flex gap-2.5 w-full items-center">
                <div
                    class="relative flex-1 flex items-center gap-2 shrink min-w-0"
                >
                    <!-- Attachment Button -->
                    <div class="relative shrink-0">
                        <UButton
                            @click="triggerFileInput"
                            :square="true"
                            size="sm"
                            color="info"
                            class="retro-btn flex items-center justify-center"
                            type="button"
                            aria-label="Add attachments"
                            :disabled="loading"
                            :ui="{
                                leadingIcon: 'text-[var(--md-on-primary)]',
                            }"
                        >
                            <UIcon name="i-lucide:plus" class="w-4 h-4" />
                        </UButton>
                    </div>

                    <!-- Settings Button (stub) -->
                    <div class="relative shrink-0">
                        <UPopover id="chat-input-settings-popover">
                            <UButton
                                label="Open"
                                :square="true"
                                size="sm"
                                color="info"
                                class="retro-btn flex items-center justify-center"
                                type="button"
                                aria-label="Settings"
                                :disabled="loading"
                            >
                                <UIcon
                                    name="pixelarticons:sliders"
                                    class="w-4 h-4"
                                />
                            </UButton>
                            <template #content>
                                <div class="flex flex-col w-[320px]">
                                    <!-- Model Selector extracted -->
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2"
                                    >
                                        <LazyChatModelSelect
                                            hydrate-on-interaction="focus"
                                            v-if="
                                                containerWidth &&
                                                containerWidth < 400
                                            "
                                            v-model:model="selectedModel"
                                            :loading="loading"
                                            class="w-full!"
                                        />
                                    </div>
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2 border-b"
                                    >
                                        <USwitch
                                            color="primary"
                                            label="Enable web search"
                                            class="w-full"
                                            v-model="webSearchEnabled"
                                        ></USwitch>
                                        <UIcon
                                            name="pixelarticons:visible"
                                            class="w-4 h-4"
                                        />
                                    </div>
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2 border-b"
                                    >
                                        <USwitch
                                            color="primary"
                                            label="Enable thinking"
                                            class="w-full"
                                        ></USwitch>
                                        <UIcon
                                            name="pixelarticons:lightbulb-on"
                                            class="w-4 h-4"
                                        />
                                    </div>

                                    <!-- Tool Toggles Section -->
                                    <div
                                        v-if="registeredTools.length > 0"
                                        class="border-b"
                                    >
                                        <div
                                            v-for="tool in registeredTools"
                                            :key="tool.name"
                                            class="flex flex-col py-1 px-2"
                                        >
                                            <div
                                                class="flex justify-between w-full items-center"
                                            >
                                                <USwitch
                                                    color="primary"
                                                    :label="
                                                        tool.definition.ui
                                                            ?.label ||
                                                        tool.definition.function
                                                            .name
                                                    "
                                                    class="w-full"
                                                    :model-value="
                                                        tool.enabledValue
                                                    "
                                                    @update:model-value="(val: boolean) => {
                                                        toolRegistry.setEnabled(tool.name, val);
                                                    }"
                                                    :disabled="
                                                        loading ||
                                                        props.streaming
                                                    "
                                                    :aria-describedby="`tool-desc-${tool.name}`"
                                                ></USwitch>
                                                <UIcon
                                                    v-if="
                                                        tool.definition.ui?.icon
                                                    "
                                                    :name="
                                                        tool.definition.ui.icon
                                                    "
                                                    class="w-4 h-4"
                                                />
                                                <UIcon
                                                    v-else
                                                    name="pixelarticons:wrench"
                                                    class="w-4 h-4"
                                                />
                                            </div>
                                            <p
                                                v-if="
                                                    tool.definition.ui
                                                        ?.descriptionHint ||
                                                    tool.definition.function
                                                        .description
                                                "
                                                :id="`tool-desc-${tool.name}`"
                                                class="text-xs opacity-70 mt-0.5 px-1"
                                            >
                                                {{
                                                    tool.definition.ui
                                                        ?.descriptionHint ||
                                                    tool.definition.function
                                                        .description
                                                }}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 border-b cursor-pointer"
                                        @click="showSystemPrompts = true"
                                    >
                                        <span class="px-1">System prompts</span>
                                        <UIcon
                                            name="pixelarticons:script-text"
                                            class="w-4 h-4"
                                        />
                                    </button>
                                    <button
                                        @click="showModelCatalog = true"
                                        class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 rounded-[3px] cursor-pointer"
                                    >
                                        <span class="px-1">Model Catalog</span>
                                        <UIcon
                                            name="pixelarticons:android"
                                            class="w-4 h-4"
                                        />
                                    </button>
                                </div>
                            </template>
                        </UPopover>
                    </div>
                </div>

                <div
                    v-if="composerActions.length"
                    class="flex items-center gap-1 shrink-0"
                >
                    <UTooltip
                        v-for="entry in composerActions"
                        :key="`composer-action-${entry.action.id}`"
                        :delay-duration="0"
                        :text="entry.action.tooltip || entry.action.label"
                    >
                        <UButton
                            size="sm"
                            variant="ghost"
                            :color="(entry.action.color || 'neutral') as any"
                            :square="!entry.action.label"
                            :disabled="entry.disabled"
                            class="retro-btn pointer-events-auto flex items-center gap-1"
                            :ui="{ base: 'retro-btn' }"
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
                <LazyChatModelSelect
                    hydrate-on-interaction="focus"
                    v-if="!isMobile && containerWidth && containerWidth > 400"
                    v-model:model="selectedModel"
                    :loading="loading"
                    class="shrink-0 hidden sm:block"
                />

                <!-- Send / Stop Button -->
                <div>
                    <UButton
                        v-if="!props.streaming"
                        @click="handleSend"
                        :disabled="
                            loading ||
                            (!promptText.trim() && uploadedImages.length === 0)
                        "
                        :square="true"
                        size="sm"
                        color="primary"
                        class="retro-btn disabled:opacity-40 flex items-center justify-center"
                        type="button"
                        aria-label="Send message"
                        :ui="{
                            leadingIcon: 'text-[var(--md-on-primary)]',
                        }"
                    >
                        <UIcon name="pixelarticons:arrow-up" class="w-4 h-4" />
                    </UButton>
                    <UButton
                        v-else
                        @click="emit('stop-stream')"
                        :square="true"
                        size="sm"
                        color="error"
                        class="retro-btn flex items-center justify-center"
                        type="button"
                        aria-label="Stop generation"
                    >
                        <UIcon name="pixelarticons:pause" class="w-4 h-4" />
                    </UButton>
                </div>
            </div>
        </div>

        <!-- Attachment Thumbnails (Images + Large Text Blocks) -->
        <div
            v-if="uploadedImages.length > 0 || largeTextBlocks.length > 0"
            class="mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <!-- Images -->
            <div
                v-for="(image, index) in uploadedImages.filter(
                    (att: any) => att.kind === 'image'
                )"
                :key="'img-' + index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="() => removeImage(uploadedImages.indexOf(image))"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-(--md-inverse-surface) border bg-opacity-60 text-(--md-on-error) opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove image"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
                <div
                    class="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[11px] p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
            </div>
            <!-- PDFs -->
            <div
                v-for="(pdf, index) in uploadedImages.filter(
                    (att: any) => att.kind === 'pdf'
                )"
                :key="'pdf-' + index"
                class="relative group aspect-square border border-(--md-inverse-surface) retro-shadow rounded-[3px] overflow-hidden flex items-center justify-center bg-(--md-surface-container-low) p-2 text-center"
            >
                <div
                    class="flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >PDF</span
                    >
                    <span
                        class="text-[11px] leading-snug line-clamp-4 px-1 break-words"
                        :title="pdf.name"
                        >{{ pdf.name }}</span
                    >
                </div>
                <button
                    @click="() => removeImage(uploadedImages.indexOf(pdf))"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-(--md-inverse-surface) border bg-opacity-60 text-(--md-on-error) opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove PDF"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
            </div>
            <!-- Large Text Blocks -->
            <div
                v-for="(block, tIndex) in largeTextBlocks"
                :key="'txt-' + block.id"
                class="relative group aspect-square border border-(--md-inverse-surface) retro-shadow rounded-[3px] overflow-hidden flex items-center justify-center bg-(--md-surface-container-low) p-2 text-center"
            >
                <div
                    class="flex flex-col items-center justify-center w-full h-full"
                >
                    <span
                        class="text-[10px] font-semibold tracking-wide uppercase bg-black text-white px-1 py-0.5 rounded mb-1"
                        >TXT</span
                    >
                    <span
                        class="text-[11px] leading-snug line-clamp-4 px-1 break-words"
                        :title="block.previewFull"
                    >
                        {{ block.preview }}
                    </span>
                    <span class="mt-1 text-[10px] opacity-70"
                        >{{ block.wordCount }}w</span
                    >
                </div>
                <button
                    @click="removeTextBlock(tIndex)"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-(--md-inverse-surface) border bg-opacity-60 text-(--md-on-error) opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove text block"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
            </div>
        </div>

        <!-- Drag and Drop Overlay -->
        <div
            v-if="isDragging"
            class="absolute inset-0 bg-(--app-dropzone-overlay-bg) border-2 border-dashed border-(--app-dropzone-overlay-border) rounded-2xl flex items-center justify-center z-50"
        >
            <div class="text-center">
                <UIcon
                    name="i-lucide:upload-cloud"
                    class="w-12 h-12 mx-auto mb-3 text-(--app-dropzone-icon-color)"
                />
                <p class="text-(--app-dropzone-text-color) text-sm font-medium">
                    Drop images here to upload
                </p>
            </div>
        </div>
        <lazy-modal-model-catalog v-model:showModal="showModelCatalog" />
        <LazyChatSystemPromptsModal hydrate-on-visible
        v-model:showModal="showSystemPrompts" :thread-id="props.threadId" "
        :pane-id="props.paneId" @selected="handlePromptSelected"
        @closed="handlePromptModalClosed" />
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    nextTick,
    defineEmits,
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
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { computed } from 'vue';
import { isMobile, state } from '~/state/global';
import { useToast, useUserApiKey, useOpenRouterAuth } from '#imports';
import {
    useComposerActions,
    type ComposerActionEntry,
    type ComposerActionContext,
} from '#imports';
import { useToolRegistry } from '~/utils/chat/tools-public';

const props = defineProps<{
    loading?: boolean;
    containerWidth?: number;
    threadId?: string;
    streaming?: boolean; // assistant response streaming
    paneId?: string; // provided by ChatContainer so the bridge can key this input
}>();

// Tool Registry
const toolRegistry = useToolRegistry();
const registeredTools = computed(() =>
    toolRegistry.listTools.value.map((tool) => ({
        definition: tool.definition,
        enabledValue: tool.enabled.value,
        name: tool.definition.function.name,
    }))
);

const { favoriteModels, getFavoriteModels } = useModelStore();
const { settings: aiSettings } = useAiSettings();
const webSearchEnabled = ref<boolean>(false);
const LAST_MODEL_KEY = 'last_selected_model';

const suppressPersist = ref(false);

onMounted(async () => {
    const fave = await getFavoriteModels();
    // Favorite models loaded (log removed)
    if (process.client) {
        try {
            const stored = localStorage.getItem(LAST_MODEL_KEY);
            if (stored && typeof stored === 'string') {
                selectedModel.value = stored;
            }
            // If this is a brand-new chat (no threadId), honor fixed default from AI settings for initial display
            if (!props.threadId) {
                const set = (aiSettings as any)?.value;
                const fixed =
                    set?.defaultModelMode === 'fixed'
                        ? set?.fixedModelId
                        : null;
                if (fixed) {
                    suppressPersist.value = true; // don't clobber last_selected_model on initial display
                    selectedModel.value = fixed;
                }
            }
        } catch (e) {
            // Silently handle restore failure
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
        let extensions = [
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
            if (Array.isArray(filtered)) extensions = filtered as any;
        } catch {}

        editor.value = new Editor({
            extensions,
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
});

// When starting a brand-new chat (threadId becomes falsy), honor fixed default from settings
watch(
    () => props.threadId,
    (tid) => {
        if (tid) return; // only when there is no thread yet (new chat)
        try {
            const set: any = (aiSettings as any)?.value;
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
    editor: (editor.value ?? null) as Editor | null,
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
const hiddenFileInput = ref<HTMLInputElement | null>(null);
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
        try {
            localStorage.setItem(LAST_MODEL_KEY, newModel);
        } catch (e) {
            // Silently handle persist failure
        }
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

const triggerFileInput = () => {
    emit('trigger-file-input');
    if (!hiddenFileInput.value) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*,application/pdf';
        input.style.display = 'none';
        input.addEventListener('change', (e) => {
            handleFileChange(e);
        });
        document.body.appendChild(input);
        hiddenFileInput.value = input;
    }
    hiddenFileInput.value?.click();
};

const MAX_IMAGES = MAX_FILES_PER_MESSAGE;

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
    // Fast preview first
    const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) =>
            resolve(
                typeof e.target?.result === 'string'
                    ? (e.target?.result as string)
                    : ''
            );
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
    if (attachments.value.length >= MAX_IMAGES) return;
    const attachment: UploadedImage = {
        file,
        url: dataUrl,
        name: name || file.name,
        status: 'pending',
        mime,
        kind,
    };
    attachments.value.push(attachment);
    emit('image-add', attachment);
    await persistAttachment(attachment as any);
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

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || !target.files) return;
    processFiles(target.files);
};

const handleDrop = (event: DragEvent) => {
    isDragging.value = false;
    processFiles(event.dataTransfer?.files || null);
};

const onDragOver = (event: DragEvent) => {
    const items = event.dataTransfer?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/') || mime === 'application/pdf') {
            isDragging.value = true;
            return;
        }
    }
};

const onDragLeave = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        isDragging.value = false;
    }
};

const removeImage = (index: number) => {
    attachments.value.splice(index, 1);
    emit('image-remove', index);
};

const removeTextBlock = (index: number) => {
    largeTextBlocks.value.splice(index, 1);
};

const handleSend = async () => {
    if (props.loading) return;
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
            await hooks.doAction('ui.chat.editor:action:before_send', json);
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

// Emit live height via ResizeObserver (debounced with rAF)
let __resizeRaf: number | null = null;
// Flattened observer setup (avoids build transform splitting issues)
if (process.client && 'ResizeObserver' in window) {
    let ro: ResizeObserver | null = null;
    onMounted(() => {
        const inst = getCurrentInstance();
        const rootEl = (inst?.proxy?.$el as HTMLElement) || null;
        if (!rootEl) return;
        ro = new ResizeObserver(() => {
            if (__resizeRaf) cancelAnimationFrame(__resizeRaf);
            __resizeRaf = requestAnimationFrame(() => {
                emit('resize', { height: rootEl.offsetHeight });
            });
        });
        ro.observe(rootEl);
    });
    const dispose = () => {
        try {
            ro?.disconnect();
        } catch {}
        if (__resizeRaf) cancelAnimationFrame(__resizeRaf);
        ro = null;
    };
    onBeforeUnmount(dispose);
    if (import.meta.hot) import.meta.hot.dispose(dispose);
}
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
</style>
