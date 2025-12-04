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
import { computed, ref } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import WorkflowList from './WorkflowList.vue';
import type { WorkflowItem } from './useWorkflowSlashCommands';

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

const listRef = ref<InstanceType<typeof WorkflowList> | null>(null);

// Handle Escape key globally when popover is open
onKeyStroke(
    'Escape',
    (e) => {
        if (props.open) {
            e.preventDefault();
            e.stopPropagation();
            emit('close');
        }
    },
    { target: typeof window !== 'undefined' ? window : undefined }
);

// Wrap the command to forward to the TipTap command
function handleCommand(item: WorkflowItem) {
    // Insert the workflow as a slash command token
    props.command({
        id: item.id,
        label: item.label,
    });
}

// Create a virtual reference for Floating UI positioning
const virtualReference = {
    getBoundingClientRect: () => {
        try {
            const rect = props.getReferenceClientRect?.();
            if (rect) return rect;
        } catch {}
        return new DOMRect(0, 0, 0, 0);
    },
    contextElement: typeof document !== 'undefined' ? document.body : undefined,
};

// Popover positioning props
const popoverContentProps = computed(() => ({
    side: 'top' as const,
    align: 'start' as const,
    sideOffset: 6,
    updatePositionStrategy: 'always' as const,
    reference: virtualReference as any,
    trapFocus: false as any,
    openAutoFocus: false as any,
    closeAutoFocus: false as any,
}));

// Forward keyboard events to the list
function onKeyDown(payload: any) {
    return listRef.value?.onKeyDown(payload);
}

// Allow external control to close
function hide() {
    emit('close');
}

defineExpose({
    onKeyDown,
    hide,
});
</script>

<style scoped>
/* Popover wrapper - styling handled by WorkflowList */
</style>
