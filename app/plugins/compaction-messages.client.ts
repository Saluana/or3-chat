import ContextCompactionCard from '~/components/chat/ContextCompactionCard.vue';
import { registerMessageRenderer } from '~/composables/chat/message-renderers';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { registerMessageAction, unregisterMessageAction } from '~/composables/chat/useMessageActions';
import { registerComposerAction } from '~/composables/sidebar/useComposerActions';

export default defineNuxtPlugin(() => {
    const handle = registerMessageRenderer({
        id: 'or3:context-compaction',
        match: (message) => {
            const row = message as UiChatMessage;
            return row.role === 'system' && Boolean(row.compaction);
        },
        component: ContextCompactionCard,
    });
    registerMessageAction({ id: 'or3:compact-here', icon: 'i-lucide-fold-vertical', tooltip: 'Compact here',
        showOn: 'both', order: 190, visible: (ctx) => Boolean(ctx.compaction && ctx.message.id),
        disabled: (ctx) => Boolean(ctx.compaction?.blockedReason || ctx.message.pending),
        handler: async (ctx) => { await ctx.compaction?.start(ctx.message.id); } });
    const composer = registerComposerAction({ id: 'or3:compact-thread', icon: 'i-lucide-fold-vertical',
        tooltip: 'Compact conversation', label: 'Compact', order: 190,
        visible: (ctx) => Boolean(ctx.threadId && ctx.compactThread),
        disabled: (ctx) => Boolean(ctx.isLoading || ctx.isStreaming || ctx.compactionBlockedReason),
        handler: async (ctx) => { await ctx.compactThread?.(); } });
    if (import.meta.hot) import.meta.hot.dispose(() => { handle.dispose(); composer.dispose(); unregisterMessageAction('or3:compact-here'); });
});
