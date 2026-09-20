import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageOperationLockError } from '../../../admin/plugins/package-operation-lock';

const resolvePackageMock = vi.fn();
const bindCandidateOperationMock = vi.fn();
const createConnectionMock = vi.fn();
const resolveConnectionMock = vi.fn();
const runSetupTestMock = vi.fn();
const resolveSetupTestTargetMock = vi.fn();
const runPluginOperationMock = vi.fn();
let body: Record<string, unknown> = {};

const DIGEST_A = `sha256-${'a'.repeat(64)}`;
const DIGEST_B = `sha256-${'b'.repeat(64)}`;

const provider = {
    id: 'openrouter',
    label: 'OpenRouter',
    mechanism: 'server' as const,
    scopes: ['models.read'],
    operations: [{ id: 'list-models' }],
};

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
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

vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: async () => body,
}));

vi.mock('../../../utils/plugins/connections/api-context', () => ({
    requirePluginMutation: () => undefined,
    requireConnectionApiContext: async () => ({
        userId: 'user-1',
        workspaceId: 'ws-1',
        durable: true,
        service: {
            create: (...args: unknown[]) => createConnectionMock(...args),
            resolve: (...args: unknown[]) => resolveConnectionMock(...args),
        },
    }),
    requireConnectionProvider: () => provider,
    readConnectionBody: async () => body,
}));

vi.mock('../../../utils/plugins/connections/setup-test', () => ({
    runConnectionSetupTest: (...args: unknown[]) => runSetupTestMock(...args),
}));

vi.mock('../../../utils/plugins/connections/transport', () => ({
    createFetchConnectionTransport: () => ({ kind: 'transport' }),
}));

vi.mock('../../../utils/plugins/setup/test-target', () => ({
    resolveSetupTestTarget: (...args: unknown[]) => resolveSetupTestTargetMock(...args),
}));

vi.mock('../../../admin/extensions/paths', () => ({
    EXTENSIONS_BASE_DIR: '/tmp/extensions',
}));

vi.mock('../../../utils/plugins/setup/discovery', () => ({
    resolvePluginPackage: (...args: unknown[]) => resolvePackageMock(...args),
    bindCandidateOperation: (...args: unknown[]) => bindCandidateOperationMock(...args),
}));

vi.mock('../../../utils/plugins/setup/load-descriptors', () => ({
    toConnectionDispatchPolicy: () => ({ policy: true }),
    loadPackageDescriptors: async () => ({
        problems: [],
        setup: { schemaVersion: 1, fields: [], firstAction: { operationId: 'noop', label: 'Noop' } },
        policy: {
            destinations: [],
            connections: [
                {
                    id: 'openrouter',
                    label: 'OpenRouter',
                    provider: 'openrouter',
                    required: true,
                    mechanism: 'server',
                    scopes: ['models.read'],
                    operations: ['list-models'],
                },
            ],
        },
    }),
}));

function selection(overrides: Record<string, unknown> = {}) {
    return {
        pluginId: 'sample.plugin',
        path: '/tmp/extensions/.store/sample.plugin/' + DIGEST_A,
        source: 'package',
        status: 'ready',
        selectedSlot: 'current',
        digest: DIGEST_A,
        manifestDigest: `sha256-${'c'.repeat(64)}`,
        pointerRevision: 1,
        stateCompatibility: null,
        issues: [],
        ...overrides,
    };
}

async function callRoute(): Promise<Record<string, unknown>> {
    const handler = (await import('../connections/index.post')).default;
    return (await handler({} as never)) as Record<string, unknown>;
}

async function callTestRoute(): Promise<Record<string, unknown>> {
    const handler = (await import('../connections/test.post')).default;
    return (await handler({} as never)) as Record<string, unknown>;
}

describe('connection creation from the verified package selection', () => {
    beforeEach(() => {
        body = {
            pluginId: 'sample.plugin',
            slotId: 'openrouter',
            credential: 'sk-or-secret',
            expectedPackageDigest: DIGEST_A,
        };
        resolvePackageMock.mockReset().mockResolvedValue(selection());
        bindCandidateOperationMock.mockReset().mockResolvedValue({
            ok: true,
            operationId: 'acq_1',
        });
        createConnectionMock.mockReset().mockResolvedValue({
            status: 'created',
            view: { id: 'conn-1', slotId: 'openrouter' },
        });
        runPluginOperationMock
            .mockReset()
            .mockImplementation(async (_pluginId: string, task: () => Promise<unknown>) =>
                await task()
            );
    });

    it('stores a declared slot for an immutable-only marketplace package', async () => {
        const response = await callRoute();
        expect(createConnectionMock).toHaveBeenCalledWith({
            ownerUserId: 'user-1',
            workspaceId: 'ws-1',
            pluginId: 'sample.plugin',
            providerId: 'openrouter',
            slotId: 'openrouter',
            label: 'OpenRouter',
            scopes: ['models.read'],
            credential: 'sk-or-secret',
        });
        expect(response).toEqual({ connection: { id: 'conn-1', slotId: 'openrouter' } });
    });

    it('binds a candidate connection to the acquisition that owns the digest', async () => {
        body = {
            ...body,
            operationId: 'acq_1',
            expectedPackageDigest: DIGEST_B,
        };
        resolvePackageMock.mockResolvedValue(
            selection({ status: 'candidate', selectedSlot: 'candidate', digest: DIGEST_B })
        );
        await callRoute();
        expect(bindCandidateOperationMock).toHaveBeenCalledWith({
            pluginId: 'sample.plugin',
            workspaceId: 'ws-1',
            candidateDigest: DIGEST_B,
            requestedOperationId: 'acq_1',
        });
        expect(createConnectionMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a candidate whose operation does not own it', async () => {
        body = {
            ...body,
            operationId: 'acq_stale',
            expectedPackageDigest: DIGEST_B,
        };
        resolvePackageMock.mockResolvedValue(
            selection({ status: 'candidate', selectedSlot: 'candidate', digest: DIGEST_B })
        );
        bindCandidateOperationMock.mockResolvedValue({
            ok: false,
            code: 'setup-operation-conflict',
            message: 'owned by another operation',
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-operation-conflict' },
        });
        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('refuses a stale setup page that names a different package', async () => {
        body = { ...body, expectedPackageDigest: DIGEST_B };
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-package-conflict' },
        });
        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('refuses a blocked package instead of falling through to a legacy extension', async () => {
        resolvePackageMock.mockResolvedValue(
            selection({
                status: 'blocked',
                path: null,
                digest: null,
                manifestDigest: null,
                selectedSlot: null,
                issues: [{ code: 'current-unavailable', message: 'current package is unavailable' }],
            })
        );
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'plugin-package-blocked' },
        });
        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('refuses a slot provider the host does not support', async () => {
        body = { ...body, providerId: 'other-provider' };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 400 });
        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('resolves the selection and creates the credential inside the lifecycle lease', async () => {
        await callRoute();
        expect(runPluginOperationMock).toHaveBeenCalledWith(
            'sample.plugin',
            expect.any(Function)
        );
        // The selection decision and the credential write both happen after
        // the lease is held, so promotion/cancellation cannot interleave.
        expect(runPluginOperationMock.mock.invocationCallOrder[0]).toBeLessThan(
            resolvePackageMock.mock.invocationCallOrder[0]!
        );
        expect(runPluginOperationMock.mock.invocationCallOrder[0]).toBeLessThan(
            createConnectionMock.mock.invocationCallOrder[0]!
        );
    });

    it('reports a busy package when another lifecycle operation holds the lease', async () => {
        runPluginOperationMock.mockRejectedValue(
            new PackageOperationLockError('lock-timeout', 'busy')
        );
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-package-busy' },
        });
        expect(resolvePackageMock).not.toHaveBeenCalled();
        expect(createConnectionMock).not.toHaveBeenCalled();
    });
});

describe('connection testing from the verified package selection', () => {
    beforeEach(() => {
        body = {
            ref: 'orc_a_r1',
            pluginId: 'sample.plugin',
            expectedPackageDigest: DIGEST_A,
        };
        resolvePackageMock.mockReset().mockResolvedValue(selection());
        bindCandidateOperationMock.mockReset().mockResolvedValue({
            ok: true,
            operationId: 'acq_1',
        });
        resolveConnectionMock.mockReset().mockResolvedValue({
            status: 'ok',
            connection: {
                providerId: 'openrouter',
                slotId: 'openrouter',
                scopes: ['models.read'],
            },
        });
        resolveSetupTestTargetMock.mockReset().mockReturnValue({
            ok: true,
            target: {
                operationId: 'list-models',
                url: 'https://api.test/models',
                deadlineMs: 5_000,
            },
        });
        runSetupTestMock.mockReset().mockResolvedValue({ status: 'passed' });
        runPluginOperationMock
            .mockReset()
            .mockImplementation(async (_pluginId: string, task: () => Promise<unknown>) =>
                await task()
            );
    });

    it('binds and dispatches the credential-backed test inside the lifecycle lease', async () => {
        await callTestRoute();
        expect(runPluginOperationMock).toHaveBeenCalledWith(
            'sample.plugin',
            expect.any(Function)
        );
        expect(runPluginOperationMock.mock.invocationCallOrder[0]).toBeLessThan(
            resolvePackageMock.mock.invocationCallOrder[0]!
        );
        expect(runPluginOperationMock.mock.invocationCallOrder[0]).toBeLessThan(
            runSetupTestMock.mock.invocationCallOrder[0]!
        );
        expect(runSetupTestMock).toHaveBeenCalledWith(
            expect.objectContaining({
                operationId: 'list-models',
                url: 'https://api.test/models',
                policy: { policy: true },
            })
        );
    });

    it('refuses a stale test form instead of dispatching it', async () => {
        body = { ...body, expectedPackageDigest: DIGEST_B };
        await expect(callTestRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-package-conflict' },
        });
        expect(runSetupTestMock).not.toHaveBeenCalled();
    });
});
