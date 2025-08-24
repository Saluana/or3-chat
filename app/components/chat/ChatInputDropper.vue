<template>
    <div
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="handleDrop"
        :class="[
            'flex flex-col bg-white dark:bg-gray-900 border-2 border-[var(--md-inverse-surface)] mx-2 md:mx-0 items-stretch transition-all duration-300 relative retro-shadow hover:shadow-xl focus-within:shadow-xl cursor-text z-10 rounded-[3px]',
            isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'hover:border-[var(--md-primary)] focus-within:border-[var(--md-primary)] dark:focus-within:border-gray-600',
            loading ? 'opacity-90 pointer-events-auto' : '',
        ]"
    >
        <div class="flex flex-col gap-3.5 m-3.5">
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="max-h-96 w-full overflow-y-auto break-words min-h-[3rem]"
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
                            name="i-lucide:loader-2"
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
                            class="retro-btn text-black dark:text-white flex items-center justify-center"
                            type="button"
                            aria-label="Add attachments"
                            :disabled="loading"
                        >
                            <UIcon name="i-lucide:plus" class="w-4 h-4" />
                        </UButton>
                    </div>

                    <!-- Settings Button (stub) -->
                    <div class="relative shrink-0">
                        <UPopover>
                            <UButton
                                label="Open"
                                :square="true"
                                size="sm"
                                color="info"
                                class="retro-btn text-black dark:text-white flex items-center justify-center"
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
                                    <div
                                        class="flex justify-between w-full items-center py-1 px-2 border-b"
                                    >
                                        <USwitch
                                            color="primary"
                                            label="Enable web search"
                                            class="w-full"
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
                                    <UModal>
                                        <button
                                            class="flex justify-between w-full items-center py-1 px-2 hover:bg-primary/10 border-b cursor-pointer"
                                        >
                                            <span class="px-1"
                                                >System prompts</span
                                            >
                                            <UIcon
                                                name="pixelarticons:script-text"
                                                class="w-4 h-4"
                                            />
                                        </button>
                                        <template #content>
                                            <div
                                                class="w-[50vw] h-[80vh]"
                                            ></div>
                                        </template>
                                    </UModal>
                                    <button
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

                <!-- Model Selector (simple) -->
                <div class="shrink-0">
                    <USelectMenu
                        :ui="{
                            content:
                                'border-[2px] border-black rounded-[3px] w-[320px]',
                            input: 'border-0 rounded-none!',
                            arrow: 'h-[18px] w-[18px]',
                            itemTrailingIcon:
                                'shrink-0 w-[18px] h-[18px] text-dimmed',
                        }"
                        :search-input="{
                            icon: 'pixelarticons:search',
                            ui: {
                                base: 'border-0 border-b-1 rounded-none!',
                                leadingIcon:
                                    'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
                            },
                        }"
                        v-if="
                            selectedModel &&
                            favoriteModels &&
                            favoriteModels.length > 0
                        "
                        v-model="selectedModel as string"
                        :value-key="'value'"
                        class="retro-btn h-[32px] text-sm rounded-md border px-2 bg-white dark:bg-gray-800 w-48 min-w-[100px]"
                        :disabled="loading"
                        :items="
                            favoriteModels.map((m: any) => ({
                                label: m.canonical_slug,
                                value: m.canonical_slug,
                            }))
                        "
                    >
                    </USelectMenu>
                </div>

                <!-- Send Button -->
                <div>
                    <UButton
                        @click="handleSend"
                        :disabled="
                            loading ||
                            (!promptText.trim() && uploadedImages.length === 0)
                        "
                        :square="true"
                        size="sm"
                        color="primary"
                        class="retro-btn disabled:opacity-40 text-white dark:text-black flex items-center justify-center"
                        type="button"
                        aria-label="Send message"
                    >
                        <UIcon name="pixelarticons:arrow-up" class="w-4 h-4" />
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
                v-for="(image, index) in uploadedImages"
                :key="'img-' + index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="removeImage(index)"
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-black border bg-opacity-60 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
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
            <!-- Large Text Blocks -->
            <div
                v-for="(block, tIndex) in largeTextBlocks"
                :key="'txt-' + block.id"
                class="relative group aspect-square border border-black retro-shadow rounded-[3px] overflow-hidden flex items-center justify-center bg-[var(--md-surface-container-low)] p-2 text-center"
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
                    class="absolute flex item-center justify-center top-1 right-1 h-[22px] w-[22px] retro-shadow bg-error border-black border bg-opacity-60 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
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
            class="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-500 rounded-2xl flex items-center justify-center z-50"
        >
            <div class="text-center">
                <UIcon
                    name="i-lucide:upload-cloud"
                    class="w-12 h-12 mx-auto mb-3 text-blue-500"
                />
                <p class="text-blue-600 dark:text-blue-400 text-sm font-medium">
                    Drop images here to upload
                </p>
            </div>
        </div>
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
} from 'vue';
import { MAX_FILES_PER_MESSAGE } from '../../utils/files-constants';
import { createOrRefFile } from '~/db/files';
import type { FileMeta } from '~/db/schema';
import { useModelStore } from '~/composables/useModelStore';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { computed } from 'vue';

const props = defineProps<{ loading?: boolean }>();

const { favoriteModels, getFavoriteModels } = useModelStore();

onMounted(async () => {
    const fave = await getFavoriteModels();
    console.log('Favorite models:', fave);
});

onMounted(() => {
    if (!process.client) return;
    try {
        editor.value = new Editor({
            extensions: [
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
            ],
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
        console.warn(
            '[ChatInputDropper] TipTap init failed, using fallback textarea',
            err
        );
    }
});

onBeforeUnmount(() => {
    try {
        editor.value?.destroy();
    } catch (err) {
        console.warn('[ChatInputDropper] TipTap destroy error', err);
    }
});

interface UploadedImage {
    file: File;
    url: string; // data URL preview
    name: string;
    hash?: string; // content hash after persistence
    status: 'pending' | 'ready' | 'error';
    error?: string;
    meta?: FileMeta;
}

interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

const emit = defineEmits<{
    (
        e: 'send',
        payload: {
            text: string;
            images: UploadedImage[]; // may include pending or error statuses
            largeTexts: LargeTextBlock[];
            model: string;
            settings: ImageSettings;
        }
    ): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
}>();

const promptText = ref('');
// Fallback textarea ref (used while TipTap not yet integrated / or fallback active)
const textareaRef = ref<HTMLTextAreaElement | null>(null);
// Future TipTap editor container & instance refs (Task 2 structure only)
const editorContainerRef = ref<HTMLElement | null>(null);
const editor = ref<Editor | null>(null);
const editorIsEmpty = computed(() => {
    return editor.value ? editor.value.isEmpty : true;
});

const uploadedImages = ref<UploadedImage[]>([]);
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
    // 1. Handle images first (current behavior)
    const items = cd.items;
    let handled = false;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        const mime = it.type || '';
        if (mime.startsWith('image/')) {
            event.preventDefault();
            handled = true;
            const file = it.getAsFile();
            if (!file) continue;
            await processFile(
                file,
                file.name || `pasted-image-${Date.now()}.png`
            );
        }
    }
    if (handled) return; // skip text path if image already captured

    // 2. Large text detection
    const text = cd.getData('text/plain');
    if (!text) return; // allow normal behavior
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount >= LARGE_TEXT_WORD_THRESHOLD) {
        event.preventDefault();
        // Create a block instead of inserting raw text
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
    }
};

const triggerFileInput = () => {
    emit('trigger-file-input');
    if (!hiddenFileInput.value) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
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

async function processFile(file: File, name?: string) {
    const mime = file.type || '';
    if (!mime.startsWith('image/')) return;
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
    if (uploadedImages.value.length >= MAX_IMAGES) return;
    const image: UploadedImage = {
        file,
        url: dataUrl,
        name: name || file.name,
        status: 'pending',
    };
    uploadedImages.value.push(image);
    emit('image-add', image);
    try {
        const meta = await createOrRefFile(file, image.name);
        image.hash = meta.hash;
        image.meta = meta;
        image.status = 'ready';
    } catch (err: any) {
        image.status = 'error';
        image.error = err?.message || 'failed';
        console.warn('[ChatInputDropper] pipeline error', image.name, err);
    }
}

const processFiles = async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        if (uploadedImages.value.length >= MAX_IMAGES) break;
        const file = files[i];
        if (!file) continue;
        await processFile(file);
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
        if (mime.startsWith('image/')) {
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
    uploadedImages.value.splice(index, 1);
    emit('image-remove', index);
};

const removeTextBlock = (index: number) => {
    largeTextBlocks.value.splice(index, 1);
};

const handleSend = () => {
    if (props.loading) return;
    if (
        promptText.value.trim() ||
        uploadedImages.value.length > 0 ||
        largeTextBlocks.value.length > 0
    ) {
        emit('send', {
            text: promptText.value,
            images: uploadedImages.value,
            largeTexts: largeTextBlocks.value,
            model: selectedModel.value,
            settings: imageSettings.value,
        });
        // Reset local state and editor content so placeholder shows again
        promptText.value = '';
        try {
            editor.value?.commands.clearContent();
        } catch (e) {
            // noop
        }
        uploadedImages.value = [];
        largeTextBlocks.value = [];
        autoResize();
    }
};
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
}
.prosemirror-host :deep(.ProseMirror p) {
    margin: 0;
}

/* Placeholder (needs :deep due to scoped styles) */
.prosemirror-host :deep(p.is-editor-empty:first-child::before) {
    color: var(--placeholder-color, #6b7280);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    opacity: 0.55;
    font-weight: normal;
}
</style>
