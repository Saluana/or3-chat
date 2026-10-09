import { registerHistoryTools } from '~/utils/chat/history-tools';

export default defineNuxtPlugin(() => {
    try {
        const dispose = registerHistoryTools();
        if (import.meta.hot) import.meta.hot.dispose(dispose);
    } catch (error) {
        console.warn('[history-tools] History retrieval is unavailable.', error);
    }
});
