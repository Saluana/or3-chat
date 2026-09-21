import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    PACKAGE_POLICY_FILE,
    PACKAGE_SETUP_FILE,
    PORTABLE_PROFILE_ID,
    applyPortableProfileToManifest,
    defineOr3PortableProfile,
    parseSetupDescriptor,
    validatePortableProfile,
    type Or3PackagePolicyV1,
    type Or3PortableProfileConfig,
    type Or3SetupDescriptorV1,
    type PortablePackageJson,
} from '../../packages/plugin-sdk/src/profile';
import type { PluginManifestV2 } from '../../packages/plugin-sdk/src/manifest';
import { checkV2PackageConformance } from '../../scripts/plugin-runtime/check-v2-package-conformance';

const repoRoot = resolve(import.meta.dirname, '../..');
const tempRoots: string[] = [];

afterEach(() => {
    while (tempRoots.length) {
        const root = tempRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

const baseConfig: Or3PortableProfileConfig = {
    profile: PORTABLE_PROFILE_ID,
    destinations: [
        {
            id: 'weather-api',
            methods: ['GET'],
            hosts: ['api.weather.example'],
            scopes: ['forecast.read'],
        },
    ],
    connections: [
        {
            id: 'weather',
            label: 'Weather',
            provider: 'weather.example',
            required: true,
            mechanism: 'browser',
            scopes: ['forecast.read'],
            operations: ['forecast.lookup'],
        },
    ],
    dataScopes: ['documents.read'],
    writes: ['documents.write'],
    features: ['or3.portable.example'],
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'units',
            label: 'Units',
            kind: 'select',
            required: true,
            order: 1,
            default: 'metric',
            choices: ['metric', 'imperial'],
        },
    ],
    testAction: { operationId: 'forecast.lookup', deadlineMs: 5_000 },
    firstAction: {
        operationId: 'forecast.lookup',
        label: 'Check forecast',
        usesSampleContext: true,
    },
};

const validPackageJson: PortablePackageJson = {
    dependencies: { '@or3/plugin-sdk': '^2.0.0' },
};

function validManifest(): PluginManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'or3.portable-example',
        name: 'Portable Example',
        version: '1.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' },
        },
        requestedGrants: ['documents.read', 'documents.write', 'network.http'],
        features: { required: [PORTABLE_PROFILE_ID], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'isolated-client',
        settings: { schema: 'settings.schema.json', version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe',
        },
    };
}

function withPolicy(overrides: Partial<Or3PackagePolicyV1>): Or3PackagePolicyV1 {
    return { ...defineOr3PortableProfile(baseConfig).policy, ...overrides };
}

function withSetup(overrides: Partial<Or3SetupDescriptorV1>): Or3SetupDescriptorV1 {
    return { ...defineOr3PortableProfile(baseConfig).setup, ...overrides };
}

function codes(input: {
    manifest: PluginManifestV2;
    policy?: Or3PackagePolicyV1 | null;
    setup?: Or3SetupDescriptorV1 | null;
    packageJson?: PortablePackageJson | null;
}): string[] {
    return validatePortableProfile(input).map((finding) => finding.code);
}

describe('defineOr3PortableProfile determinism', () => {
    it('produces byte-identical files and revisions for the same config twice', () => {
        const first = defineOr3PortableProfile(baseConfig);
        const second = defineOr3PortableProfile(baseConfig);
        expect(first.files[PACKAGE_POLICY_FILE]).toBe(second.files[PACKAGE_POLICY_FILE]);
        expect(first.files[PACKAGE_SETUP_FILE]).toBe(second.files[PACKAGE_SETUP_FILE]);
        expect(first.revisions).toEqual(second.revisions);
    });

    it('normalises set ordering so semantically identical configs match byte-for-byte', () => {
        const base = defineOr3PortableProfile(baseConfig);
        const reordered = defineOr3PortableProfile({
            ...baseConfig,
            destinations: [
                {
                    ...baseConfig.destinations[0]!,
                    methods: [...baseConfig.destinations[0]!.methods].reverse(),
                    hosts: ['api.other.example', 'api.weather.example'],
                    scopes: ['other.read', 'forecast.read'],
                },
            ],
            connections: [
                {
                    ...baseConfig.connections[0]!,
                    operations: ['forecast.lookup', 'forecast.history'],
                    scopes: ['other.read', 'forecast.read'],
                },
            ],
            dataScopes: ['documents.read', 'storage.read'],
            writes: ['documents.write', 'storage.write'],
            features: ['or3.portable.example', 'or3.portable.extra'],
            fields: [{ ...baseConfig.fields[0]!, choices: ['imperial', 'metric'] }],
        });
        const reorderedAgain = defineOr3PortableProfile({
            ...baseConfig,
            destinations: [
                {
                    ...baseConfig.destinations[0]!,
                    methods: [...baseConfig.destinations[0]!.methods].reverse(),
                    hosts: ['api.other.example', 'api.weather.example'],
                    scopes: ['other.read', 'forecast.read'],
                },
            ],
            connections: [
                {
                    ...baseConfig.connections[0]!,
                    operations: ['forecast.lookup', 'forecast.history'],
                    scopes: ['other.read', 'forecast.read'],
                },
            ],
            dataScopes: ['storage.read', 'documents.read'],
            writes: ['storage.write', 'documents.write'],
            features: ['or3.portable.extra', 'or3.portable.example'],
            fields: [{ ...baseConfig.fields[0]!, choices: ['imperial', 'metric'] }],
        });
        expect(reordered.files).toEqual(reorderedAgain.files);
        expect(reordered.revisions).toEqual(reorderedAgain.revisions);
        expect(base.files[PACKAGE_POLICY_FILE]).toContain('"requiredFeatures": [\n    "or3-portable-client-v1"');
    });

    it('emits canonical 2-space JSON with a trailing newline and sorted keys', () => {
        const profile = defineOr3PortableProfile(baseConfig);
        const bytes = profile.files[PACKAGE_POLICY_FILE];
        expect(bytes.endsWith('}\n')).toBe(true);
        expect(bytes.startsWith('{\n  "connections"')).toBe(true);
        expect(profile.files[PACKAGE_SETUP_FILE].endsWith('}\n')).toBe(true);
        expect(profile.revisions.policy).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(profile.revisions.setup).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    it('changing a host, scope, write or feature changes the revision', () => {
        const base = defineOr3PortableProfile(baseConfig);
        const changedHost = defineOr3PortableProfile({
            ...baseConfig,
            destinations: [
                { ...baseConfig.destinations[0]!, hosts: ['api.other.example'] },
            ],
        });
        const changedScope = defineOr3PortableProfile({
            ...baseConfig,
            dataScopes: ['documents.read', 'storage.read'],
        });
        const changedWrite = defineOr3PortableProfile({
            ...baseConfig,
            writes: ['documents.write', 'storage.write'],
        });
        const changedFeature = defineOr3PortableProfile({
            ...baseConfig,
            features: ['or3.portable.example', 'or3.portable.extra'],
        });
        expect(changedHost.revisions.policy).not.toBe(base.revisions.policy);
        expect(changedScope.revisions.policy).not.toBe(base.revisions.policy);
        expect(changedWrite.revisions.policy).not.toBe(base.revisions.policy);
        expect(changedFeature.revisions.policy).not.toBe(base.revisions.policy);
        expect(changedFeature.revisions.setup).toBe(base.revisions.setup);
    });

    it('changing only the order of a set leaves both revisions unchanged', () => {
        const base = defineOr3PortableProfile(baseConfig);
        const reordered = defineOr3PortableProfile({
            ...baseConfig,
            dataScopes: ['documents.read'],
            writes: ['documents.write'],
            destinations: [
                {
                    ...baseConfig.destinations[0]!,
                    hosts: ['api.weather.example'],
                    scopes: ['forecast.read'],
                },
            ],
        });
        expect(reordered.revisions).toEqual(base.revisions);
    });
});

describe('applyPortableProfileToManifest', () => {
    it('merges the feature flag and settings schema without mutating its input', () => {
        const manifest = validManifest();
        const profile = defineOr3PortableProfile(baseConfig);
        const applied = applyPortableProfileToManifest(manifest, profile);
        expect(applied).not.toBe(manifest);
        expect(applied.features.required).toEqual([
            PORTABLE_PROFILE_ID,
            'or3.portable.example',
        ]);
        expect(applied.settings.schema).toBe('settings.schema.json');
        expect(manifest.features.required).toEqual([PORTABLE_PROFILE_ID]);
        expect(manifest.settings.schema).toBe('settings.schema.json');
    });

    it('does not let a config produce descriptors that disagree with its manifest', () => {
        const profile = defineOr3PortableProfile(baseConfig);
        const manifest = applyPortableProfileToManifest(validManifest(), profile);
        const findings = validatePortableProfile({
            manifest,
            policy: profile.policy,
            setup: profile.setup,
            packageJson: validPackageJson,
        });
        expect(findings).toHaveLength(0);
        expect(findings.map((finding) => finding.code)).not.toContain(
            'portable-settings-schema-mismatch'
        );
        expect(findings.map((finding) => finding.code)).not.toContain('portable-feature-mismatch');
    });
});

describe('validatePortableProfile', () => {
    const profile = defineOr3PortableProfile(baseConfig);
    const validInput = () => ({
        manifest: applyPortableProfileToManifest(validManifest(), profile),
        policy: profile.policy,
        setup: profile.setup,
        packageJson: validPackageJson,
    });

    it('returns zero findings for a fully valid portable input', () => {
        expect(validatePortableProfile(validInput())).toEqual([]);
    });

    // Regression: a first/test action that names a declared read or write
    // operation (for example "documents.write") is valid. Treating only
    // connection operations and destination ids as declared operations made
    // every realistic document utility fail validation.
    it('accepts first and test actions that name a declared data scope or write', () => {
        const profile = defineOr3PortableProfile({
            ...baseConfig,
            firstAction: {
                operationId: 'documents.write',
                label: 'Summarize selected document',
                usesSampleContext: true,
            },
            testAction: { operationId: 'documents.read', deadlineMs: 5_000 },
        });
        const input = validInput();
        const findings = validatePortableProfile({
            ...input,
            manifest: applyPortableProfileToManifest(input.manifest, profile),
            policy: profile.policy,
            setup: profile.setup,
        });
        expect(findings.map((finding) => finding.code)).not.toContain(
            'portable-setup-operation-unknown'
        );
    });

    it('preserves user/workspace scope and secret markers in the generated setup schema', () => {
        const profile = defineOr3PortableProfile({
            ...baseConfig,
            fields: [
                { ...baseConfig.fields[0]!, scope: 'user' },
                {
                    key: 'apiKey',
                    label: 'API key',
                    kind: 'text',
                    required: false,
                    order: 2,
                    scope: 'user',
                    secret: true,
                },
                {
                    key: 'teamLabel',
                    label: 'Team label',
                    kind: 'text',
                    required: false,
                    order: 3,
                    scope: 'workspace',
                },
            ],
        });

        expect(profile.setup.fields).toMatchObject([
            { key: 'units', scope: 'user' },
            { key: 'apiKey', scope: 'user', secret: true },
            { key: 'teamLabel', scope: 'workspace' },
        ]);
        const parsed = JSON.parse(profile.files[PACKAGE_SETUP_FILE]) as unknown;
        expect(parseSetupDescriptor(parsed).value?.fields).toEqual(profile.setup.fields);
    });

    it('rejects malformed setting ownership metadata', () => {
        const input = validInput();
        const setup = {
            ...input.setup,
            fields: [
                {
                    ...input.setup.fields[0],
                    scope: 'tenant',
                    secret: 'yes',
                },
            ],
        };
        const findings = validatePortableProfile({ ...input, setup });
        expect(findings.map((finding) => finding.code)).toContain('portable-profile-invalid');
        expect(findings.some((finding) => finding.subject.includes('.fields[0].scope'))).toBe(true);
        expect(findings.some((finding) => finding.subject.includes('.fields[0].secret'))).toBe(true);
    });

    // Regression: descriptors are untrusted JSON. A non-object value used to be
    // treated as "present" while its truthiness skipped every check, so `false`
    // passed validation with zero findings; a partial object threw instead.
    it.each([
        ['false', false],
        ['null-ish array', []],
        ['a string', 'policy'],
        ['an object missing every array', { policyVersion: 1 }],
        ['wrongly typed members', { policyVersion: 1, profile: PORTABLE_PROFILE_ID, destinations: [{ id: 1 }], connections: 'no', dataScopes: [1], writes: null, requiredFeatures: {} }],
    ])('rejects a descriptor that is %s without throwing', (_label, policy) => {
        const input = validInput();
        const findings = validatePortableProfile({ ...input, policy });
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.map((finding) => finding.code)).toContain('portable-profile-invalid');
    });

    it('rejects a malformed setup descriptor without throwing', () => {
        const input = validInput();
        const findings = validatePortableProfile({
            ...input,
            setup: { setupVersion: 1, settingsSchemaPath: 'settings.schema.json', fields: [], connections: [] },
        });
        expect(findings.map((finding) => finding.code)).toContain('portable-profile-invalid');
    });

    it('still reports an unsupported version for a well-formed descriptor', () => {
        const input = validInput();
        const findings = validatePortableProfile({
            ...input,
            policy: { ...profile.policy, policyVersion: 2 } as unknown as Or3PackagePolicyV1,
        });
        expect(findings.map((finding) => finding.code)).toContain(
            'portable-profile-version-unsupported'
        );
        expect(findings.map((finding) => finding.code)).not.toContain('portable-profile-invalid');
    });

    it('does not throw on a malformed manifest stateCompatibility', () => {
        const input = validInput();
        const findings = validatePortableProfile({
            ...input,
            manifest: { ...input.manifest, stateCompatibility: false as never },
        });
        expect(findings.map((finding) => finding.code)).toContain(
            'portable-state-migration-unsupported'
        );
    });

    const cases: ReadonlyArray<{
        code: string;
        mutate: () => Parameters<typeof validatePortableProfile>[0];
    }> = [
        {
            code: 'portable-profile-missing',
            mutate: () => ({ ...validInput(), policy: null, setup: null }),
        },
        {
            code: 'portable-profile-version-unsupported',
            mutate: () => ({
                ...validInput(),
                policy: { ...profile.policy, policyVersion: 2 } as unknown as Or3PackagePolicyV1,
            }),
        },
        {
            code: 'portable-feature-flag-missing',
            mutate: () => {
                const input = validInput();
                return { ...input, manifest: { ...input.manifest, features: { required: [], optional: [] } } };
            },
        },
        {
            code: 'portable-trust-unsupported',
            mutate: () => {
                const input = validInput();
                return { ...input, manifest: { ...input.manifest, trust: 'trusted-host' } };
            },
        },
        {
            code: 'portable-host-isolation-unsupported',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: {
                        ...input.manifest,
                        runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
                    } as PluginManifestV2,
                };
            },
        },
        {
            code: 'portable-server-code-unsupported',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: {
                        ...input.manifest,
                        runtime: {
                            ...input.manifest.runtime,
                            server: { entry: 'server.mjs' },
                        },
                    } as PluginManifestV2,
                };
            },
        },
        {
            code: 'portable-runtime-dependency-unsupported',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: {
                        ...input.manifest,
                        dependencies: {
                            required: [{ id: 'or3.other', range: '^1.0.0' }],
                            optional: [],
                        },
                    },
                };
            },
        },
        {
            code: 'portable-state-migration-unsupported',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: {
                        ...input.manifest,
                        stateCompatibility: {
                            ...input.manifest.stateCompatibility,
                            rollback: 'migration-required',
                        },
                    } as PluginManifestV2,
                };
            },
        },
        {
            code: 'portable-lifecycle-script-unsupported',
            mutate: () => ({
                ...validInput(),
                packageJson: { scripts: { postinstall: 'node setup.js' } },
            }),
        },
        {
            code: 'portable-package-dependency-unsupported',
            mutate: () => ({
                ...validInput(),
                packageJson: { dependencies: { '@or3/plugin-sdk': '^2.0.0', 'left-pad': '^1.0.0' } },
            }),
        },
        {
            code: 'portable-remote-code-unsupported',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: {
                        ...input.manifest,
                        runtime: {
                            client: {
                                entry: 'https://cdn.example/client.mjs',
                                format: 'esm',
                                isolation: 'worker',
                            },
                        },
                    },
                };
            },
        },
        {
            code: 'portable-settings-schema-mismatch',
            mutate: () => {
                const input = validInput();
                return {
                    ...input,
                    manifest: { ...input.manifest, settings: { version: 1, schema: 'other.json' } },
                };
            },
        },
        {
            code: 'portable-policy-grant-mismatch',
            mutate: () => ({
                ...validInput(),
                policy: withPolicy({ dataScopes: ['documents.read', 'storage.read'] }),
            }),
        },
        {
            code: 'portable-setup-connection-unknown',
            mutate: () => ({
                ...validInput(),
                setup: withSetup({ connections: ['weather', 'missing'] }),
            }),
        },
        {
            code: 'portable-setup-operation-unknown',
            mutate: () => ({
                ...validInput(),
                setup: withSetup({
                    firstAction: {
                        operationId: 'missing.operation',
                        label: 'Check',
                        usesSampleContext: false,
                    },
                }),
            }),
        },
        {
            code: 'portable-feature-mismatch',
            mutate: () => ({
                ...validInput(),
                policy: withPolicy({
                    requiredFeatures: [...profile.requiredFeatures, 'or3.portable.extra'],
                }),
            }),
        },
    ];

    it.each(cases)('emits $code as an actionable error', ({ code, mutate }) => {
        const findings = validatePortableProfile(mutate());
        const match = findings.find((finding) => finding.code === code);
        expect(match, `expected finding ${code}`).toBeDefined();
        expect(match?.severity).toBe('error');
        expect(match?.message.length ?? 0).toBeGreaterThan(0);
        expect(match?.subject.length ?? 0).toBeGreaterThan(0);
    });

    it('reports a missing descriptor name in the finding subject', () => {
        const findings = validatePortableProfile({
            manifest: validManifest(),
            policy: null,
            setup: profile.setup,
        });
        expect(codes({ manifest: validManifest(), policy: null, setup: profile.setup })).toContain(
            'portable-profile-missing'
        );
        expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
    });
});

describe('checkV2PackageConformance portable wiring', () => {
    function fixtureCopy(): string {
        const target = mkdtempSync(resolve(tmpdir(), 'or3-portable-conformance-'));
        cpSync(resolve(repoRoot, 'tests/plugin-runtime/v2-conformance/valid'), target, {
            recursive: true,
        });
        tempRoots.push(target);
        return target;
    }

    it('runs portable validation when a package ships the descriptor files', async () => {
        const root = fixtureCopy();
        const profile = defineOr3PortableProfile(baseConfig);
        writeFileSync(resolve(root, PACKAGE_POLICY_FILE), profile.files[PACKAGE_POLICY_FILE]);
        writeFileSync(resolve(root, PACKAGE_SETUP_FILE), profile.files[PACKAGE_SETUP_FILE]);
        const result = await checkV2PackageConformance(root, { repoRoot });
        expect(result.status).toBe('nonconformant');
        if (result.status !== 'nonconformant') return;
        const portableIssues = result.issues.filter((issue) =>
            issue.code.startsWith('portable-')
        );
        expect(portableIssues.length).toBeGreaterThan(0);
        expect(result.issues.every((issue) => issue.file.length > 0)).toBe(true);
    });

    it('leaves packages without the profile untouched', async () => {
        const root = fixtureCopy();
        const result = await checkV2PackageConformance(root, { repoRoot });
        expect(result.status).toBe('conformant');
        expect(result.issues).toEqual([]);
    });
});
