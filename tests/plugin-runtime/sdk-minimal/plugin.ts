import {
    defineOr3Plugin,
    type PluginManifestV2,
} from '@or3/plugin-sdk';

const manifest = {
    manifestVersion: 2,
    kind: 'plugin',
    id: 'sample.sdk-minimal',
    name: 'SDK Minimal Plugin',
    version: '2.0.0',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: {
            entry: 'dist/client.mjs',
            format: 'esm',
            isolation: 'host',
        },
    },
    requestedGrants: ['hooks.register', 'ui.dashboard.register'],
    features: { required: ['host.contributions'], optional: ['host.telemetry'] },
    dependencies: { required: [], optional: [] },
    trust: 'trusted-host',
    settings: { version: 1 },
    stateCompatibility: {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    },
} as const satisfies PluginManifestV2;

export default defineOr3Plugin({
    manifest,
    setup(context) {
        context.features.require('host.contributions');
        context.features.optional('host.telemetry');
        context.hooks.onAction<[message: string]>('chat.message:created', (message) => {
            context.logger.debug('message observed', { length: message.length });
        });
        context.contributions.register({
            kind: 'ui.dashboard.card',
            id: 'sample.sdk-minimal.card',
            definition: { title: 'SDK-only card' },
        });
        context.onCleanup(() => undefined);
    },
});
