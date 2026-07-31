import { describe, expect, it, vi } from 'vitest';
import {
    loadCompatiblePluginV2,
    verifyPluginV2Compatibility,
    type PluginV2CompatibilityManifest,
    type VerifyPluginV2CompatibilityInput,
} from '../v2-compatibility';

function manifest(
    overrides: Partial<PluginV2CompatibilityManifest> = {}
): PluginV2CompatibilityManifest {
    return {
        id: 'acme.search',
        engines: { or3: '>=0.2.0 <0.4.0', pluginApi: '^2.0.0' },
        requestedGrants: ['documents.read'],
        features: {
            required: ['host.storage'],
            optional: ['host.telemetry', 'host.experimental'],
        },
        dependencies: {
            required: [{ id: 'acme.core', range: '^2.0.0', features: ['search'] }],
            optional: [
                { id: 'acme.telemetry', range: '^1.0.0', features: ['events'] },
                { id: 'acme.missing', range: '^1.0.0', features: [] },
            ],
        },
        trust: 'trusted-host',
        ...overrides,
    };
}

function input(
    overrides: Partial<VerifyPluginV2CompatibilityInput> = {}
): VerifyPluginV2CompatibilityInput {
    return {
        manifest: manifest(),
        host: {
            or3Version: '0.3.0',
            pluginApiVersion: '2.1.0',
            supportedTrustModes: ['trusted-host'],
            supportedGrants: ['documents.read'],
            supportedFeatures: ['host.storage', 'host.telemetry'],
        },
        dependencies: [
            { id: 'acme.core', version: '2.4.0', features: ['search'] },
            { id: 'acme.telemetry', version: '1.2.0', features: ['events'] },
        ],
        ...overrides,
    };
}

describe('Plugin V2 compatibility verification', () => {
    it('returns an immutable successful feature negotiation', () => {
        const result = verifyPluginV2Compatibility(input());

        expect(result).toEqual({
            status: 'compatible',
            negotiation: {
                required: ['host.storage'],
                optionalAvailable: ['host.telemetry'],
                optionalUnavailable: ['host.experimental'],
                requiredDependencies: ['acme.core'],
                optionalDependenciesAvailable: ['acme.telemetry'],
                optionalDependenciesUnavailable: [
                    { id: 'acme.missing', reason: 'missing' },
                ],
            },
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.negotiation.optionalDependenciesUnavailable)).toBe(true);
    });

    it.each([
        [
            'OR3 host range',
            input({ manifest: manifest({ engines: { or3: '^1.0.0', pluginApi: '^2.0.0' } }) }),
            'host-engine-mismatch',
        ],
        [
            'plugin API range',
            input({ manifest: manifest({ engines: { or3: '^0.3.0', pluginApi: '^3.0.0' } }) }),
            'plugin-api-engine-mismatch',
        ],
        [
            'trust mode',
            input({ manifest: manifest({ trust: 'isolated-server' }) }),
            'unsupported-trust-mode',
        ],
        [
            'grant',
            input({ manifest: manifest({ requestedGrants: ['documents.write'] }) }),
            'unsupported-grant',
        ],
        [
            'required host feature',
            input({
                manifest: manifest({
                    features: { required: ['host.unknown'], optional: [] },
                }),
            }),
            'unsupported-required-feature',
        ],
        [
            'missing required dependency',
            input({ dependencies: [] }),
            'missing-required-dependency',
        ],
        [
            'required dependency version',
            input({
                dependencies: [
                    { id: 'acme.core', version: '3.0.0', features: ['search'] },
                ],
            }),
            'dependency-version-mismatch',
        ],
        [
            'required dependency feature',
            input({
                dependencies: [{ id: 'acme.core', version: '2.4.0', features: [] }],
            }),
            'dependency-feature-mismatch',
        ],
    ])('blocks a %s mismatch with code %s', (_label, verificationInput, code) => {
        const result = verifyPluginV2Compatibility(verificationInput);

        expect(result.status).toBe('blocked');
        if (result.status === 'blocked') {
            expect(result.reasons.map((reason) => reason.code)).toContain(code);
        }
    });

    it('reports invalid version inputs without throwing', () => {
        const result = verifyPluginV2Compatibility(
            input({
                manifest: manifest({
                    engines: { or3: 'not a range', pluginApi: '^2.0.0' },
                    dependencies: {
                        required: [
                            { id: 'acme.core', range: 'not a range', features: [] },
                        ],
                        optional: [],
                    },
                }),
                host: {
                    ...input().host,
                    pluginApiVersion: 'development',
                },
            })
        );

        expect(result.status).toBe('blocked');
        if (result.status === 'blocked') {
            expect(result.reasons.map((reason) => reason.code)).toEqual(
                expect.arrayContaining([
                    'invalid-manifest-range',
                    'invalid-host-version',
                    'invalid-dependency-range',
                ])
            );
        }
    });

    it('aggregates independent blockers for one pre-import report', () => {
        const result = verifyPluginV2Compatibility(
            input({
                manifest: manifest({
                    engines: { or3: '^1.0.0', pluginApi: '^3.0.0' },
                    requestedGrants: ['documents.write'],
                    features: { required: ['host.unknown'], optional: [] },
                    trust: 'isolated-server',
                }),
                dependencies: [],
            })
        );

        expect(result.status).toBe('blocked');
        if (result.status === 'blocked') {
            expect(result.reasons.map((reason) => reason.code)).toEqual([
                'host-engine-mismatch',
                'plugin-api-engine-mismatch',
                'unsupported-trust-mode',
                'unsupported-grant',
                'unsupported-required-feature',
                'missing-required-dependency',
            ]);
        }
    });

    it('negotiates optional dependency mismatches without blocking', () => {
        const result = verifyPluginV2Compatibility(
            input({
                dependencies: [
                    { id: 'acme.core', version: '2.4.0', features: ['search'] },
                    { id: 'acme.telemetry', version: '2.0.0', features: ['events'] },
                    { id: 'acme.missing', version: '1.0.0', features: [] },
                ],
            })
        );

        expect(result.status).toBe('compatible');
        expect(result.negotiation.optionalDependenciesUnavailable).toEqual([
            {
                id: 'acme.telemetry',
                reason: 'version-mismatch',
                expected: '^1.0.0',
                actual: '2.0.0',
            },
        ]);
    });

    it('does not invoke the importer when verification blocks', async () => {
        const importer = vi.fn(async () => ({ setup: true }));

        const result = await loadCompatiblePluginV2(
            input({ manifest: manifest({ trust: 'isolated-server' }) }),
            importer
        );

        expect(result.status).toBe('blocked');
        expect(importer).not.toHaveBeenCalled();
    });

    it('invokes the importer once after successful verification', async () => {
        const module = { setup: true };
        const importer = vi.fn(async () => module);

        const result = await loadCompatiblePluginV2(input(), importer);

        expect(result).toMatchObject({ status: 'loaded', value: module });
        expect(importer).toHaveBeenCalledTimes(1);
    });
});
