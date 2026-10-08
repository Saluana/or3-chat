<script setup lang="ts">
import { computed } from 'vue';
import {
    resolveToolCard,
    toolCardBindingKey,
    type ToolCardBinding
} from '~/composables/chat/tool-cards';
import type { ToolCallInfo, UiChatMessage } from '~/utils/chat/uiMessages';
import ToolCallIndicator from '../ToolCallIndicator.vue';
import ToolCardSlot from './ToolCardSlot.vue';
const props = defineProps<{
    toolCalls: ToolCallInfo[];
    message: UiChatMessage;
}>();
const emit = defineEmits<{ resize: [] }>();
const blocks = computed(() => {
    const out: { calls: ToolCallInfo[]; binding?: ToolCardBinding }[] = [];
    for (const call of props.toolCalls) {
        const binding = resolveToolCard(call.name);
        const ready =
            binding && (binding.renderWhile === 'always' || call.status === 'complete');
        if (ready && binding.placement === 'end') continue;
        if (ready) out.push({ calls: [call], binding });
        else {
            const previous = out.at(-1);
            if (previous && !previous.binding) previous.calls.push(call);
            else out.push({ calls: [call] });
        }
    }
    return out;
});
</script>
<template>
    <template v-for="(block, index) in blocks" :key="block.calls[0]?.id ?? index"
        ><ToolCardSlot
            v-if="block.binding"
            :key="toolCardBindingKey(block.binding)"
            :binding="block.binding"
            :call="block.calls[0]!"
            :message="message"
            @resize="emit('resize')" /><ToolCallIndicator
            v-else
            :tool-calls="block.calls"
            @resize="emit('resize')"
    /></template>
</template>
