import { describe, expect, it } from 'vitest';
import type { Or3PackagePolicyV1, Or3SetupDescriptorV1 } from '@or3/plugin-sdk/profile';
import { FAKE_CONNECTION_PROVIDER } from '~~/shared/plugins/connections/fake-provider';
import { resolveSetupTestTarget } from '../test-target';

const setup: Or3SetupDescriptorV1 = {
    setupVersion: 1,
    settingsSchemaPath: 'settings.schema.json',
    fields: [],
    connections: ['docs'],
    testAction: { operationId: 'items.list', deadlineMs: 5_000 },
    firstAction: {
        operationId: 'summarize',
        label: 'Summarize',
        usesSampleContext: true,
    },
};

const policy: Or3PackagePolicyV1 = {
    policyVersion: 1,
    profile: 'or3-portable-client-v1',
    destinations: [],
    dataScopes: [],
    writes: [],
    requiredFeatures: [],
    connections: [
        {
            id: 'docs',
            label: 'Docs provider',
            provider: 'fake',
            required: true,
            mechanism: 'server',
            scopes: ['read:items'],
            operations: ['items.list'],
        },
    ],
};

function resolve(overrides: Partial<Parameters<typeof resolveSetupTestTarget>[0]> = {}) {
    return resolveSetupTestTarget({
        setup,
        policy,
        provider: FAKE_CONNECTION_PROVIDER,
        slotId: 'docs',
        ...overrides,
    });
}

describe('server-side setup test target (review 4.3)', () => {
    it('derives the URL from the approved operation, not from the caller', () => {
        const result = resolve();
        expect(result).toMatchObject({
            ok: true,
            target: {
                operationId: 'items.list',
                url: 'https://fake.provider.test/v1/',
                deadlineMs: 5_000,
            },
        });
    });

    it('refuses a non-idempotent or write operation as a test', () => {
        const result = resolve({
            setup: { ...setup, testAction: { operationId: 'items.create', deadlineMs: 5_000 } },
        });
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.message).toContain('not read-only');
    });

    it('refuses an operation the release does not approve for the slot', () => {
        const result = resolve({
            policy: {
                ...policy,
                connections: [{ ...policy.connections[0]!, operations: [] }],
            },
        });
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.message).toContain('does not approve');
    });

    it('refuses a connection that is not bound to a declared slot', () => {
        expect(resolve({ slotId: undefined })).toMatchObject({ ok: false });
        const unknown = resolve({ slotId: 'ghost' });
        expect(unknown).toMatchObject({ ok: false });
        if (unknown.ok) return;
        expect(unknown.message).toContain('does not declare');
    });

    it('refuses a package whose slot names another provider', () => {
        const result = resolve({
            policy: {
                ...policy,
                connections: [{ ...policy.connections[0]!, provider: 'other' }],
            },
        });
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.message).toContain('belongs to provider other');
    });

    it('bounds a package-declared deadline and defaults a non-finite one', () => {
        const clamped = resolve({
            setup: { ...setup, testAction: { operationId: 'items.list', deadlineMs: 10_000_000 } },
        });
        expect(clamped).toMatchObject({ ok: true, target: { deadlineMs: 30_000 } });
        const tiny = resolve({
            setup: { ...setup, testAction: { operationId: 'items.list', deadlineMs: 1 } },
        });
        expect(tiny).toMatchObject({ ok: true, target: { deadlineMs: 1_000 } });
    });

    it('refuses when the package declares no test action', () => {
        const { testAction: _unused, ...withoutTest } = setup;
        const result = resolve({ setup: withoutTest as Or3SetupDescriptorV1 });
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.message).toContain('no setup test action');
    });
});
