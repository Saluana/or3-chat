/**
 * Single authoring source for the Selected Document Utility descriptors.
 *
 * This lives in a dot-directory on purpose. It is a Node-only authoring tool,
 * not shipped plugin code:
 *
 * - `node_modules` and dot-directories are skipped by both the OR3 conformance
 *   reviewers and the `or3-plugin` packer, so this file never becomes part of
 *   the published package.
 * - It is the only place that imports `@or3/plugin-sdk/profile`.
 *
 * Run `bun .authoring/generate.mjs` to (re)write `or3.manifest.json`,
 * `or3.package-policy.json`, and `or3.setup.json` from this configuration.
 * Run `bun .authoring/generate.mjs --check` to fail if the committed files have
 * drifted. The repository also has a vitest drift guard that calls
 * `buildArtifacts()` directly.
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
    dataScopes: ['documents.read', 'settings.read'],
    writes: ['documents.write', 'settings.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'summaryStyle',
            label: 'Summary style',
            kind: 'select',
            required: false,
            order: 1,
            default: 'bullets',
            choices: ['bullets', 'prose'],
        },
        {
            key: 'maxOutlineSentences',
            label: 'Max outline sentences',
            kind: 'number',
            required: false,
            order: 2,
            default: 5,
        },
        {
            key: 'includeStatistics',
            label: 'Include statistics',
            kind: 'toggle',
            required: false,
            order: 3,
            default: true,
        },
    ],
    testAction: { operationId: 'documents.read', deadlineMs: 5000 },
    firstAction: {
        operationId: 'documents.write',
        label: 'Summarize selected document',
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
    id: 'or3.selected-document-utility',
    name: 'Selected Document Utility',
    version: '1.0.0',
    description:
        'Free, offline selected-document summarizer that turns the current selection into a compact digest.',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: {
        client: {
            entry: 'client.mjs',
            format: 'esm',
            isolation: 'worker',
        },
    },
    requestedGrants: [
        'documents.read',
        'documents.write',
        'settings.read',
        'settings.write',
        'ui.command-palette.register',
    ],
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
