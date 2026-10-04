import { defineNitroPlugin } from 'nitropack/runtime';
import { registerServerHistoryTools } from '../utils/chat/history-tools';

export default defineNitroPlugin((app) => {
    const dispose = registerServerHistoryTools();
    app.hooks.hook('close', dispose);
});
