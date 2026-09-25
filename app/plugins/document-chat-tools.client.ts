import { registerDocumentChatTools } from '~/utils/documents/document-chat-tools';

export default defineNuxtPlugin(() => {
    const dispose = registerDocumentChatTools();
    if (import.meta.hot) import.meta.hot.dispose(dispose);
});
