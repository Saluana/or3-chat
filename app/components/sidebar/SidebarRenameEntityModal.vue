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
                    autofocus
                    variant="modal"
                    :model-value="value"
                    class="w-full"
                    :placeholder="placeholder"
                    :icon="icon"
                    @update:model-value="emit('update:value', String($event ?? ''))"
                    @focus.once="selectAll"
                    @keydown.enter="onEnter"
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
            <UButton
                color="primary"
                size="modal"
                :disabled="!value.trim()"
                @click="emit('submit')"
            >
                Save
            </UButton>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
const props = defineProps<{
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

// Select the current name on open so typing replaces it.
function selectAll(event: FocusEvent) {
    (event.target as HTMLInputElement | null)?.select();
}

// keydown (not keyup) so the Enter that opened the dialog can't submit it,
// and ignore Enter while an IME composition is active.
function onEnter(event: KeyboardEvent) {
    if (event.isComposing || !props.value.trim()) return;
    event.preventDefault();
    emit('submit');
}
</script>
