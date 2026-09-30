/**
 * Authoring source for the Document Utilities descriptors. Node-only, never
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
                'Model transforms are billed by the host model provider per token and attributed to this plugin; OR3 adds no fee.',
        },
    ],
    dataScopes: ['documents.read', 'settings.read'],
    writes: ['documents.write', 'settings.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'defaultTransform',
            label: 'Default transformation',
            kind: 'select',
            required: false,
            order: 1,
            default: 'outline',
            choices: ['outline', 'summary', 'key-points', 'action-items', 'rewrite-clear'],
        },
    ],
    testAction: { operationId: 'documents.read', deadlineMs: 5000 },
    firstAction: {
        // The selection is required: this product transforms what you selected.
        operationId: 'documents.write',
        label: 'Transform the selected document',
        usesSampleContext: false,
    },
});

export const baseManifest = Object.freeze({
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.document-utilities',
    name: 'Document Utilities',
    version: '1.0.0',
    description: 'Transform selected content and preview the result before writing anything.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: [
        'documents.read',
        'documents.write',
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
