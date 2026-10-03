import ContextCompactionCard from '~/components/chat/ContextCompactionCard.vue';
import { registerMessageRenderer } from '~/composables/chat/message-renderers';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { registerComposerAction } from '~/composables/sidebar/useComposerActions';
import { registerThreadHistoryAction, unregisterThreadHistoryAction } from '~/composables/threads/useThreadHistoryActions';
import { getWorkspaceGeneration } from '~/db/client';
import { CompactionError, inspectCompactionSource } from '~/db/compaction';
import { isThreadCompactionActive } from '~/composables/chat/useThreadCompaction';

export default defineNuxtPlugin(() => {
    const handle = registerMessageRenderer({
        id: 'or3:context-compaction',
        match: (message) => {
            const row = message as UiChatMessage;
            return row.role === 'system' && Boolean(row.compaction);
        },
        component: ContextCompactionCard,
    });
    const composer = registerComposerAction({ id: 'or3:compact-thread', icon: 'i-lucide-fold-vertical',
        tooltip: 'Summarize this chat', label: 'Compact', order: 190,
        visible: (ctx) => Boolean(ctx.threadId && ctx.compactThread),
        disabled: (ctx) => Boolean(ctx.isLoading || ctx.isStreaming || ctx.compactionBlockedReason),
        handler: async (ctx) => { await ctx.compactThread?.(); } });
    registerThreadHistoryAction({ id: 'or3:compact-thread-history', icon: 'i-lucide-fold-vertical', label: 'Compact conversation', order: 190,
        disabledReason: ({ threadId }) => isThreadCompactionActive(threadId) ? 'A compaction is already active for this conversation.' : undefined,
        inspectDisabledReason: async ({ document }) => {
            try { await inspectCompactionSource(document.id); return undefined; }
            catch (error) { return error instanceof CompactionError ? error.message : 'Conversation history is unavailable. Open it and retry explicitly.'; }
        },
        handler: async ({ document }) => {
            if (isThreadCompactionActive(document.id)) return;
            await inspectCompactionSource(document.id);
            window.dispatchEvent(new CustomEvent('or3:compact-thread', {
            detail: { threadId: document.id, generation: getWorkspaceGeneration() },
        })); } });
    if (import.meta.hot) import.meta.hot.dispose(() => { handle.dispose(); composer.dispose(); unregisterThreadHistoryAction('or3:compact-thread-history'); });
});
