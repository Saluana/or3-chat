import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';
import { listRegisteredMessageActionIds } from '~/composables/chat/useMessageActions';

const plugin: Or3WorkspacePlugin = {
    id: 'runtime-order-second',
    register(api) {
        if (!listRegisteredMessageActionIds().includes('fixture:startup-first')) {
            throw new Error('The first plugin must finish registering before this plugin starts');
        }
        api.registerMessageAction({
            id: 'fixture:startup-second',
            icon: 'pixelarticons:check',
            tooltip: 'Dependent plugin is ready',
            showOn: 'both',
            handler: () => {},
        });
    },
};

export default plugin;
