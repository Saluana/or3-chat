<template>
    <UModal
        v-bind="modalProps"
        :open="open"
        :title="title"
        @update:open="emit('update:open', $event)"
    >
        <template #body>
            <div class="space-y-4">
                <UForm :state="{ title: value }" @submit.prevent="emit('submit')">
                    <UFormField
                        v-bind="formFieldProps"
                        label="Title"
                        name="title"
                        :error="error"
                    >
                        <UInput
                            :model-value="value"
                            required
                            :placeholder="placeholder"
                            :icon="icon"
                            class="w-full"
                            @update:model-value="emit('update:value', String($event ?? ''))"
                            @keyup.enter="emit('submit')"
                        />
                    </UFormField>
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
                color="primary"
                class="theme-btn"
                :disabled="loading || !value.trim()"
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
    value: string;
    error?: string;
    placeholder: string;
    icon: string;
    loadingIcon: string;
    loading: boolean;
    formFieldProps: Record<string, unknown>;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'update:value', value: string): void;
    (e: 'close'): void;
    (e: 'submit'): void;
}>();
</script>
