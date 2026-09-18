/**
 * Authoring source for the Prompt Workbench descriptors. Node-only, never
 * shipped. Run `bun .authoring/generate.mjs [--check]`.
 */

import {
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
} from '@or3/plugin-sdk/profile';

export const PORTABLE_FEATURE_ID = 'or3-portable-client-v1';

export const authoringConfig = Object.freeze({
    profile: PORTABLE_FEATURE_ID,
    destinations: [],
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
    dataScopes: ['settings.read', 'storage.read'],
    writes: ['settings.write', 'storage.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'defaultTemplate',
            label: 'Default template ({{name}} variables)',
            kind: 'text',
            required: false,
            order: 1,
        },
    ],
    testAction: { operationId: 'models.list', deadlineMs: 10_000 },
    firstAction: {
        operationId: 'chat.completions.create',
        label: 'Summarize the selection with a reusable template',
        usesSampleContext: true,
        samplePath: 'fixtures/sample-selection.txt',
    },
});

export const baseManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.prompt-workbench',
    name: 'Prompt Workbench',
    version: '1.0.0',
    description: 'Build reusable prompts with variables, preview them, and save versioned presets.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: [
        'network.http',
        'settings.read',
        'settings.write',
        'storage.read',
        'storage.write',
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
