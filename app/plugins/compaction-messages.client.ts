import ContextCompactionCard from '~/components/chat/ContextCompactionCard.vue';
import { registerMessageRenderer } from '~/composables/chat/message-renderers';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

export default defineNuxtPlugin(() => {
    const handle = registerMessageRenderer({
        id: 'or3:context-compaction',
        match: (message) => {
            const row = message as UiChatMessage;
            return row.role === 'system' && Boolean(row.compaction);
        },
        component: ContextCompactionCard,
    });
    if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
});
