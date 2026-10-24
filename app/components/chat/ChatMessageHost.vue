<template>
    <component
        :is="renderer"
        v-bind="$attrs"
        :message="message"
        :thread-id="threadId"
        :retry-disabled="retryDisabled"
        :compaction-action="compactionAction"
        :history-retrieval-available="historyRetrievalAvailable"
        @view-compaction-source="viewCompactionSource"
        @view-related-thread="viewRelatedThread"
        @begin-edit="beginEdit"
        @cancel-edit="endEdit"
        @save-edit="endEdit"
    />
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

defineOptions({ inheritAttrs: false });

type CompactionSourceTarget = {
    threadId: string;
    messageId: string;
    originThreadId: string;
    scrollMessageId?: string;
};
type RelatedThreadTarget = {
    threadId: string;
    originThreadId: string;
    anchorMessageId: string;
    generation: number;
};

const props = defineProps<{
    renderer: Component;
    message: UiChatMessage;
    threadId?: string;
    retryDisabled: boolean;
    compactionAction: { start: (anchorMessageId?: string) => Promise<void>; blockedReason?: string };
    historyRetrievalAvailable: boolean;
    onViewCompactionSource: (message: UiChatMessage, target: CompactionSourceTarget) => void;
    onViewRelatedThread: (message: UiChatMessage, target: RelatedThreadTarget) => void;
    onBeginEdit: (id: string) => void;
    onEndEdit: (id: string) => void;
}>();

// Keep row-specific listeners stable at the lazy renderer boundary. Read the
// current prop when invoked so replacement history cannot leave stale targets.
// Other renderer events retain their original listeners through $attrs.
function viewCompactionSource(target: CompactionSourceTarget) {
    props.onViewCompactionSource(props.message, target);
}
function viewRelatedThread(target: RelatedThreadTarget) {
    props.onViewRelatedThread(props.message, target);
}
function beginEdit() {
    props.onBeginEdit(props.message.id);
}
function endEdit() {
    props.onEndEdit(props.message.id);
}
</script>
