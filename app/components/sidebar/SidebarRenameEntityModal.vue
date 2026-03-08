<template>
    <UModal
        v-bind="modalProps"
        :open="open"
        :title="title"
        @update:open="emit('update:open', $event)"
    >
        <template #body>
            <div class="space-y-4">
                <UInput
                    :model-value="value"
                    class="w-full"
                    :placeholder="placeholder"
                    :icon="icon"
                    @update:model-value="emit('update:value', String($event ?? ''))"
                    @keyup.enter="emit('submit')"
                />
            </div>
        </template>
        <template #footer>
            <UButton
                variant="ghost"
                class="theme-btn"
                @click="emit('update:open', false)"
            >
                Cancel
            </UButton>
            <UButton color="primary" class="theme-btn" @click="emit('submit')">
                Save
            </UButton>
        </template>
    </UModal>
</template>

<script setup lang="ts">
defineProps<{
    modalProps: Record<string, unknown>;
    open: boolean;
    title: string;
    placeholder: string;
    icon: string;
    value: string;
}>();

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
    (e: 'update:value', value: string): void;
    (e: 'submit'): void;
}>();
</script>
