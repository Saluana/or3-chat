<template>
    <!--
        Workflow Slash Command Popover
        Wraps WorkflowList in a UPopover anchored to the TipTap cursor position.
    -->
    <UPopover
        :open="open"
        :dismissible="false"
        :content="popoverContentProps"
        :ui="{ content: 'p-0 bg-transparent border-none shadow-none' }"
    >
        <template #content>
            <WorkflowList
                ref="listRef"
                :items="items"
                :command="handleCommand"
            />
        </template>
    </UPopover>
</template>

<script setup lang="ts">
import WorkflowList from './WorkflowList.vue';
import type { WorkflowItem } from './useWorkflowSlashCommands';
import { useSuggestionPopover } from '../shared/suggestion-popover';

const props = defineProps<{
    items: WorkflowItem[];
    command: (item: { id: string; label: string }) => void;
    // TipTap suggestion provides a function returning DOMRect to anchor the popup
    getReferenceClientRect?: () => DOMRect | null;
    open: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
}>();

const { handleCommand, hide, listRef, onKeyDown, popoverContentProps } =
    useSuggestionPopover(
        props,
        () => emit('close'),
        (item: WorkflowItem) => ({
            id: item.id,
            label: item.label,
        })
    );

defineExpose({
    onKeyDown,
    hide,
});
</script>

<style scoped>
/* Popover wrapper - styling handled by WorkflowList */
</style>
