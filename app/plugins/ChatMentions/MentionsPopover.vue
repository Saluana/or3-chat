<template>
    <!--
    Nuxt UI Popover anchored to a virtual reference derived from TipTap's clientRect.
    We render only the content slot via portal; no trigger UI needed.
  -->
    <UPopover
        :open="open"
        :dismissible="false"
        :content="popoverContentProps"
        :ui="{ content: 'p-0 bg-transparent border-none shadow-none' }"
    >
        <template #content>
            <MentionsList
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
import MentionsList from './MentionsList.vue';

interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
    score?: number;
}

const props = defineProps<{
    items: MentionItem[];
    command: (item: MentionItem) => void;
    // TipTap suggestion provides a function returning DOMRect to anchor the popup
    getReferenceClientRect?: () => DOMRect | null;
    open: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
}>();

const listRef = ref<InstanceType<typeof MentionsList> | null>(null);

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

// Wrap the command to forward to the original TipTap command
function handleCommand(item: MentionItem) {
    props.command(item);
}

// Create a virtual reference object compatible with Floating UI via Reka/Popover
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

// Keep Popover glued to caret while typing by updating every frame
const popoverContentProps = computed(() => ({
    side: 'top' as const,
    align: 'start' as const,
    sideOffset: 6,
    updatePositionStrategy: 'always' as const,
    reference: virtualReference as any,
    // Hint to Popover implementation not to steal focus on open
    trapFocus: false as any,
    openAutoFocus: false as any,
    closeAutoFocus: false as any,
}));

function onKeyDown(payload: any) {
    return listRef.value?.onKeyDown(payload);
}

// Allow external imperative control to close the popover
function hide() {
    emit('close');
}

defineExpose({
    onKeyDown,
    hide,
});
</script>

<style scoped>
/* No wrapper styling; MentionsList provides its own panel styles */
</style>
