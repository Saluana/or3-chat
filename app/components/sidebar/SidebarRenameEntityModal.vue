<template>
    <AppModal
        v-bind="modalProps"
        :open="open"
        :title="title"
        @update:open="emit('update:open', $event)"
    >
        <template #default>
            <div class="space-y-4">
                <UInput
                    variant="modal"
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
                size="modal"
                @click="emit('update:open', false)"
            >
                Cancel
            </UButton>
            <UButton color="primary" size="modal" @click="emit('submit')">
                Save
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
