<template>
    <AppModal v-model:open="isOpen" :title="title" :description="message">
        <template #default>
            <p class="text-sm text-[var(--md-on-surface-variant)]">
                {{ message }}
            </p>

            <div
                v-if="importantNote"
                class="mt-3 rounded-[var(--md-border-radius-small,0.375rem)] border-[length:var(--md-border-width)] px-3 py-2 text-xs"
                :class="
                    noteTone === 'warning'
                        ? 'border-[var(--md-sys-color-warning,#f59e0b)] bg-[var(--md-sys-color-warning-container,#fef3c7)] text-[var(--md-sys-color-on-warning-container,#92400e)]'
                        : 'border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] text-[var(--md-on-surface-variant)]'
                "
            >
                {{ importantNote }}
            </div>
        </template>

        <template #footer>
            <div class="flex gap-2.5 justify-end">
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="modal"
                    @click="cancel"
                >
                    Cancel
                </UButton>
                <UButton
                    :color="danger ? 'error' : 'primary'"
                    size="modal"
                    @click="confirmAction"
                >
                    {{ confirmText || 'Confirm' }}
                </UButton>
            </div>
        </template>
    </AppModal>
</template>

<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
/**
 * Reusable confirmation dialog component.
 * Uses the shared AppModal shell with v-model:open for overlay behavior.
 */

const isOpen = defineModel<boolean>({ required: true });

defineProps<{
    /** Dialog title */
    title: string;
    /** Dialog message/body text */
    message: string;
    /** Text for confirm button */
    confirmText?: string;
    /** If true, confirm button is red (error style) */
    danger?: boolean;
    /** Optional emphasized note shown below message */
    importantNote?: string;
    /** Visual tone for optional note */
    noteTone?: 'info' | 'warning';
}>();

const emit = defineEmits<{
    confirm: [];
    cancel: [];
}>();

function confirmAction() {
    emit('confirm');
    isOpen.value = false;
}

function cancel() {
    emit('cancel');
    isOpen.value = false;
}
</script>
