<template>
    <UPopover
        :open="open"
        :dismissible="false"
        :content="popoverContentProps"
        :ui="{ content: 'p-0 bg-transparent border-none shadow-none' }"
    >
        <template #content>
            <DocumentAiActionList
                ref="listRef"
                :items="items"
                :command="handleCommand"
            />
        </template>
    </UPopover>
</template>

<script setup lang="ts">
import { useSuggestionPopover } from '../shared/suggestion-popover';
import DocumentAiActionList from './DocumentAiActionList.vue';
import type { DocumentAiPromptAction } from './slashCommandExtension';

const props = defineProps<{
    items: DocumentAiPromptAction[];
    command: (item: DocumentAiPromptAction) => void;
    getReferenceClientRect?: () => DOMRect | null;
    open: boolean;
}>();

const emit = defineEmits<{ close: [] }>();
const { handleCommand, hide, listRef, onKeyDown, popoverContentProps } =
    useSuggestionPopover(props, () => emit('close'));

defineExpose({ hide, onKeyDown });
</script>
