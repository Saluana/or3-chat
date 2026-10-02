import { registerWorkspaceChatTools } from '~/utils/chat/workspace-chat-tools';

export default defineNuxtPlugin(() => {
    const dispose = registerWorkspaceChatTools();
    if (import.meta.hot) import.meta.hot.dispose(dispose);
});
