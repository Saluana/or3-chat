/**
 * Single authoring source for this portable plugin's descriptors.
 *
 * This lives in a dot-directory on purpose. It is a Node-only authoring tool,
 * not shipped plugin code:
 *
 * - Dot-directories and test files are skipped by both the OR3 conformance
 *   scanner and the `or3-plugin` packer, so this file never becomes part of the
 *   published package.
 * - It is the only place that imports `@or3/plugin-sdk/profile`. Runtime files
 *   must never import it; the portable profile is an authoring-only surface.
 *
 * Run `bun .authoring/generate.mjs` to (re)write `or3.manifest.json`,
 * `or3.package-policy.json`, and `or3.setup.json` from this configuration.
 * Run `bun .authoring/generate.mjs --check` to fail if the committed files have
 * drifted.
 */

import {
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
} from '@or3/plugin-sdk/profile';

export const PORTABLE_FEATURE_ID = 'or3-portable-client-v1';

/**
 * The one configuration that generates both descriptor files. Changing this is
 * the only supported way to change the policy or setup descriptors.
 */
export const authoringConfig = Object.freeze({
    profile: PORTABLE_FEATURE_ID,
    destinations: [],
    connections: [],
    dataScopes: ['settings.read'],
    writes: ['settings.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'greeting',
            label: 'Greeting',
            kind: 'text',
            required: false,
            order: 1,
            default: 'Hello from OR3',
        },
    ],
    testAction: { operationId: 'settings.read', deadlineMs: 5000 },
    firstAction: {
        operationId: 'settings.write',
        label: 'Save greeting',
        usesSampleContext: true,
    },
});

/**
 * Manifest fields the author owns. `features.required` and `settings.schema`
 * are filled in by `applyPortableProfileToManifest()` so the manifest cannot
 * disagree with the generated descriptors.
 */
export const baseManifest = Object.freeze({
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
    features: { required: [], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1, schema: 'settings.schema.json' },
    stateCompatibility: {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    },
});

/** The same 2-space + trailing newline convention the OR3 packer uses. */
export function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generate every committed descriptor from the single authoring config. */
export function buildArtifacts() {
    const profile = defineOr3PortableProfile(authoringConfig);
    const manifest = applyPortableProfileToManifest(baseManifest, profile);
    return {
        profile,
        manifest,
        files: {
            'or3.manifest.json': stableJson(manifest),
            'or3.package-policy.json': profile.files['or3.package-policy.json'],
            'or3.setup.json': profile.files['or3.setup.json'],
        },
    };
}
