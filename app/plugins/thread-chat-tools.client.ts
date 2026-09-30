import { registerThreadChatTools } from '~/utils/chat/thread-chat-tools';

export default defineNuxtPlugin(() => {
    const dispose = registerThreadChatTools();
    if (import.meta.hot) import.meta.hot.dispose(dispose);
});
