<script setup lang="ts">
import { computed } from 'vue';
import {
    resolveToolCard,
    toolCardBindingKey,
    type ToolCardBinding
} from '~/composables/chat/tool-cards';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import type { ToolCardMessage } from '~/utils/chat/tool-card-context';
import ToolCallIndicator from '../ToolCallIndicator.vue';
import ToolCardSlot from './ToolCardSlot.vue';
import DelegationActivity from '../DelegationActivity.vue';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
const props = defineProps<{
    toolCalls: ToolCallInfo[];
    message: ToolCardMessage;
}>();
const emit = defineEmits<{ resize: [] }>();
const blocks = computed(() => {
    const out: { calls: ToolCallInfo[]; binding?: ToolCardBinding; delegation?: boolean }[] = [];
    for (const call of props.toolCalls) {
        if (call.name === DELEGATE_CHAT_TOOL) { out.push({ calls: [call], delegation: true }); continue; }
        const binding = resolveToolCard(call.name);
        const ready =
            binding && (binding.renderWhile === 'always' || call.status === 'complete');
        if (ready && binding.placement === 'end') continue;
        if (ready) out.push({ calls: [call], binding });
        else {
            const previous = out.at(-1);
            if (previous && !previous.binding && !previous.delegation) previous.calls.push(call);
            else out.push({ calls: [call] });
        }
    }
    return out;
});
</script>
<template>
    <template v-for="(block, index) in blocks" :key="block.calls[0]?.id ?? index"
        ><DelegationActivity v-if="block.delegation" :call="block.calls[0]!" :message-id="message.id" />
        <ToolCardSlot
            v-else-if="block.binding"
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
