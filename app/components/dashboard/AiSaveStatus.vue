<template>
    <span class="ai-save-status" role="status" :data-status="status">
        <template v-if="status === 'saving'">Saving…</template>
        <template v-else-if="status === 'saved'">
            <UIcon :name="useIcon('ui.check').value" class="h-4 w-4" />
            Saved
        </template>
        <template v-else-if="status === 'error'">
            Not saved
            <button
                v-if="retryable"
                type="button"
                class="ai-save-retry"
                @click="emit('retry')"
            >
                Retry
            </button>
        </template>
    </span>
</template>

<script setup lang="ts">
import { useIcon } from '#imports';

defineProps<{
    status: 'idle' | 'saving' | 'saved' | 'error';
    retryable?: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();
</script>

<style scoped>
.ai-save-status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.72rem;
}
.ai-save-status[data-status='saved'] {
    color: var(--md-success, var(--md-primary));
}
.ai-save-status[data-status='error'] {
    color: var(--md-error);
}
.ai-save-retry {
    text-decoration: underline;
    cursor: pointer;
}
</style>
