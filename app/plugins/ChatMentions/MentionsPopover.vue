<template>
    <!--
    Nuxt UI Popover anchored to a virtual reference derived from TipTap's clientRect.
    We render only the content slot via portal; no trigger UI needed.
    The panel styling is fully handled by MentionsList.
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
import MentionsList from './MentionsList.vue';
import { useSuggestionPopover } from '../shared/suggestion-popover';

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

const { handleCommand, hide, listRef, onKeyDown, popoverContentProps } =
    useSuggestionPopover(props, () => emit('close'));

defineExpose({
    onKeyDown,
    hide,
});
</script>

<style scoped>
/* No wrapper styling; MentionsList provides its own panel styles */
</style>
