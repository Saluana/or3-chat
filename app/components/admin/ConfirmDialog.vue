<template>
    <UModal v-model:open="isOpen" :title="title" :description="message">
        <template #body>
            <p class="text-sm text-[var(--md-on-surface-variant)]">
                {{ message }}
            </p>

            <div
                v-if="importantNote"
                class="mt-3 rounded-md border px-3 py-2 text-xs"
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
                    @click="confirmAction"
                >
                    {{ confirmText || 'Confirm' }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
/**
 * Reusable confirmation dialog component.
 * Uses Nuxt UI v3 UModal with v-model:open for proper overlay behavior.
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
