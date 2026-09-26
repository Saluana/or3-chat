import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePackageMock = vi.fn();
const patchSetupValuesMock = vi.fn();
const bindCandidateOperationMock = vi.fn();
const authorizeHostActivationMock = vi.fn();
const checkHostActivationLiveMock = vi.fn();
const runPluginOperationMock = vi.fn();
let body: Record<string, unknown> = {};
let query: Record<string, unknown> = {};

const DIGEST_A = `sha256-${'a'.repeat(64)}`;
const DIGEST_B = `sha256-${'b'.repeat(64)}`;

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
    getQuery: () => query,
    getRouterParam: () => 'sample.plugin',
}));

vi.mock('../../../admin/plugins/package-store', () => ({
    ImmutablePluginPackageStore: class {
        runPluginOperation(pluginId: string, task: () => Promise<unknown>) {
            return runPluginOperationMock(pluginId, task);
        }
    },
    PluginPackageStoreError: class extends Error {
        constructor(
            readonly code: string,
            message: string
        ) {
            super(message);
        }
    },
}));

vi.mock('../../../utils/plugins/isolation/activation-authorization', () => ({
    authorizeHostActivation: (...args: unknown[]) => authorizeHostActivationMock(...args),
    checkHostActivationLive: (...args: unknown[]) => checkHostActivationLiveMock(...args),
}));

vi.mock('../../../auth/can', () => ({
    requireCan: () => undefined,
    requireSession: () => undefined,
}));

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async () => ({
        workspace: { id: 'ws-1' },
        user: { id: 'user-1' },
    }),
}));

vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: async () => body,
}));

vi.mock('../../../utils/plugins/connections/api-context', () => ({
    requirePluginMutation: () => undefined,
}));

vi.mock('../../../admin/extensions/paths', () => ({
    EXTENSIONS_BASE_DIR: '/tmp/extensions',
}));

vi.mock('../../../utils/plugins/setup/discovery', () => ({
    resolvePluginPackage: (...args: unknown[]) => resolvePackageMock(...args),
    bindCandidateOperation: (...args: unknown[]) => bindCandidateOperationMock(...args),
}));

vi.mock('../../../utils/plugins/setup/load-descriptors', () => ({
    loadPackageDescriptors: async () => ({
        problems: [],
        setup: {
            schemaVersion: 1,
            fields: [
                {
                    key: 'token',
                    kind: 'text',
                    required: false,
                    secret: false,
                },
            ],
            firstAction: { operationId: 'noop', label: 'Noop' },
        },
        policy: { destinations: [], connections: [] },
    }),
}));

vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../utils/plugins/setup/settings-store', () => ({
    readSetupValues: vi.fn(async () => ({})),
    writeUnscopedSetupValues: vi.fn(),
    patchSetupValues: (...args: unknown[]) => patchSetupValuesMock(...args),
    SetupValuesRevisionConflictError: class extends Error {},
}));

vi.mock('~~/shared/plugins/setup/values', () => ({
    applySetupValuesPatch: ({ current, patch }: { current: Record<string, unknown>; patch: Record<string, unknown> }) => ({
        values: { ...current, ...patch },
        unknownKeys: [],
        errors: [],
    }),
}));

async function callRoute(): Promise<Record<string, unknown>> {
    const handler = (await import('../[pluginId]/setup-values.post')).default;
    return (await handler({} as never)) as Record<string, unknown>;
}

describe('setup values candidate binding', () => {
    beforeEach(() => {
        query = {};
        body = {
            values: { token: 'stale-form' },
            operationId: 'acq_oldform',
            expectedRevision: 0,
            expectedPackageDigest: DIGEST_A,
        };
        resolvePackageMock.mockReset().mockResolvedValue({
            pluginId: 'sample.plugin',
            path: '/tmp/extensions/sample.plugin',
            source: 'package',
            status: 'ready',
            selectedSlot: 'current',
            digest: DIGEST_B,
            manifestDigest: `sha256-${'c'.repeat(64)}`,
            pointerRevision: 1,
            stateCompatibility: null,
            issues: [],
        });
        patchSetupValuesMock.mockReset().mockResolvedValue({
            values: { token: 'stale-form' },
            revision: 1,
        });
        bindCandidateOperationMock.mockReset().mockResolvedValue({
            ok: true,
            operationId: 'acq_oldform',
        });
        authorizeHostActivationMock.mockReset().mockResolvedValue({
            ok: true,
            record: { pluginId: 'sample.plugin' },
            review: {},
        });
        checkHostActivationLiveMock.mockReset().mockReturnValue({
            ok: true,
            record: { pluginId: 'sample.plugin' },
        });
        runPluginOperationMock
            .mockReset()
            .mockImplementation(async (_pluginId: string, task: () => Promise<unknown>) =>
                await task()
            );
    });

    it('rejects a form loaded before the candidate package was replaced', async () => {
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-package-conflict' },
        });
        expect(patchSetupValuesMock).not.toHaveBeenCalled();
    });

    it('rejects a blocked package instead of writing through it', async () => {
        resolvePackageMock.mockResolvedValue({
            pluginId: 'sample.plugin',
            path: null,
            source: 'package',
            status: 'blocked',
            selectedSlot: null,
            digest: null,
            manifestDigest: null,
            pointerRevision: 1,
            stateCompatibility: null,
            issues: [{ code: 'current-unavailable', message: 'current package is unavailable' }],
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'plugin-package-blocked' },
        });
        expect(patchSetupValuesMock).not.toHaveBeenCalled();
    });

    it('binds a candidate to the acquisition operation that owns its digest', async () => {
        body = {
            values: { token: 'candidate' },
            operationId: null,
            expectedPackageDigest: DIGEST_B,
        };
        resolvePackageMock.mockResolvedValue({
            pluginId: 'sample.plugin',
            path: '/tmp/extensions/sample.plugin',
            source: 'package',
            status: 'candidate',
            selectedSlot: 'candidate',
            digest: DIGEST_B,
            manifestDigest: `sha256-${'c'.repeat(64)}`,
            pointerRevision: 2,
            stateCompatibility: null,
            issues: [],
        });
        await callRoute();
        expect(bindCandidateOperationMock).toHaveBeenCalledWith({
            pluginId: 'sample.plugin',
            workspaceId: 'ws-1',
            candidateDigest: DIGEST_B,
            requestedOperationId: null,
            settingsStore: expect.anything(),
        });
        expect(patchSetupValuesMock).toHaveBeenCalledWith(
            expect.anything(),
            'ws-1',
            'sample.plugin',
            expect.objectContaining({ packageDigest: DIGEST_B, operationId: 'acq_oldform' }),
            expect.any(Function),
            {}
        );
    });

    it('refuses a candidate whose owning operation no longer matches', async () => {
        body = {
            values: { token: 'candidate' },
            operationId: 'acq_other',
            expectedPackageDigest: DIGEST_B,
        };
        resolvePackageMock.mockResolvedValue({
            pluginId: 'sample.plugin',
            path: '/tmp/extensions/sample.plugin',
            source: 'package',
            status: 'candidate',
            selectedSlot: 'candidate',
            digest: DIGEST_B,
            manifestDigest: `sha256-${'c'.repeat(64)}`,
            pointerRevision: 2,
            stateCompatibility: null,
            issues: [],
        });
        bindCandidateOperationMock.mockResolvedValue({
            ok: false,
            code: 'setup-operation-conflict',
            message: 'candidate is owned by another operation',
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-operation-conflict' },
        });
        expect(patchSetupValuesMock).not.toHaveBeenCalled();
    });

    it('requires a live activation handle for a runtime save', async () => {
        query = { slot: 'current' };
        body = {
            values: { token: 'runtime' },
            expectedPackageDigest: DIGEST_B,
        };
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'activation-required' },
        });
        expect(patchSetupValuesMock).not.toHaveBeenCalled();
    });

    it('refuses a runtime save whose activation does not authorize the package', async () => {
        query = { slot: 'current' };
        body = {
            values: { token: 'runtime' },
            expectedPackageDigest: DIGEST_B,
            activationId: 'act_stale',
        };
        authorizeHostActivationMock.mockResolvedValue({
            ok: false,
            statusCode: 409,
            code: 'activation-stale',
            message: 'The selected package changed; start the plugin again',
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'activation-stale' },
        });
        expect(authorizeHostActivationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                activationId: 'act_stale',
                pluginId: 'sample.plugin',
                workspaceId: 'ws-1',
                userId: 'user-1',
                packageDigest: DIGEST_B,
            })
        );
        expect(patchSetupValuesMock).not.toHaveBeenCalled();
    });

    it('writes a runtime save that its activation authorizes', async () => {
        query = { slot: 'current' };
        body = {
            values: { token: 'runtime' },
            expectedPackageDigest: DIGEST_B,
            activationId: 'act_live',
        };
        const response = await callRoute();
        expect(authorizeHostActivationMock).toHaveBeenCalledTimes(1);
        expect(patchSetupValuesMock).toHaveBeenCalledTimes(1);
        expect(response).toMatchObject({ ok: true, packageDigest: DIGEST_B });
    });

    it('binds a runtime save to a commit guard that rechecks the live activation', async () => {
        query = { slot: 'current' };
        body = {
            values: { token: 'runtime' },
            expectedPackageDigest: DIGEST_B,
            activationId: 'act_live',
        };
        await callRoute();
        const options = patchSetupValuesMock.mock.calls[0]![5] as {
            guard?: () => void;
        };
        expect(options.guard).toBeTypeOf('function');

        // A revocation that landed after authorization (during descriptor or
        // settings reads) must make the commit guard refuse the write.
        checkHostActivationLiveMock.mockReturnValue({
            ok: false,
            statusCode: 409,
            code: 'activation-revoked',
            message: 'Activation was revoked',
        });
        expect(() => options.guard!()).toThrowError('Activation was revoked');
        expect(checkHostActivationLiveMock).toHaveBeenCalledWith('act_live');
    });

    it('resolves the package and binds its operation inside the lifecycle lease', async () => {
        body = { values: { token: 'candidate' }, expectedPackageDigest: DIGEST_B };
        resolvePackageMock.mockResolvedValue({
            pluginId: 'sample.plugin',
            path: '/tmp/extensions/sample.plugin',
            source: 'package',
            status: 'candidate',
            selectedSlot: 'candidate',
            digest: DIGEST_B,
            manifestDigest: `sha256-${'c'.repeat(64)}`,
            pointerRevision: 2,
            stateCompatibility: null,
            issues: [],
        });
        await callRoute();
        expect(runPluginOperationMock).toHaveBeenCalledWith(
            'sample.plugin',
            expect.any(Function)
        );
        // The package is resolved only after the lease is held, so a promotion
        // cannot interleave between resolution and the settings write.
        expect(runPluginOperationMock.mock.invocationCallOrder[0]).toBeLessThan(
            resolvePackageMock.mock.invocationCallOrder[0]!
        );
        expect(bindCandidateOperationMock.mock.invocationCallOrder[0]).toBeGreaterThan(
            resolvePackageMock.mock.invocationCallOrder[0]!
        );
    });
});
