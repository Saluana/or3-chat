import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePackageMock = vi.fn();
const writeSetupValuesMock = vi.fn();
let body: Record<string, unknown> = {};

const DIGEST_A = `sha256-${'a'.repeat(64)}`;
const DIGEST_B = `sha256-${'b'.repeat(64)}`;

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
    getQuery: () => ({}),
    getRouterParam: () => 'sample.plugin',
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
    writeSetupValues: (...args: unknown[]) => writeSetupValuesMock(...args),
    writeUnscopedSetupValues: vi.fn(),
    SetupValuesRevisionConflictError: class extends Error {},
}));

vi.mock('../../../admin/plugins/package-store', () => ({
    ImmutablePluginPackageStore: class {
        constructor(..._args: unknown[]) {}
    },
}));

vi.mock('../../../admin/plugins/package-pointer-store', () => ({
    PluginPackagePointerStore: class {
        constructor(..._args: unknown[]) {}
        async readPointer() {
            return null;
        }
    },
}));

vi.mock('../../../utils/plugins/acquisition/operation-store', () => ({
    PluginAcquisitionOperationStore: class {
        async list() {
            return [];
        }
    },
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
            digest: DIGEST_B,
        });
        writeSetupValuesMock.mockReset().mockResolvedValue(1);
    });

    it('rejects a form loaded before the candidate package was replaced', async () => {
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'setup-package-conflict' },
        });
        expect(writeSetupValuesMock).not.toHaveBeenCalled();
    });
});
