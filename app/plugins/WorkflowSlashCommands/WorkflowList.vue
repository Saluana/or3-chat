<template>
    <div
        class="w-[320px] max-h-[300px] bg-(--md-surface) flex flex-col border-(length:--md-border-width) border-(--md-border-color) rounded-(--md-border-radius) shadow-lg overflow-hidden"
    >
        <!-- Empty state -->
        <div
            v-if="items.length === 0"
            class="flex flex-col items-center justify-center py-8 px-4 text-center"
        >
            <UIcon
                name="tabler:binary-tree-2"
                class="text-3xl mb-2 opacity-50"
            />
            <p class="text-sm opacity-70">No workflows found</p>
            <p class="text-xs opacity-50 mt-1">
                Create a workflow to use slash commands
            </p>
        </div>

        <!-- Workflow list -->
        <div
            v-else
            class="overflow-y-auto"
            role="listbox"
            :aria-activedescendant="`workflow-item-${selectedIndex}`"
        >
            <button
                v-for="(item, idx) in items"
                :key="item.id"
                :id="`workflow-item-${idx}`"
                type="button"
                role="option"
                :aria-selected="idx === selectedIndex"
                :class="[
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer',
                    'hover:bg-(--md-surface-container-high)',
                    {
                        'bg-(--md-surface-container-highest)':
                            idx === selectedIndex,
                    },
                ]"
                @click="selectItem(idx)"
                @mouseenter="selectedIndex = idx"
            >
                <div
                    class="shrink-0 w-8 h-8 rounded-md bg-(--md-primary)/10 flex items-center justify-center"
                >
                    <UIcon
                        name="tabler:binary-tree-2"
                        class="text-lg text-(--md-primary)"
                    />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate">
                        {{ item.label }}
                    </div>
                    <div class="text-xs opacity-60">
                        {{ formatTime(item.updatedAt) }}
                    </div>
                </div>
            </button>
        </div>

        <!-- Hint footer -->
        <div
            v-if="items.length > 0"
            class="px-3 py-2 border-t border-(--md-border-color) bg-(--md-surface-container)"
        >
            <p class="text-xs opacity-60">
                <kbd
                    class="px-1.5 py-0.5 rounded bg-(--md-surface-container-high) text-[10px] font-mono"
                    >↑↓</kbd
                >
                navigate
                <kbd
                    class="ml-2 px-1.5 py-0.5 rounded bg-(--md-surface-container-high) text-[10px] font-mono"
                    >↵</kbd
                >
                select
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { WorkflowItem } from './useWorkflowSlashCommands';

const props = defineProps<{
    items: WorkflowItem[];
    command: (item: WorkflowItem) => void;
}>();

const selectedIndex = ref(0);

// Format relative time from Unix timestamp (seconds)
function formatTime(timestamp: number): string {
    if (!timestamp) return '';

    const now = Date.now();
    const diff = now - timestamp * 1000;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

// Select item at index
function selectItem(index: number) {
    const item = props.items[index];
    if (item) {
        props.command(item);
    }
}

// Handle keyboard navigation
function onKeyDown({ event }: { event: KeyboardEvent }) {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex.value =
            (selectedIndex.value - 1 + props.items.length) % props.items.length;
        return true;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
        return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex.value);
        return true;
    }

    return false;
}

// Reset selection when items change
watch(
    () => props.items,
    () => {
        selectedIndex.value = 0;
    }
);

defineExpose({
    onKeyDown,
});
</script>

<style scoped>
/* Scrollbar styling */
.overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: var(--md-primary) transparent;
}

.overflow-y-auto::-webkit-scrollbar {
    width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
    background: var(--md-primary);
    border-radius: 9999px;
}
</style>
