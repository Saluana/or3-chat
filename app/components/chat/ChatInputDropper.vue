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
                    <textarea
                        v-model="promptText"
                        placeholder="How can I help you today?"
                        class="w-full h-12 break-words max-w-full resize-none bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 text-sm leading-relaxed"
                        rows="1"
                        @input="handlePromptInput"
                        @paste="handlePaste"
                        ref="textareaRef"
                        :disabled="loading"
                    ></textarea>
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
                        <UButton
                            @click="
                                showSettingsDropdown = !showSettingsDropdown
                            "
                            :square="true"
                            size="sm"
                            color="info"
                            class="retro-btn text-black dark:text-white flex items-center justify-center"
                            type="button"
                            aria-label="Settings"
                            :disabled="loading"
                        >
                            <UIcon
                                name="i-lucide:sliders-horizontal"
                                class="w-4 h-4"
                            />
                        </UButton>
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
                            icon: 'i-lucide-search',
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
                            favoriteModels.map((m) => ({
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
                        <UIcon name="i-lucide:arrow-up" class="w-4 h-4" />
                    </UButton>
                </div>
            </div>
        </div>

        <!-- Image Thumbnails -->
        <div
            v-if="uploadedImages.length > 0"
            class="mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <div
                v-for="(image, index) in uploadedImages"
                :key="index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="removeImage(index)"
                    class="absolute flex item-center justify-center top-1 right-1 h-[20px] w-[20px] retro-shadow bg-error border-black border bg-opacity-50 text-white opacity-0 rounded-[3px] hover:bg-error/80 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove image"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3.5 h-3.5" />
                </button>
                <div
                    class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
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
import { ref, nextTick, defineEmits } from 'vue';

const props = defineProps<{ loading?: boolean }>();

const { favoriteModels, getFavoriteModels } = useModelStore();

onMounted(async () => {
    const fave = await getFavoriteModels();
    console.log('Favorite models:', fave);
});

interface UploadedImage {
    file: File;
    url: string;
    name: string;
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
            images: UploadedImage[];
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
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const uploadedImages = ref<UploadedImage[]>([]);
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
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                const url = typeof result === 'string' ? result : '';
                const image: UploadedImage = {
                    file: file,
                    url,
                    name: file.name || `pasted-image-${Date.now()}.png`,
                };
                uploadedImages.value.push(image);
                emit('image-add', image);
            };
            reader.readAsDataURL(file);
        }
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

const processFiles = (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        const mime = file.type || '';
        if (!mime.startsWith('image/')) continue;
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result;
            const url = typeof result === 'string' ? result : '';
            const image: UploadedImage = {
                file: file,
                url,
                name: file.name,
            };
            uploadedImages.value.push(image);
            emit('image-add', image);
        };
        reader.readAsDataURL(file);
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

const handleSend = () => {
    if (props.loading) return;
    if (promptText.value.trim() || uploadedImages.value.length > 0) {
        emit('send', {
            text: promptText.value,
            images: uploadedImages.value,
            model: selectedModel.value,
            settings: imageSettings.value,
        });
        promptText.value = '';
        uploadedImages.value = [];
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
</style>
