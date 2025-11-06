<template>
    <div v-if="capabilities.length > 0" class="plugin-capabilities">
        <div class="capabilities-header">
            <UIcon name="pixelarticons:shield" class="w-4 h-4" />
            <span class="font-semibold">Capabilities</span>
        </div>
        <ul class="capabilities-list">
            <li v-for="cap in capabilities" :key="cap" class="capability-item">
                <UIcon name="pixelarticons:check" class="w-3 h-3" />
                <span>{{ formatCapability(cap) }}</span>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    capabilities?: string[];
}>();

const capabilities = computed(() => props.capabilities || []);

// Format capability string to be more human-readable
function formatCapability(cap: string): string {
    // Convert camelCase to Title Case with spaces
    // e.g., "canReadMessages" -> "Can Read Messages"
    return cap
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim();
}
</script>

<style scoped>
.plugin-capabilities {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--md-outline-variant);
    border-radius: 3px;
    background: var(--md-surface-container-low);
}

.capabilities-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    color: var(--md-on-surface);
    font-size: 0.875rem;
}

.capabilities-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.capability-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--md-on-surface-variant);
    padding: 0.25rem 0;
}

.capability-item svg {
    color: var(--md-primary);
    flex-shrink: 0;
}
</style>
