<template>
    <AppModal
        v-bind="modalProps"
        :open="open"
        :title="title"
        @update:open="emit('update:open', $event)"
    >
        <template #default>
            <div class="space-y-4">
                <div class="flex gap-2 text-sm">
                    <button
                        type="button"
                        class="theme-btn px-3 py-1.5 rounded-[var(--md-border-radius-small,4px)] border-[var(--md-border-width)] transition-colors"
                        :class="mode === 'select' ? 'bg-[var(--md-surface-active)] font-medium' : 'text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]'"
                        :aria-pressed="mode === 'select'"
                        @click="emit('update:mode', 'select')"
                    >
                        Existing project
                    </button>
                    <button
                        type="button"
                        class="theme-btn px-3 py-1.5 rounded-[var(--md-border-radius-small,4px)] border-[var(--md-border-width)] transition-colors"
                        :class="mode === 'create' ? 'bg-[var(--md-surface-active)] font-medium' : 'text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]'"
                        :aria-pressed="mode === 'create'"
                        @click="emit('update:mode', 'create')"
                    >
                        New project
                    </button>
                </div>
                <div v-if="mode === 'select'" class="space-y-3">
                    <UFormField
                        v-bind="formFieldProps"
                        label="Project"
                        name="project"
                    >
                        <USelectMenu
                            :model-value="selectedProjectId"
                            :items="projectSelectOptions"
                            :value-key="'value'"
                            :searchable="searchable"
                            placeholder="Select project"
                            v-bind="selectProps"
                            @update:model-value="
                                emit('update:selectedProjectId', $event as string | undefined)
                            "
                        />
                    </UFormField>
                    <p v-if="errorMessage" class="text-error text-xs">
                        {{ errorMessage }}
                    </p>
                </div>
                <div v-else class="space-y-3">
                    <UFormField
                        v-bind="formFieldProps"
                        label="Project title"
                        name="newProjectName"
                    >
                        <UInput
                            variant="modal"
                            :model-value="newProjectName"
                            placeholder="Project name"
                            :icon="iconFolder"
                            class="w-full"
                            @update:model-value="
                                emit('update:newProjectName', String($event ?? ''))
                            "
                        />
                    </UFormField>
                    <UFormField
                        v-bind="formFieldProps"
                        label="Description"
                        name="newProjectDescription"
                    >
                        <UTextarea
                            variant="modal"
                            :model-value="newProjectDescription"
                            :rows="3"
                            placeholder="Optional description"
                            class="w-full border-[var(--md-border-width)] rounded-[var(--md-border-radius-small,6px)]"
                            @update:model-value="
                                emit('update:newProjectDescription', String($event ?? ''))
                            "
                        />
                    </UFormField>
                    <p v-if="errorMessage" class="text-error text-xs">
                        {{ errorMessage }}
                    </p>
                </div>
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                size="modal"
                @click="emit('close')"
            >
                Cancel
            </UButton>
            <UButton
                color="primary"
                size="modal"
                :disabled="
                    loading ||
                    (mode === 'select' ? !selectedProjectId : !newProjectName.trim())
                "
                @click="emit('submit')"
            >
                <span v-if="!loading">Add</span>
                <span v-else class="inline-flex items-center gap-1">
                    <UIcon :name="loadingIcon" class="animate-spin" />
                    Adding
                </span>
            </UButton>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
defineProps<{
    modalProps: Record<string, unknown>;
    open: boolean;
    title: string;
    mode: 'select' | 'create';
    selectedProjectId?: string;
    newProjectName: string;
    newProjectDescription: string;
    errorMessage: string | null;
    projectSelectOptions: Array<{ label: string; value: string }>;
    iconFolder: string;
    loadingIcon: string;
    loading: boolean;
    searchable?: boolean;
    formFieldProps: Record<string, unknown>;
    selectProps: Record<string, unknown>;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'update:mode', value: 'select' | 'create'): void;
    (e: 'update:selectedProjectId', value: string | undefined): void;
    (e: 'update:newProjectName', value: string): void;
    (e: 'update:newProjectDescription', value: string): void;
    (e: 'close'): void;
    (e: 'submit'): void;
}>();
</script>
