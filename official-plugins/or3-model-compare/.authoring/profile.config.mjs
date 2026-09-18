/**
 * Authoring source for the Model Compare descriptors.
 *
 * Node-only, dot-directory, never shipped. Run:
 *   bun .authoring/generate.mjs           # rewrite the generated files
 *   bun .authoring/generate.mjs --check   # fail on drift
 */

import {
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
} from '@or3/plugin-sdk/profile';

export const PORTABLE_FEATURE_ID = 'or3-portable-client-v1';

export const authoringConfig = Object.freeze({
    profile: PORTABLE_FEATURE_ID,
    destinations: [],
    // The release uses the OpenRouter connection provider's model operations
    // through the host's governed `ai.complete` capability. The connection is
    // optional: the host's own provider credential serves the calls, and nothing
    // here makes the user supply a key before using the plugin.
    connections: [
        {
            id: 'models',
            label: 'OpenRouter models (host-provided)',
            provider: 'openrouter',
            required: false,
            mechanism: 'server',
            scopes: ['models:read', 'chat:completion'],
            operations: ['models.list', 'chat.completions.create'],
            externalCost:
                'Model calls are billed by the host model provider per token and attributed to this plugin; OR3 adds no fee.',
        },
    ],
    dataScopes: ['settings.read'],
    writes: ['settings.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'defaultModels',
            label: 'Default models to compare (comma-separated ids)',
            kind: 'text',
            required: false,
            order: 1,
        },
        {
            key: 'maxOutputTokens',
            label: 'Maximum output tokens per answer',
            kind: 'number',
            required: false,
            order: 2,
            default: 512,
        },
        {
            key: 'systemPrompt',
            label: 'Extra instruction (optional)',
            kind: 'text',
            required: false,
            order: 3,
        },
    ],
    testAction: { operationId: 'models.list', deadlineMs: 10_000 },
    firstAction: {
        // The declared operation is the governed completion the first action uses.
        operationId: 'chat.completions.create',
        label: 'Compare models on the sample prompt',
        usesSampleContext: true,
        samplePath: 'fixtures/sample-prompt.md',
    },
});

export const baseManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.model-compare',
    name: 'Model Compare',
    version: '1.0.0',
    description: 'Send one prompt to several host models and continue the best answer in chat.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
    },
    requestedGrants: [
        'network.http',
        'settings.read',
        'settings.write',
    ],
    features: { required: [], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
});

export function buildArtifacts() {
    const profile = defineOr3PortableProfile(authoringConfig);
    const manifest = applyPortableProfileToManifest(baseManifest, profile);
    return {
        profile,
        files: {
            'or3.manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
            ...profile.files,
        },
    };
}
