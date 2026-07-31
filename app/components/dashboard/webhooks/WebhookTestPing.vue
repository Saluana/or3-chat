<template>
    <UAlert
        v-if="result"
        :color="result.success ? 'success' : 'error'"
        :title="result.success ? 'Test delivery succeeded' : 'Test delivery failed'"
        :description="description"
        variant="subtle"
    />
</template>

<script setup lang="ts">
import type { ManagedWebhookTestResult } from './types';

const props = defineProps<{
    result: ManagedWebhookTestResult | null;
}>();

const emit = defineEmits<{
    dismiss: [];
}>();

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

const description = computed(() => {
    if (!props.result) {
        return '';
    }

    const parts = [
        props.result.statusCode !== null
            ? `HTTP ${props.result.statusCode}`
            : 'No HTTP status',
        `${props.result.durationMs}ms`,
    ];

    if (!props.result.success && props.result.error) {
        parts.push(props.result.error);
    }

    return parts.join(' • ');
});

watch(
    () => props.result,
    (next) => {
        if (dismissTimer) {
            clearTimeout(dismissTimer);
            dismissTimer = null;
        }

        if (!next) {
            return;
        }

        dismissTimer = setTimeout(() => {
            emit('dismiss');
        }, 10_000);
    }
);

onBeforeUnmount(() => {
    if (dismissTimer) {
        clearTimeout(dismissTimer);
    }
});
</script>
