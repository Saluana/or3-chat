import { defineOr3Plugin } from '@or3/plugin-sdk';

export const dashboardInsightsManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.dashboard-insights',
    name: 'Dashboard Insights',
    version: '2.0.0',
    description: 'First-party Plugin Runtime V2 lifecycle and SDK sample.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: {
            entry: 'client.mjs',
            format: 'esm',
            isolation: 'host',
        },
    },
    requestedGrants: [
        'settings.read',
        'storage.write',
        'hooks.register',
        'ui.dashboard.register',
    ],
    features: { required: ['host.contributions'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'trusted-host',
    settings: { version: 1 },
    stateCompatibility: {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    },
});

export function createDashboardInsightsPlugin(options = {}) {
    const observe = options.observe ?? (() => undefined);
    return defineOr3Plugin({
        manifest: dashboardInsightsManifest,
        async setup(context) {
            context.features.require('host.contributions');
            const displayMode = await context.settings.get('displayMode');
            if (!displayMode.ok) {
                throw new Error(`settings:${displayMode.error.code}`);
            }
            context.hooks.onAction('dashboard:opened', () => {
                observe('hook');
            });
            context.contributions.register({
                kind: 'ui.dashboard.card',
                id: 'or3.dashboard-insights.summary',
                definition: {
                    title: 'Workspace insights',
                    displayMode: displayMode.value ?? 'compact',
                },
            });
            context.onActivate(async () => {
                observe('activate');
                if (options.failOnActivate) throw new Error('sample activation failure');
                const stored = await context.storage.set('lastActivation', {
                    generation: context.generation,
                });
                if (!stored.ok) throw new Error(`storage:${stored.error.code}`);
            });
            context.onCleanup(() => observe('cleanup'));
        },
    });
}

export default createDashboardInsightsPlugin();
