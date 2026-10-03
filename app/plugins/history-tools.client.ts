import { registerHistoryTools } from '~/utils/chat/history-tools';

export default defineNuxtPlugin(() => {
    const dispose = registerHistoryTools();
    if (import.meta.hot) import.meta.hot.dispose(dispose);
});
