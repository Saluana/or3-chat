<template>
    <UModal v-model="isOpen">
        <UCard>
            <template #header>
                <h3 class="text-lg font-semibold text-[var(--md-on-surface)]">
                    {{ title }}
                </h3>
            </template>
            
            <p class="text-sm text-[var(--md-on-surface-variant)]">
                {{ message }}
            </p>
            
            <template #footer>
                <div class="flex gap-2 justify-end">
                    <UButton 
                        color="neutral" 
                        variant="soft" 
                        @click="cancel"
                    >
                        Cancel
                    </UButton>
                    <UButton 
                        :color="danger ? 'error' : 'primary'" 
                        @click="confirm"
                    >
                        {{ confirmText || 'Confirm' }}
                    </UButton>
                </div>
            </template>
        </UCard>
    </UModal>
</template>

<script setup lang="ts">
/**
 * Reusable confirmation dialog component
 * 
 * Replaces native confirm() dialogs with accessible, themeable modals
 * that support screen readers and keyboard navigation.
 * 
 * Usage:
 * ```vue
 * <ConfirmDialog
 *   v-model="showDialog"
 *   title="Confirm Action"
 *   message="Are you sure?"
 *   danger
 *   @confirm="handleConfirm"
 * />
 * ```
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
}>();

const emit = defineEmits<{
    confirm: [];
    cancel: [];
}>();

function confirm() {
    emit('confirm');
    isOpen.value = false;
}

function cancel() {
    emit('cancel');
    isOpen.value = false;
}
</script>
