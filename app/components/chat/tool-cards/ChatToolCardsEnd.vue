<script setup lang="ts">
import { computed } from 'vue';
import { resolveToolCard, toolCardBindingKey } from '~/composables/chat/tool-cards';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import ToolCardSlot from './ToolCardSlot.vue';
const props = defineProps<{ message: UiChatMessage }>();
const emit = defineEmits<{ resize: [] }>();
const cards = computed(() =>
    (props.message.toolCalls ?? []).flatMap((call) => {
        const binding = resolveToolCard(call.name);
        return binding?.placement === 'end' &&
            (binding.renderWhile === 'always' || call.status === 'complete')
            ? [{ call, binding }]
            : [];
    })
);
</script>
<template>
    <ToolCardSlot
        v-for="{ call, binding } in cards"
        :key="(call.id ?? call.name) + toolCardBindingKey(binding)"
        :binding="binding"
        :call="call"
        :message="message"
        @resize="emit('resize')"
    />
</template>
