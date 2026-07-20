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
        const valid = {
            kind: 'plugin',
            id: 'strict-v2-plugin',
            name: 'Strict V2 Plugin',
            version: '2.0.0',
            capabilities: [],
            manifestVersion: 2,
        } as const;

        expect(Or3ExtensionManifestSchema.parse(valid)).toEqual(valid);
        expect(Or3ExtensionManifestV2Schema.safeParse(valid).success).toBe(true);
        expect(
            Or3ExtensionManifestSchema.safeParse({
                ...valid,
                undeclaredV2Field: true,
            }).success
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
