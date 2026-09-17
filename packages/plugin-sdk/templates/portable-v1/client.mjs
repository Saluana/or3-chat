import { defineOr3Plugin } from '@or3/plugin-sdk';

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
    requestedGrants: ['settings.read', 'settings.write'],
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

export default defineOr3Plugin({
    manifest: exampleManifest,
    async setup(context) {
        const greeting = await context.settings.get('greeting');
        await context.settings.set(
            'lastActivation',
            new Date().toISOString()
        );
        context.logger.info('portable plugin ready', {
            generation: context.generation,
            greeting: greeting.ok ? greeting.value : null,
        });
        context.onCleanup(() => {
            context.logger.info('portable plugin cleanup');
        });
    },
});
