import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
    Or3PackagePolicyV1,
    Or3SetupDescriptorV1,
} from '@or3/plugin-sdk/profile';
import {
    buildFirstActionHandoff,
    buildSetupPlan,
    describeSetupStatus,
    type HostConnectionCapability,
} from '../plan';
import {
    loadPackageDescriptors,
    POLICY_DESCRIPTOR_FILE,
    SETUP_DESCRIPTOR_FILE,
} from '~~/server/utils/plugins/setup/load-descriptors';

const policy: Pick<Or3PackagePolicyV1, 'connections'> = {
    connections: [
        {
            id: 'docs',
            label: 'Docs provider',
            provider: 'fake',
            required: true,
            mechanism: 'server',
            scopes: ['read:items'],
            operations: ['items.list'],
            externalCost: 'Free during setup tests',
        },
        {
            id: 'optional-feed',
            label: 'Optional feed',
            provider: 'fake',
            required: false,
            mechanism: 'server',
            scopes: [],
            operations: [],
        },
    ],
};

/** The host capability list the plan validates declared requirements against. */
const hostConnections: HostConnectionCapability[] = [
    {
        provider: 'fake',
        mechanism: 'server',
        scopes: ['read:items'],
        operations: ['items.list'],
    },
];

const setup: Or3SetupDescriptorV1 = {
    setupVersion: 1,
    settingsSchemaPath: 'settings.schema.json',
    fields: [
        {
            key: 'workspace',
            label: 'Workspace name',
            kind: 'text',
            required: true,
            order: 1,
        },
        {
            key: 'tone',
            label: 'Tone',
            kind: 'select',
            required: false,
            order: 2,
            choices: ['concise', 'detailed'],
        },
        {
            key: 'verbose',
            label: 'Verbose output',
            kind: 'toggle',
            required: false,
            order: 3,
            default: false,
        },
    ],
    connections: ['docs', 'optional-feed'],
    testAction: { operationId: 'items.list', deadlineMs: 5000 },
    firstAction: {
        operationId: 'summarize',
        label: 'Summarize selection',
        usesSampleContext: false,
    },
};

describe('setup plan (4.10)', () => {
    it('reports needs-setup while a required field is unset', () => {
        const plan = buildSetupPlan({ setup, policy, hostConnections });
        expect(plan.status).toBe('needs-setup');
        const workspace = plan.fields.find((field) => field.key === 'workspace');
        expect(workspace).toMatchObject({ required: true, missing: true });
        expect(plan.blockers.some((blocker) => blocker.includes('Workspace name'))).toBe(true);
        expect(describeSetupStatus(plan)).toMatchObject({
            status: 'needs-setup',
            label: 'Needs setup',
            nextAction: 'Provide Workspace name',
        });
    });

    it('defers optional settings with defaults instead of blocking', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        });
        const tone = plan.fields.find((field) => field.key === 'tone');
        const verbose = plan.fields.find((field) => field.key === 'verbose');
        expect(tone).toMatchObject({ required: false, deferred: true, missing: false });
        expect(verbose).toMatchObject({ deferred: true, defaultValue: false });
    });

    it.each([undefined, 'unsafe-default'])('blocks required secrets even with default %s', (defaultValue) => {
        const plan = buildSetupPlan({
            setup: {
                ...setup,
                fields: [
                    ...setup.fields,
                    {
                        key: 'apiKey',
                        label: 'API key',
                        kind: 'text',
                        required: true,
                        order: 4,
                        scope: 'user',
                        secret: true,
                        ...(defaultValue === undefined ? {} : { default: defaultValue }),
                    },
                ],
            },
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        });
        expect(plan.fields.find((field) => field.key === 'workspace')).toMatchObject({
            scope: 'workspace',
            secret: false,
        });
        expect(plan.fields.find((field) => field.key === 'apiKey')).toMatchObject({
            scope: 'user',
            secret: true,
            deferred: true,
            missing: true,
        });
        expect(
            plan.blockers.some(
                (blocker) => blocker.includes('API key') && blocker.includes('secret custody')
            )
        ).toBe(true);
        // Ordinary settings can never satisfy the secret, so the package is
        // blocked rather than offered as something the user can finish.
        expect(plan.status).toBe('blocked');
        expect(describeSetupStatus(plan)).toMatchObject({ status: 'blocked', blocked: true });
    });

    it('keeps an optional secret deferred instead of blocking readiness', () => {
        const plan = buildSetupPlan({
            setup: {
                ...setup,
                fields: [
                    ...setup.fields,
                    {
                        key: 'apiKey',
                        label: 'API key',
                        kind: 'text',
                        required: false,
                        order: 4,
                        secret: true,
                    },
                ],
            },
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        });
        expect(plan.fields.find((field) => field.key === 'apiKey')).toMatchObject({
            secret: true,
            deferred: true,
            missing: false,
        });
        expect(plan.blockers.some((blocker) => blocker.includes('API key'))).toBe(false);
        expect(plan.status).toBe('needs-setup');
    });

    it('is never ready while a required connection is untested (IN02)', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        });
        expect(plan.status).toBe('needs-setup');
        const docs = plan.connections.find((connection) => connection.id === 'docs');
        expect(docs).toMatchObject({ required: true, satisfied: false, usable: true });
        expect(docs?.blockedReason).toBe('Not connected yet');
        expect(describeSetupStatus(plan).nextAction).toContain('Docs provider');
    });

    it('becomes ready only with settings and connections satisfied (IN01)', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(plan.status).toBe('ready');
        expect(plan.blockers).toEqual([]);
        expect(describeSetupStatus(plan)).toMatchObject({ status: 'ready', label: 'Ready' });
    });

    it('returns to needs-setup when the stored credential lacks a scope or fails its test', () => {
        const base = {
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        };
        const missingScope = buildSetupPlan({
            ...base,
            hostConnections,
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: [],
                    testPassed: true,
                },
            ],
        });
        expect(missingScope.status).toBe('needs-setup');
        expect(
            missingScope.connections.find((connection) => connection.id === 'docs')?.blockedReason
        ).toBe('Connected credential is missing a required scope');

        const failedTest = buildSetupPlan({
            ...base,
            hostConnections,
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: false,
                },
            ],
        });
        expect(failedTest.status).toBe('needs-setup');
    });

    it('blocks instead of pretending when a mechanism is unsupported', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            values: { workspace: 'Team notes' },
            hostConnections: [
                {
                    provider: 'fake',
                    mechanism: 'browser',
                    scopes: ['read:items'],
                    operations: ['items.list'],
                },
            ],
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(plan.status).not.toBe('ready');
        expect(describeSetupStatus(plan)).toMatchObject({ status: 'blocked', blocked: true });
    });

    it('treats an empty required value as unsupplied (review 4.5)', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: '   ' },
        });
        expect(plan.fields.find((field) => field.key === 'workspace')).toMatchObject({
            missing: true,
        });
        expect(plan.status).toBe('needs-setup');
    });

    it('satisfies a declared slot only through an explicit binding (review 4.1)', () => {
        // A stored, tested connection with no slot binding satisfies nothing: the
        // policy's connection ids are symbolic, the stored id is host-generated.
        const unbound = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'some-other-slot',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(unbound.status).toBe('needs-setup');
        expect(
            unbound.connections.find((connection) => connection.id === 'docs')?.blockedReason
        ).toBe('Not connected yet');
    });

    it('refuses a binding whose stored provider is not the declared provider', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'other',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(plan.status).toBe('needs-setup');
        expect(
            plan.connections.find((connection) => connection.id === 'docs')?.blockedReason
        ).toBe('The connected credential belongs to another provider');
    });

    it('blocks when the registered provider does not declare a required operation (review 4.9)', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections: [
                {
                    provider: 'fake',
                    mechanism: 'server',
                    scopes: ['read:items'],
                    operations: [],
                },
            ],
            values: { workspace: 'Team notes' },
        });
        expect(plan.status).toBe('blocked');
        expect(describeSetupStatus(plan)).toMatchObject({
            status: 'blocked',
            blocked: true,
        });
        expect(
            plan.connections.find((connection) => connection.id === 'docs')?.blockedReason
        ).toContain('does not declare items.list');
    });

    it('blocks when no registered provider can serve a declared requirement', () => {
        const plan = buildSetupPlan({
            setup,
            policy,
            hostConnections: [],
            values: { workspace: 'Team notes' },
        });
        expect(plan.status).toBe('blocked');
        expect(
            plan.connections.find((connection) => connection.id === 'docs')?.blockedReason
        ).toContain('no connection provider named "fake"');
    });

    it('reports a connection declared by setup but missing from the policy', () => {
        const plan = buildSetupPlan({
            setup: { ...setup, connections: ['docs', 'ghost'] },
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
        });
        expect(plan.blockers.some((blocker) => blocker.includes('ghost'))).toBe(true);
        expect(plan.status).toBe('needs-setup');
    });

    it('hands the first action off on a sample or selection, never on nothing', () => {
        const ready = buildSetupPlan({
            setup,
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(buildFirstActionHandoff({ plan: ready, hasSelectedContext: false })).toMatchObject({
            ready: false,
            contextKind: 'selected',
            reason: expect.stringContaining('Select a document'),
        });
        expect(buildFirstActionHandoff({ plan: ready, hasSelectedContext: true })).toMatchObject({
            ready: true,
            operationId: 'summarize',
        });

        const samplePlan = buildSetupPlan({
            setup: {
                ...setup,
                firstAction: {
                    operationId: 'summarize',
                    label: 'Try the sample',
                    usesSampleContext: true,
                    samplePath: 'fixtures/sample.md',
                },
            },
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(
            buildFirstActionHandoff({ plan: samplePlan, hasSelectedContext: false })
        ).toMatchObject({ ready: true, contextKind: 'sample' });
        // Selected context wins over the sample; the fixture is only a fallback.
        expect(
            buildFirstActionHandoff({ plan: samplePlan, hasSelectedContext: true })
        ).toMatchObject({ ready: true, contextKind: 'selected' });

        // Legacy v1 shape: usesSampleContext without a sample path is valid and
        // simply requires a selection instead of falling back to a fixture.
        const noSamplePlan = buildSetupPlan({
            setup: {
                ...setup,
                firstAction: {
                    operationId: 'summarize',
                    label: 'Try it',
                    usesSampleContext: true,
                },
            },
            policy,
            hostConnections,
            values: { workspace: 'Team notes' },
            connectionStates: [
                {
                    slotId: 'docs',
                    connectionId: 'conn-1',
                    ref: 'orc_conn-1_r1',
                    providerId: 'fake',
                    scopes: ['read:items'],
                    testPassed: true,
                },
            ],
        });
        expect(
            buildFirstActionHandoff({ plan: noSamplePlan, hasSelectedContext: false })
        ).toMatchObject({ ready: false, contextKind: 'selected', reasonCode: 'selection-required' });

        const notReady = buildSetupPlan({ setup, policy, hostConnections });
        expect(
            buildFirstActionHandoff({ plan: notReady, hasSelectedContext: true }).ready
        ).toBe(false);
    });
});

describe('descriptor loading (4.10)', () => {
    const dirs: string[] = [];
    afterEach(async () => {
        for (const dir of dirs) {
            await rm(dir, { recursive: true, force: true });
        }
        dirs.length = 0;
    });

    async function makePackage(files: Record<string, unknown>) {
        const base = await mkdtemp(join(tmpdir(), 'or3-setup-'));
        dirs.push(base);
        const packagePath = join(base, 'plugins', 'example');
        await mkdir(packagePath, { recursive: true });
        for (const [name, contents] of Object.entries(files)) {
            await writeFile(
                join(packagePath, name),
                typeof contents === 'string' ? contents : JSON.stringify(contents)
            );
        }
        return { base, packagePath };
    }

    it('loads valid descriptors from an installed package', async () => {
        const { base, packagePath } = await makePackage({
            [SETUP_DESCRIPTOR_FILE]: setup,
            [POLICY_DESCRIPTOR_FILE]: {
                policyVersion: 1,
                profile: 'or3-portable-client-v1',
                destinations: [
                    { id: 'docs', methods: ['GET'], hosts: ['fake.provider.test'], scopes: ['read:items'] },
                ],
                connections: policy.connections,
                dataScopes: [],
                writes: [],
                requiredFeatures: ['or3-portable-client-v1'],
            },
        });
        const loaded = await loadPackageDescriptors({ extensionsBaseDir: base, packagePath });
        expect(loaded.problems).toEqual([]);
        expect(loaded.setup?.fields).toHaveLength(3);
        expect(loaded.policy?.connections[0]?.id).toBe('docs');
    });

    it('reports missing and malformed descriptors instead of guessing', async () => {
        const empty = await makePackage({});
        const missing = await loadPackageDescriptors({
            extensionsBaseDir: empty.base,
            packagePath: empty.packagePath,
        });
        expect(missing.setup).toBeNull();
        expect(missing.policy).toBeNull();
        expect(missing.problems).toHaveLength(2);

        const malformed = await makePackage({
            [SETUP_DESCRIPTOR_FILE]: '{"setupVersion":99}',
            [POLICY_DESCRIPTOR_FILE]: '{"policyVersion":1}',
        });
        const loaded = await loadPackageDescriptors({
            extensionsBaseDir: malformed.base,
            packagePath: malformed.packagePath,
        });
        expect(loaded.setup).toBeNull();
        expect(loaded.policy).toBeNull();
        expect(loaded.problems.length).toBeGreaterThanOrEqual(2);
    });

    it('refuses a package path outside the extensions directory', async () => {
        const { base } = await makePackage({});
        await expect(
            loadPackageDescriptors({
                extensionsBaseDir: base,
                packagePath: join(base, '..', 'elsewhere'),
            })
        ).rejects.toThrow(/escapes the extensions directory/);
    });
});
