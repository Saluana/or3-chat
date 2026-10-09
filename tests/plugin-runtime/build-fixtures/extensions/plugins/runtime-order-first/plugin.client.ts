import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';
import { registerMessageAction } from '~/composables/chat/useMessageActions';

const plugin: Or3WorkspacePlugin = {
    id: 'runtime-order-first',
    async register(api) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        api.registerMessageAction({
            id: 'fixture:startup-first',
            icon: 'pixelarticons:check',
            tooltip: 'First plugin is ready',
            showOn: 'both',
            handler: () => {},
        });
        // Older plugins may manage resources outside the passed API. Their
        // explicit async cleanup still has to finish before another plugin starts.
        const resource = registerMessageAction({
            id: 'fixture:cleanup-first',
            icon: 'pixelarticons:check',
            tooltip: 'First plugin owns this until cleanup finishes',
            showOn: 'both',
            handler: () => {},
        });
        api.onCleanup(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            resource.dispose();
        });
    },
};

export default plugin;
