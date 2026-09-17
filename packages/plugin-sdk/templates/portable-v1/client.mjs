import { createPortablePlugin, defineOr3Plugin, definePortableUi, ui } from '@or3/plugin-sdk';

export const exampleManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.example-plugin',
    name: 'Example Plugin',
    version: '0.1.0',
    description:
        'Portable Plugin Runtime V2 starter conformant with or3-portable-client-v1.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: {
            entry: 'client.mjs',
            format: 'esm',
            isolation: 'worker',
        },
    },
    requestedGrants: ['settings.read', 'settings.write', 'ui.dashboard.register'],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    },
});

/**
 * The sandbox imports this module and never calls into it, so activation is
 * started by `createPortablePlugin` at module scope. Everything the plugin can
 * do arrives through the host bootstrap: identity, features and grants.
 */
export default createPortablePlugin(
    defineOr3Plugin({
        manifest: exampleManifest,
        async setup(context) {
            const stored = await context.settings.get('greeting');
            const greeting =
                stored.ok && typeof stored.value === 'string' && stored.value.length > 0
                    ? stored.value
                    : 'Hello from OR3';

            const saved = await context.settings.set('lastActivation', new Date().toISOString());
            context.logger.info('portable plugin ready', {
                generation: context.generation,
                greeting,
                settingsWritable: saved.ok,
            });

            context.contributions.register({
                kind: 'ui.dashboard.card',
                id: 'or3.example-plugin.greeting',
                definition: definePortableUi({
                    title: 'Example Plugin',
                    nodes: [ui.text(greeting)],
                }),
            });
            context.render(
                definePortableUi({
                    title: 'Example Plugin',
                    nodes: [
                        ui.text(`Greeting: ${greeting}`),
                        ui.text(
                            saved.ok
                                ? 'Settings are writable for this workspace.'
                                : 'Settings are read-only: this workspace has not approved settings.write.'
                        ),
                    ],
                })
            );

            context.onCleanup(() => {
                context.logger.info('portable plugin cleanup');
            });
        },
    })
);
