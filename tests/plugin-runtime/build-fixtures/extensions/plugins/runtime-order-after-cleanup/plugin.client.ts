import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';
import { listRegisteredMessageActionIds } from '~/composables/chat/useMessageActions';

const plugin: Or3WorkspacePlugin = {
    id: 'runtime-order-after-cleanup',
    register(api) {
        if (listRegisteredMessageActionIds().includes('fixture:cleanup-first')) {
            throw new Error('The previous plugin must finish cleanup before this plugin starts');
        }
        api.registerMessageAction({
            id: 'fixture:after-cleanup',
            icon: 'pixelarticons:check',
            tooltip: 'Replacement plugin is ready',
            showOn: 'both',
            handler: () => {},
        });
    },
};

export default plugin;
