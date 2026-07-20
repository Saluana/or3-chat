import type { Or3WorkspacePlugin } from '~/composables/plugins/workspace-runtime';

// The production-output verifier uses this stable marker to prove that Vite's
// workspace-plugin glob captured an unchanged V1 module in both build modes.
export const V1_BUILD_FIXTURE_SENTINEL = 'or3-v1-build-fixture:message-action';

const plugin: Or3WorkspacePlugin = {
    id: 'runtime-v1-build-fixture',
    register(api) {
        api.registerMessageAction({
            id: V1_BUILD_FIXTURE_SENTINEL,
            icon: 'pixelarticons:check',
            tooltip: 'Plugin Runtime V1 production build fixture',
            showOn: 'both',
            handler: () => {},
        });
    },
};

export default plugin;
