<template>
    <UModal
        v-bind="modalProps"
        :open="open"
        :title="title"
        @update:open="emit('update:open', $event)"
    >
        <template #body>
            <div class="space-y-4">
                <UForm :state="{ name, description }" @submit.prevent="emit('submit')">
                    <div class="flex flex-col space-y-3">
                        <UFormField
                            v-bind="formFieldProps"
                            label="Title"
                            name="name"
                            :error="nameError"
                        >
                            <UInput
                                :model-value="name"
                                required
                                placeholder="Project title"
                                :icon="iconFolder"
                                class="w-full"
                                @update:model-value="emit('update:name', String($event ?? ''))"
                                @keyup.enter="emit('submit')"
                            />
                        </UFormField>
                        <UFormField
                            v-bind="formFieldProps"
                            label="Description"
                            name="description"
                        >
                            <UTextarea
                                :model-value="description"
                                class="w-full border-[var(--md-border-width)] rounded-[var(--md-border-radius-small,var(--md-border-radius,6px))]"
                                :rows="3"
                                placeholder="Optional description"
                                @update:model-value="
                                    emit('update:description', String($event ?? ''))
                                "
                            />
                        </UFormField>
                    </div>
                </UForm>
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('close')"
            >
                Cancel
            </UButton>
            <UButton
                :disabled="!name.trim() || loading"
                color="primary"
                class="theme-btn"
                @click="emit('submit')"
            >
                <span v-if="!loading">Create</span>
                <span v-else class="inline-flex items-center gap-1">
                    <UIcon :name="loadingIcon" class="animate-spin" />
                    Creating
                </span>
            </UButton>
        </template>
    </UModal>
</template>

<script setup lang="ts">
defineProps<{
    modalProps: Record<string, unknown>;
    open: boolean;
    title: string;
    name: string;
    description: string;
    nameError?: string;
    iconFolder: string;
    loadingIcon: string;
    loading: boolean;
    formFieldProps: Record<string, unknown>;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'update:name', value: string): void;
    (e: 'update:description', value: string): void;
    (e: 'close'): void;
    (e: 'submit'): void;
}>();
</script>
