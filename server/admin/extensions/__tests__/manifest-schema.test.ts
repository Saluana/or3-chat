/* @vitest-environment node */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    Or3ExtensionManifestSchema,
    Or3ExtensionManifestV1Schema,
    Or3ExtensionManifestV2Schema,
} from '../types';

const v1Manifest = {
    kind: 'plugin',
    id: 'legacy-plugin',
    name: 'Legacy Plugin',
    version: '1.2.3',
    description: 'Existing manifest',
    capabilities: ['chat'],
    access: { authRequired: true },
    runtime: { client: { entry: 'plugin.client.ts' } },
    legacyPrivateMetadata: { preservedOnDisk: true },
} as const;

function validV2Manifest(overrides: Record<string, unknown> = {}) {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'strict-v2-plugin',
        name: 'Strict V2 Plugin',
        version: '2.0.0',
        capabilities: [],
        engines: {
            or3: '>=0.2.0 <0.4.0',
            pluginApi: '^2.0.0',
        },
        runtime: {
            client: {
                entry: 'dist/client.mjs',
                format: 'esm',
                isolation: 'host',
            },
        },
        requestedGrants: [],
        dependencies: { required: [], optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe',
        },
        ...overrides,
    };
}

describe('extension manifest version dispatch', () => {
    it.each([
        ['omitted', v1Manifest],
        ['null', { ...v1Manifest, manifestVersion: null }],
        ['explicit', { ...v1Manifest, manifestVersion: 1 }],
    ])('normalizes %s V1 version selection identically', (_label, input) => {
        const expected = Or3ExtensionManifestV1Schema.parse(v1Manifest);

        expect(Or3ExtensionManifestSchema.parse(input)).toEqual(expected);
        expect(expected).not.toHaveProperty('manifestVersion');
        expect(expected).not.toHaveProperty('legacyPrivateMetadata');
    });

    it('normalizes the stored first-party V1 manifest without adding a version field', async () => {
        const source = await readFile(
            resolve(process.cwd(), 'extensions/themes/cyberpunk/or3.manifest.json'),
            'utf8'
        );

        const parsed = Or3ExtensionManifestSchema.parse(JSON.parse(source));

        expect(parsed).toMatchObject({ kind: 'theme', id: 'cyberpunk' });
        expect(parsed).not.toHaveProperty('manifestVersion');
    });

    it('accepts only declared fields for V2', () => {
        const valid = validV2Manifest();

        expect(Or3ExtensionManifestSchema.parse(valid)).toEqual(valid);
        expect(Or3ExtensionManifestV2Schema.safeParse(valid).success).toBe(true);
        expect(
            Or3ExtensionManifestSchema.safeParse({
                ...valid,
                undeclaredV2Field: true,
            }).success
        ).toBe(false);
    });

    it('accepts the complete V2 package contract', () => {
        const manifest = validV2Manifest({
            runtime: {
                client: {
                    entry: 'dist/client.mjs',
                    format: 'esm',
                    isolation: 'host',
                },
                server: {
                    entry: 'dist/server.mjs',
                    routes: [
                        {
                            method: 'POST',
                            path: 'search',
                            handler: 'dist/server/search.mjs',
                            permission: 'workspace.write',
                        },
                    ],
                },
            },
            requestedGrants: ['documents.read', 'tools.register.client'],
            dependencies: {
                required: [{ id: 'acme.core', range: '^2.0.0', features: ['search'] }],
                optional: [{ id: 'acme.telemetry', range: '^1.0.0', features: [] }],
            },
            settings: { schema: 'schemas/settings.json', version: 3 },
            stateCompatibility: {
                version: 3,
                reads: { minimum: 2, maximum: 3 },
                rollback: 'migration-required',
            },
            integrity: { package: `sha256-${'a'.repeat(64)}` },
        });

        expect(Or3ExtensionManifestSchema.safeParse(manifest).success).toBe(true);
    });

    it.each([
        ['non-plugin kind', { kind: 'theme' }],
        ['uppercase id', { id: 'Acme.Plugin' }],
        ['missing OR3 engine range', { engines: { or3: '', pluginApi: '^2.0.0' } }],
        ['missing API engine range', { engines: { or3: '^0.2.0', pluginApi: '' } }],
        ['no runtime entrypoint', { runtime: {} }],
        [
            'source runtime entrypoint',
            {
                runtime: {
                    client: {
                        entry: 'src/client.ts',
                        format: 'esm',
                        isolation: 'host',
                    },
                },
            },
        ],
        [
            'traversing runtime entrypoint',
            {
                runtime: {
                    client: {
                        entry: '../client.mjs',
                        format: 'esm',
                        isolation: 'host',
                    },
                },
            },
        ],
        ['invalid grant', { requestedGrants: ['Documents Read'] }],
        ['duplicate grants', { requestedGrants: ['documents.read', 'documents.read'] }],
        [
            'duplicate dependency',
            {
                dependencies: {
                    required: [{ id: 'acme.core', range: '^2.0.0' }],
                    optional: [{ id: 'acme.core', range: '^2.0.0' }],
                },
            },
        ],
        [
            'empty dependency range',
            {
                dependencies: {
                    required: [{ id: 'acme.core', range: '' }],
                    optional: [],
                },
            },
        ],
        ['invalid settings version', { settings: { version: 0 } }],
        ['traversing settings schema', { settings: { schema: '../settings.json', version: 1 } }],
        [
            'inverted state read range',
            {
                stateCompatibility: {
                    version: 2,
                    reads: { minimum: 3, maximum: 1 },
                    rollback: 'safe',
                },
            },
        ],
        [
            'unreadable current state version',
            {
                stateCompatibility: {
                    version: 3,
                    reads: { minimum: 1, maximum: 2 },
                    rollback: 'safe',
                },
            },
        ],
        ['invalid package integrity', { integrity: { package: 'sha256-not-a-digest' } }],
    ])('rejects V2 contract state: %s', (_label, overrides) => {
        expect(
            Or3ExtensionManifestSchema.safeParse(validV2Manifest(overrides)).success
        ).toBe(false);
    });

    it('rejects trust and isolation combinations that cannot provide their claimed boundary', () => {
        expect(
            Or3ExtensionManifestSchema.safeParse(
                validV2Manifest({
                    trust: 'trusted-host',
                    runtime: {
                        client: {
                            entry: 'dist/client.mjs',
                            format: 'esm',
                            isolation: 'iframe',
                        },
                    },
                })
            ).success
        ).toBe(false);
        expect(
            Or3ExtensionManifestSchema.safeParse(
                validV2Manifest({
                    trust: 'isolated-client',
                    runtime: {
                        client: {
                            entry: 'dist/client.mjs',
                            format: 'esm',
                            isolation: 'host',
                        },
                    },
                })
            ).success
        ).toBe(false);
        expect(
            Or3ExtensionManifestSchema.safeParse(
                validV2Manifest({ trust: 'isolated-server' })
            ).success
        ).toBe(false);
    });

    it.each([0, 3, '2', false])('rejects unsupported manifest version %j', (version) => {
        expect(
            Or3ExtensionManifestSchema.safeParse({
                ...v1Manifest,
                manifestVersion: version,
            }).success
        ).toBe(false);
    });
});
