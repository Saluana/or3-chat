<template>
    <UModal
        v-model:open="open"
        :ui="{
            footer: 'justify-end border-none',
            header: 'border-b-2 border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0! border-b-0! overflow-hidden',
        }"
        class="sp-modal border-2 w-full sm:min-w-[720px]! min-h-[80dvh] max-h-[80dvh] overflow-hidden"
    >
        <template #header>
            <div class="flex w-full items-center justify-between pr-2">
                <h3 class="font-semibold text-sm pl-2 dark:text-black">
                    System Prompts
                </h3>
                <UButton
                    class="bg-white/90 dark:text-black dark:border-black! hover:bg-white/95 active:bg-white/95 flex items-center justify-center cursor-pointer"
                    :square="true"
                    variant="ghost"
                    size="sm"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div class="flex flex-col h-full" @keydown="handleKeydown">
                <div
                    class="px-4 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10"
                >
                    <div class="flex items-center gap-2 flex-wrap">
                        <UButton
                            @click="createNewPrompt"
                            size="sm"
                            color="primary"
                            class="retro-btn"
                        >
                            New Prompt
                        </UButton>
                        <UButton
                            v-if="currentActivePromptId"
                            @click="clearActivePrompt"
                            size="sm"
                            color="neutral"
                            variant="outline"
                        >
                            Clear Active
                        </UButton>
                    </div>
                    <UInput
                        v-model="searchQuery"
                        placeholder="Search prompts..."
                        size="sm"
                        class="max-w-xs"
                        icon="i-heroicons-magnifying-glass"
                    />
                </div>
                <div class="flex-1 overflow-hidden">
                    <!-- List View -->
                    <div v-if="!editingPrompt" class="h-full overflow-y-auto">
                        <div
                            v-if="filteredPrompts.length === 0"
                            class="flex flex-col items-center justify-center h-full text-center p-8"
                        >
                            <UIcon
                                name="pixelarticons:script-text"
                                class="w-16 h-16 text-gray-400 mb-4"
                            />
                            <h3
                                class="text-lg font-medium text-gray-900 dark:text-white mb-2"
                            >
                                No system prompts yet
                            </h3>
                            <p class="text-gray-500 dark:text-gray-400 mb-4">
                                Create your first system prompt to customize AI
                                behavior.
                            </p>
                            <UButton @click="createNewPrompt" color="primary">
                                Create Your First Prompt
                            </UButton>
                        </div>

                        <div v-else class="p-4 space-y-3">
                            <div
                                v-for="prompt in filteredPrompts"
                                :key="prompt.id"
                                class="flex items-center justify-between p-4 rounded-lg border-2 border-black/80 dark:border-white/50 bg-white/80 dark:bg-neutral-900/70 hover:bg-white dark:hover:bg-neutral-800 transition-colors retro-shadow"
                                :class="{
                                    'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20':
                                        prompt.id === currentActivePromptId ||
                                        prompt.id === defaultPromptId,
                                }"
                            >
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1">
                                        <h4
                                            class="font-medium text-gray-900 dark:text-white truncate"
                                            :class="{
                                                'italic opacity-60':
                                                    !prompt.title,
                                            }"
                                        >
                                            {{
                                                prompt.title ||
                                                'Untitled Prompt'
                                            }}
                                        </h4>
                                        <span
                                            v-if="prompt.id === defaultPromptId"
                                            class="text-[12px] px-1.5 py-0.5 rounded border border-black/70 dark:border-white/40 bg-primary/80 text-white uppercase tracking-wide"
                                            >Default</span
                                        >
                                    </div>
                                    <p
                                        class="text-sm text-gray-500 dark:text-gray-400"
                                    >
                                        Updated
                                        {{ formatDate(prompt.updated_at) }} •
                                        {{ tokenCounts[prompt.id] || 0 }} tokens
                                    </p>
                                </div>

                                <div
                                    class="flex items-center gap-2 ml-4 shrink-0"
                                >
                                    <UTooltip
                                        :delay-duration="0"
                                        :text="
                                            prompt.id === defaultPromptId
                                                ? 'Remove default prompt'
                                                : 'Set as default prompt'
                                        "
                                    >
                                        <UButton
                                            size="sm"
                                            :variant="
                                                prompt.id === defaultPromptId
                                                    ? 'solid'
                                                    : 'outline'
                                            "
                                            :color="
                                                prompt.id === defaultPromptId
                                                    ? 'primary'
                                                    : 'neutral'
                                            "
                                            :square="true"
                                            :ui="{
                                                base: 'retro-btn px-1! text-nowrap',
                                            }"
                                            class="retro-btn"
                                            aria-label="Toggle default prompt"
                                            @click.stop="
                                                toggleDefault(prompt.id)
                                            "
                                            >{{
                                                prompt.id === defaultPromptId
                                                    ? 'default'
                                                    : 'set default'
                                            }}</UButton
                                        >
                                    </UTooltip>
                                    <UButton
                                        @click="selectPrompt(prompt.id)"
                                        size="sm"
                                        :color="
                                            prompt.id === currentActivePromptId
                                                ? 'primary'
                                                : 'neutral'
                                        "
                                        :variant="
                                            prompt.id === currentActivePromptId
                                                ? 'solid'
                                                : 'outline'
                                        "
                                    >
                                        {{
                                            prompt.id === currentActivePromptId
                                                ? 'Selected'
                                                : 'Select'
                                        }}
                                    </UButton>
                                    <UPopover
                                        :popper="{ placement: 'bottom-end' }"
                                    >
                                        <UButton
                                            size="sm"
                                            variant="outline"
                                            color="neutral"
                                            class="flex items-center justify-center"
                                            :square="true"
                                            icon="pixelarticons:more-vertical"
                                            aria-label="More actions"
                                        />
                                        <template #content>
                                            <div
                                                class="flex flex-col py-1 w-36 text-sm"
                                            >
                                                <button
                                                    @click="
                                                        startEditing(prompt.id)
                                                    "
                                                    class="text-left px-3 py-1.5 hover:bg-primary/10 flex items-center gap-2 cursor-pointer"
                                                >
                                                    <UIcon
                                                        name="pixelarticons:edit"
                                                        class="w-4 h-4"
                                                    />
                                                    <span>Edit</span>
                                                </button>
                                                <button
                                                    @click="
                                                        deletePrompt(prompt.id)
                                                    "
                                                    class="text-left px-3 py-1.5 hover:bg-error/10 text-error flex items-center gap-2 cursor-pointer"
                                                >
                                                    <UIcon
                                                        name="pixelarticons:trash"
                                                        class="w-4 h-4"
                                                    />
                                                    <span>Delete</span>
                                                </button>
                                            </div>
                                        </template>
                                    </UPopover>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Editor View -->
                    <div v-else class="h-full overflow-hidden flex flex-col">
                        <div class="flex-1 p-4 overflow-hidden">
                            <LazyPromptsPromptEditor
                                :prompt-id="editingPrompt.id"
                                @back="stopEditing"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import {
    listPrompts,
    createPrompt,
    softDeletePrompt,
    type PromptRecord,
} from '~/db/prompts';
import { useActivePrompt } from '~/composables/useActivePrompt';
import { updateThreadSystemPrompt, getThreadSystemPrompt } from '~/db/threads';
import { encode } from 'gpt-tokenizer';
import { useDefaultPrompt } from '~/composables/useDefaultPrompt';

// Props & modal open bridging (like SettingsModal pattern)
const props = defineProps<{
    showModal: boolean;
    threadId?: string;
}>();
const emit = defineEmits({
    'update:showModal': (value: boolean) => typeof value === 'boolean',
    selected: (id: string) => typeof id === 'string',
    closed: () => true,
    threadCreated: (threadId: string, promptId: string | null) => true,
});

const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

watch(
    () => props.showModal,
    (v, ov) => {
        if (!v && ov) emit('closed');
    }
);

const {
    activePromptId,
    setActivePrompt,
    clearActivePrompt: clearGlobalActivePrompt,
} = useActivePrompt();

const prompts = ref<PromptRecord[]>([]);
const { defaultPromptId, setDefaultPrompt, clearDefaultPrompt } =
    useDefaultPrompt();
const editingPrompt = ref<PromptRecord | null>(null);
const showDeleteConfirm = ref<string | null>(null);

const searchQuery = ref('');
const filteredPrompts = computed(() => {
    if (!searchQuery.value) return prompts.value;
    return prompts.value.filter((p) =>
        (p.title || '').toLowerCase().includes(searchQuery.value.toLowerCase())
    );
});

// Thread-specific system prompt handling
const threadSystemPromptId = ref<string | null>(null);
const pendingPromptId = ref<string | null>(null); // For when thread doesn't exist yet

// Computed for current active prompt (thread-specific or global)
const currentActivePromptId = computed(() => {
    if (props.threadId) {
        return threadSystemPromptId.value;
    }
    return activePromptId.value;
});

// Extract plain text from TipTap JSON recursively
function extractText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    const type = node.type;
    let acc = '';
    if (type === 'text') {
        acc += node.text || '';
    }
    if (node.content && Array.isArray(node.content)) {
        const inner = node.content.map(extractText).join('');
        acc += inner;
    }
    // Block separators to avoid word merging
    if (
        [
            'paragraph',
            'heading',
            'bulletList',
            'orderedList',
            'listItem',
        ].includes(type)
    ) {
        acc += '\n';
    }
    return acc;
}

function contentToText(content: any): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    // TipTap root usually { type: 'doc', content: [...] }
    if (content.type === 'doc' && Array.isArray(content.content)) {
        return extractText(content)
            .replace(/\n{2,}/g, '\n')
            .trim();
    }
    if (Array.isArray(content.content)) return extractText(content).trim();
    return '';
}

// Cached token counts per prompt id (recomputed when prompts list changes)
const tokenCounts = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of prompts.value) {
        try {
            const text = contentToText(p.content);
            map[p.id] = text ? encode(text).length : 0;
        } catch (e) {
            console.warn('[SystemPromptsModal] token encode failed', e);
            map[p.id] = 0;
        }
    }
    return map;
});

// Totals derived from cached counts
const totalTokens = computed(() =>
    Object.values(tokenCounts.value).reduce((a, b) => a + b, 0)
);
const filteredTokens = computed(() =>
    filteredPrompts.value.reduce(
        (sum, p) => sum + (tokenCounts.value[p.id] || 0),
        0
    )
);

// (Events moved above with prop bridging)

const loadPrompts = async () => {
    try {
        prompts.value = await listPrompts();
        if (
            defaultPromptId.value &&
            !prompts.value.find((p) => p.id === defaultPromptId.value)
        ) {
            await clearDefaultPrompt();
        }
    } catch (error) {
        console.error('Failed to load prompts:', error);
    }
};

const loadThreadSystemPrompt = async () => {
    if (props.threadId) {
        try {
            threadSystemPromptId.value = await getThreadSystemPrompt(
                props.threadId
            );
        } catch (error) {
            console.error('Failed to load thread system prompt:', error);
            threadSystemPromptId.value = null;
        }
    } else {
        threadSystemPromptId.value = null;
    }
};

const createNewPrompt = async () => {
    try {
        const newPrompt = await createPrompt();
        prompts.value.unshift(newPrompt);
        startEditing(newPrompt.id);
    } catch (error) {
        console.error('Failed to create prompt:', error);
    }
};

const selectPrompt = async (id: string) => {
    try {
        if (props.threadId) {
            // Update thread-specific system prompt
            await updateThreadSystemPrompt(props.threadId, id);
            threadSystemPromptId.value = id;
        } else {
            // Store as pending for when thread is created
            pendingPromptId.value = id;
            // Also update global for immediate feedback
            await setActivePrompt(id);
        }
        emit('selected', id);
    } catch (error) {
        console.error('Failed to select prompt:', error);
    }
};

const clearActivePrompt = async () => {
    try {
        if (props.threadId) {
            // Clear thread-specific system prompt
            await updateThreadSystemPrompt(props.threadId, null);
            threadSystemPromptId.value = null;
        } else {
            // Clear pending and global active prompt
            pendingPromptId.value = null;
            await clearGlobalActivePrompt();
        }
    } catch (error) {
        console.error('Failed to clear active prompt:', error);
    }
};

const startEditing = (id: string) => {
    const prompt = prompts.value.find((p) => p.id === id);
    if (prompt) {
        editingPrompt.value = prompt;
    }
};

const stopEditing = () => {
    editingPrompt.value = null;
    loadPrompts(); // Refresh list in case of changes
};

const applyPendingPromptToThread = async (threadId: string) => {
    if (pendingPromptId.value) {
        try {
            await updateThreadSystemPrompt(threadId, pendingPromptId.value);
            emit('threadCreated', threadId, pendingPromptId.value);
            pendingPromptId.value = null;
        } catch (error) {
            console.error('Failed to apply pending prompt to thread:', error);
        }
    }
};

const deletePrompt = async (id: string) => {
    if (confirm('Are you sure you want to delete this prompt?')) {
        try {
            await softDeletePrompt(id);
            if (activePromptId.value === id) {
                clearActivePrompt();
            }
            if (defaultPromptId.value === id) {
                await clearDefaultPrompt();
            }
            loadPrompts();
        } catch (error) {
            console.error('Failed to delete prompt:', error);
        }
    }
};

const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
};

const handleKeydown = (event: KeyboardEvent) => {
    if (editingPrompt.value) return;
    const key = event.key;
    if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        if (index < filteredPrompts.value.length) {
            const prompt = filteredPrompts.value[index];
            if (prompt) {
                selectPrompt(prompt.id);
                event.preventDefault();
            }
        }
    }
};

onMounted(() => {
    loadPrompts();
    loadThreadSystemPrompt();
});

// Watch for threadId changes to reload thread-specific prompt
watch(
    () => props.threadId,
    () => {
        loadThreadSystemPrompt();
    }
);

function toggleDefault(id: string) {
    if (defaultPromptId.value === id) {
        clearDefaultPrompt();
    } else {
        setDefaultPrompt(id);
    }
}
</script>

<style scoped>
/* Mobile full-screen adjustments */
@media (max-width: 640px) {
    .sp-modal {
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        margin: 0 !important;
        border-radius: 0 !important;
        border-width: 0 !important;
    }
}

/* Smooth scrolling area */
.sp-modal :deep(.n-modal-body),
.sp-modal :deep(.n-card__content) {
    /* ensure body grows */
    height: 100%;
}
</style>
