<script setup lang="ts">
import { onBeforeUnmount, onMounted, watchEffect } from 'vue';
import { useChat } from '~/composables/chat/useAi';
import { assertDelegatedChatCurrent, attachDelegatedChat, finishDelegatedChat, type DelegatedChatJob } from '~/utils/chat/delegated-chat-runtime';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';

const props = defineProps<{ job: DelegatedChatJob }>();
const chat = useChat([], props.job.threadId, undefined, { forceForeground: true, excludedTools: [DELEGATE_CHAT_TOOL] });
attachDelegatedChat(props.job, chat);
watchEffect(() => {
    try { assertDelegatedChatCurrent(props.job); } catch { chat.abort(); }
}, { flush: 'sync' });
onBeforeUnmount(() => {
    chat.abort();
    finishDelegatedChat(props.job, undefined, new Error('Delegated chat was interrupted.'));
});
onMounted(async () => {
    try {
        assertDelegatedChatCurrent(props.job);
        await chat.ensureHistorySynced();
        assertDelegatedChatCurrent(props.job);
        const result = await chat.sendMessage({ content: props.job.content, model: props.job.model,
            thinking: props.job.thinking, reasoningEffort: props.job.reasoningEffort });
        finishDelegatedChat(props.job, result);
    } catch (error) {
        finishDelegatedChat(props.job, undefined, error instanceof Error ? error : new Error('Delegated chat failed.'));
    }
});
</script>
<template><span hidden /></template>
