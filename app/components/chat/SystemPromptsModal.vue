<template>
    <UModal
        v-model:open="open"
        :ui="{
            footer: 'justify-end border-none',
            body: 'p-0! border-b-0! overflow-hidden',
        }"
        title="System Prompts"
        description="Manage and select system prompts to customize AI behavior."
        class="sp-modal border-2 w-[98dvw] h-[98dvh] sm:min-w-[720px]! sm:min-h-[80dvh] sm:max-h-[80dvh] overflow-hidden"
    >
        <template #body>
            <div class="flex flex-col h-full" @keydown="handleKeydown">
                <div
                    v-show="!editingPrompt"
                    class="px-4 border-b-2 border-(--app-modal-border-strong) min-h-[50px] max-h-[100px] bg-(--app-modal-header-bg) backdrop-blur-sm flex items-center justify-between flex-col-reverse sm:flex-row sticky top-0 z-10"
                >
                    <div
                        class="flex w-full justify-end sm:justify-start items-center gap-2 pb-2 sm:pb-0"
                    >
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
                        :size="isMobile ? 'md' : 'sm'"
                        class="w-full my-2 sm:my-0 sm:max-w-xs"
                        icon="i-heroicons-magnifying-glass"
                    />
                </div>
                <div class="flex-1 overflow-hidden">
                    <!-- List View -->
                    <div
                        v-if="!editingPrompt"
                        class="max-h-full overflow-y-auto"
                    >
                        <div
                            v-if="filteredPrompts.length === 0"
                            class="flex flex-col items-center justify-center h-full text-center p-8"
                        >
                            <UIcon
                                name="pixelarticons:script-text"
                                class="w-16 h-16 text-(--app-modal-text-muted) mb-4"
                            />
                            <h3
                                class="text-lg font-medium text-(--app-modal-text) mb-2"
                            >
                                No system prompts yet
                            </h3>
                            <p class="text-(--app-modal-text-muted) mb-4">
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
                                class="group flex flex-col sm:flex-row sm:items-start items-start justify-between p-4 rounded-lg border-2 border-(--app-modal-border-strong) bg-(--app-modal-item-bg) not-odd:bg-(--app-modal-item-odd-bg) retro-shadow app-prompt-item"
                                :data-active="
                                    prompt.id === currentActivePromptId
                                        ? 'true'
                                        : 'false'
                                "
                            >
                                <!-- Left / Main meta -->
                                <div class="flex-1 min-w-0">
                                    <div
                                        class="flex flex-wrap items-center gap-2 mb-1"
                                    >
                                        <h4
                                            class="font-medium text-xs leading-tight text-(--app-modal-text) truncate max-w-full"
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
                                            class="text-[10px] px-1.5 py-0.5 rounded border border-(--app-modal-border-strong) bg-primary/80 text-(--md-on-primary) uppercase tracking-wide"
                                            >Default</span
                                        >
                                        <span
                                            v-if="
                                                prompt.id ===
                                                    currentActivePromptId &&
                                                prompt.id !== defaultPromptId
                                            "
                                            class="text-[10px] px-1 py-0.5 rounded border border-(--app-modal-border-subtle) bg-(--app-modal-item-odd-bg) text-(--app-modal-text) uppercase tracking-wide"
                                            >Active</span
                                        >
                                    </div>
                                    <div
                                        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-(--app-modal-text-muted)"
                                    >
                                        <span class="flex items-center gap-1">
                                            <UIcon
                                                name="pixelarticons:clock"
                                                class="w-3.5 h-3.5 opacity-70"
                                            />
                                            Updated
                                            {{ formatDate(prompt.updated_at) }}
                                        </span>
                                        <span
                                            class="hidden sm:inline opacity-40"
                                            >|</span
                                        >
                                        <span class="flex items-center gap-1">
                                            <UIcon
                                                name="pixelarticons:chart-bar"
                                                class="w-3.5 h-3.5 opacity-70"
                                            />
                                            {{ tokenCounts[prompt.id] || 0 }}
                                            tokens
                                        </span>
                                    </div>
                                </div>

                                <!-- Actions -->
                                <div
                                    class="mt-3 sm:mt-0 sm:ml-4 flex w-full sm:w-auto flex-wrap items-center gap-2 justify-end pt-3 sm:pt-0 border-t sm:border-t-0 border-(--app-modal-border-subtle)"
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
                                        :aria-pressed="
                                            prompt.id === currentActivePromptId
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

import { updateThreadSystemPrompt, getThreadSystemPrompt } from '~/db/threads';

import { isMobile } from '~/state/global';

// Props & modal open bridging (like SettingsModal pattern)
const props = defineProps<{
    showModal: boolean;
    threadId?: string;
    paneId?: string; // isolate pending selection per pane (before thread exists)
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
const pendingPromptId = ref<string | null>(null); // For when thread doesn't exist yet (pane scoped)

// Computed for current active prompt (thread-specific or global)
const currentActivePromptId = computed(() => {
    if (props.threadId) return threadSystemPromptId.value;
    // If no thread yet use pane-scoped pending first, else fall back to global active
    return pendingPromptId.value || activePromptId.value;
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

// Worker-based tokenizer
const { countTokensBatch } = useTokenizer();

// Token counts per prompt id (updated asynchronously via worker)
const tokenCounts = ref<Record<string, number>>({});
let tokenCountRequestId = 0;

// Update token counts when prompts change
watch(
    prompts,
    async (newPrompts) => {
        const currentRequest = ++tokenCountRequestId;

        if (!newPrompts.length) {
            if (currentRequest === tokenCountRequestId) {
                tokenCounts.value = {};
            }
            return;
        }

        try {
            const items = newPrompts.map((p) => ({
                key: p.id,
                text: contentToText(p.content),
            }));

            const counts = await countTokensBatch(items);
            if (currentRequest === tokenCountRequestId) {
                tokenCounts.value = counts;
            }
        } catch (e) {
            console.warn('[SystemPromptsModal] token counting failed', e);
            // Fallback to empty counts
            if (currentRequest === tokenCountRequestId) {
                tokenCounts.value = {};
            }
        }
    },
    { immediate: false, deep: false }
);

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
            // Do NOT override global active prompt; keep pane scoped selection only
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
            // Don't clear global active prompt automatically (leave global state untouched)
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
