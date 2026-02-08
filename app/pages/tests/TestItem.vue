<template>
    <div class="test-item" :class="statusClass">
        <div class="test-info">
            <div class="test-name">
                <UIcon :name="statusIcon" class="test-status-icon" />
                {{ test.name }}
                <span v-if="test.duration" class="test-duration">{{ test.duration }}ms</span>
            </div>
            <div class="test-desc">{{ test.description }}</div>
            <div v-if="test.error" class="test-error">{{ test.error }}</div>
        </div>
        <UButton
            size="xs"
            variant="ghost"
            icon="i-heroicons-play"
            :disabled="test.status === 'running'"
            @click="emit('run')"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface TestCase {
    id: string;
    name: string;
    description: string;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    duration?: number;
    error?: string;
}

const props = defineProps<{
    test: TestCase;
}>();

const emit = defineEmits<{
    run: [];
}>();

const statusIcon = computed(() => {
    switch (props.test.status) {
        case 'passed': return 'i-heroicons-check-circle';
        case 'failed': return 'i-heroicons-x-circle';
        case 'running': return 'i-heroicons-arrow-path';
        case 'skipped': return 'i-heroicons-minus-circle';
        default: return 'i-heroicons-clock';
    }
});

const statusClass = computed(() => `status-${props.test.status}`);
</script>

<style scoped>
.test-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--md-surface);
    border-radius: 0.5rem;
    border: 1px solid var(--md-outline);
    transition: border-color 0.2s, background 0.2s;
}

.test-item.status-passed {
    border-color: var(--md-success, #22c55e);
    background: color-mix(in srgb, var(--md-success, #22c55e) 5%, var(--md-surface));
}

.test-item.status-failed {
    border-color: var(--md-error, #ef4444);
    background: color-mix(in srgb, var(--md-error, #ef4444) 5%, var(--md-surface));
}

.test-item.status-running {
    border-color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 5%, var(--md-surface));
}

.test-info {
    flex: 1;
    min-width: 0;
}

.test-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
}

.test-status-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
}

.status-passed .test-status-icon { color: var(--md-success, #22c55e); }
.status-failed .test-status-icon { color: var(--md-error, #ef4444); }
.status-running .test-status-icon { 
    color: var(--md-primary); 
    animation: spin 1s linear infinite; 
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.test-duration {
    font-size: 0.75rem;
    color: var(--md-on-surface-variant);
    margin-left: auto;
}

.test-desc {
    font-size: 0.75rem;
    color: var(--md-on-surface-variant);
    margin-top: 0.25rem;
}

.test-error {
    font-size: 0.75rem;
    color: var(--md-error, #ef4444);
    margin-top: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: color-mix(in srgb, var(--md-error, #ef4444) 10%, transparent);
    border-radius: 0.25rem;
}
</style>
