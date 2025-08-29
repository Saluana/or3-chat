<template>
    <UModal
        v-model:open="open"
        :ui="{
            footer: 'justify-end border-t-2',
            header: 'border-b-2 border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0!',
        }"
        class="border-2 w-full sm:min-w-[720px]! overflow-hidden"
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
                    size="xs"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div class="flex flex-col h-full">
                <div
                    class="px-4 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center justify-between"
                >
                    <div class="flex items-center gap-2">
                        <UButton
                            v-if="activePromptId"
                            @click="clearActivePrompt"
                            size="xs"
                            color="neutral"
                            variant="outline"
                        >
                            Clear Active
                        </UButton>
                        <UButton
                            @click="createNewPrompt"
                            size="xs"
                            color="primary"
                        >
                            New Prompt
                        </UButton>
                    </div>
                </div>
                <div class="flex-1 overflow-hidden">
                    <!-- List View -->
                    <div v-if="!editingPrompt" class="h-full overflow-y-auto">
                        <div
                            v-if="prompts.length === 0"
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

                        <div v-else class="p-4 space-y-2">
                            <div
                                v-for="prompt in prompts"
                                :key="prompt.id"
                                class="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                :class="{
                                    'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20':
                                        prompt.id === activePromptId,
                                }"
                            >
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1">
                                        <h4
                                            class="font-medium text-gray-900 dark:text-white truncate"
                                        >
                                            {{ prompt.title }}
                                        </h4>
                                        <span
                                            v-if="prompt.id === activePromptId"
                                            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200"
                                        >
                                            Active
                                        </span>
                                    </div>
                                    <p
                                        class="text-sm text-gray-500 dark:text-gray-400"
                                    >
                                        Updated
                                        {{ formatDate(prompt.updated_at) }}
                                    </p>
                                </div>

                                <div class="flex items-center gap-1 ml-4">
                                    <UButton
                                        @click="selectPrompt(prompt.id)"
                                        size="xs"
                                        :color="
                                            prompt.id === activePromptId
                                                ? 'primary'
                                                : 'neutral'
                                        "
                                        :variant="
                                            prompt.id === activePromptId
                                                ? 'solid'
                                                : 'outline'
                                        "
                                    >
                                        {{
                                            prompt.id === activePromptId
                                                ? 'Selected'
                                                : 'Select'
                                        }}
                                    </UButton>
                                    <UButton
                                        @click="startEditing(prompt.id)"
                                        size="xs"
                                        color="neutral"
                                        variant="outline"
                                    >
                                        Edit
                                    </UButton>
                                    <UButton
                                        @click="renamePrompt(prompt)"
                                        size="xs"
                                        color="neutral"
                                        variant="outline"
                                    >
                                        Rename
                                    </UButton>
                                    <UButton
                                        @click="deletePrompt(prompt.id)"
                                        size="xs"
                                        color="error"
                                        variant="outline"
                                    >
                                        Delete
                                    </UButton>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Editor View -->
                    <div v-else class="h-full">
                        <div
                            class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700"
                        >
                            <h3
                                class="text-md font-medium text-gray-900 dark:text-white"
                            >
                                Editing: {{ editingPrompt.title }}
                            </h3>
                            <UButton
                                @click="stopEditing"
                                size="xs"
                                color="neutral"
                                variant="outline"
                            >
                                Back to List
                            </UButton>
                        </div>
                        <div class="flex-1 p-4">
                            <DocumentEditor
                                :document-id="editingPrompt.id"
                                @close="stopEditing"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #footer></template>
    </UModal>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import {
    listPrompts,
    createPrompt,
    softDeletePrompt,
    updatePrompt,
    type PromptRecord,
} from '~/db/prompts';
import { useActivePrompt } from '~/composables/useActivePrompt';
import DocumentEditor from '~/components/documents/DocumentEditor.vue';

// Props & modal open bridging (like SettingsModal pattern)
const props = defineProps<{ showModal: boolean }>();
const emit = defineEmits({
    'update:showModal': (value: boolean) => typeof value === 'boolean',
    selected: (id: string) => typeof id === 'string',
    closed: () => true,
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

const { activePromptId, setActivePrompt, clearActivePrompt } =
    useActivePrompt();

const prompts = ref<PromptRecord[]>([]);
const editingPrompt = ref<PromptRecord | null>(null);
const showDeleteConfirm = ref<string | null>(null);

// (Events moved above with prop bridging)

const loadPrompts = async () => {
    try {
        prompts.value = await listPrompts();
    } catch (error) {
        console.error('Failed to load prompts:', error);
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
        await setActivePrompt(id);
        emit('selected', id);
    } catch (error) {
        console.error('Failed to select prompt:', error);
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

const renamePrompt = async (prompt: PromptRecord) => {
    const newTitle = prompt.title; // For now, just keep the existing title
    // TODO: Implement proper inline rename with input field
    if (newTitle && newTitle !== prompt.title) {
        try {
            await updatePrompt(prompt.id, { title: newTitle });
            loadPrompts();
        } catch (error) {
            console.error('Failed to rename prompt:', error);
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
            loadPrompts();
        } catch (error) {
            console.error('Failed to delete prompt:', error);
        }
    }
};

const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
};

onMounted(() => {
    loadPrompts();
});
</script>
