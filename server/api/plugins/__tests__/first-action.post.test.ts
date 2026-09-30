import { beforeEach, describe, expect, it, vi } from 'vitest';

const candidateMock = vi.fn();
const reviewMock = vi.fn();
const resolvePackageMock = vi.fn();
let body: Record<string, unknown> = {};

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusCode: number; statusMessage?: string; data?: unknown }) =>
        Object.assign(new Error(options.statusMessage ?? 'error'), options),
    readBody: async () => body,
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

vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../admin/extensions/paths', () => ({
    EXTENSIONS_BASE_DIR: '/tmp/extensions',
}));

vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: async () => body,
}));

vi.mock('../../../utils/plugins/connections/api-context', () => ({
    requirePluginMutation: () => undefined,
}));

vi.mock('../../../utils/plugins/connections/resolve', () => ({
    resolveConnectionService: () => ({ service: {}, durable: false }),
}));

vi.mock('../../../utils/plugins/setup/state', () => ({
    loadSetupState: async () => ({
        pluginId: 'sample.plugin',
        installed: true,
        packageDigest: `sha256-${'a'.repeat(64)}`,
        plan: { blockers: [] },
        firstAction: {
            operationId: 'documents.read',
            label: 'Read',
            contextKind: 'document',
            ready: true,
        },
    }),
}));

vi.mock('../../../utils/plugins/setup/discovery', () => ({
    resolvePluginPackage: (...args: unknown[]) => resolvePackageMock(...args),
}));

vi.mock('../../../admin/plugins/package-operation-support', () => ({
    packageGrantCandidate: (...args: unknown[]) => candidateMock(...args),
}));

vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({
    getPluginGrantReview: (...args: unknown[]) => reviewMock(...args),
}));

vi.mock('../../../utils/plugins/setup/selection-authority-registry', () => ({
    latestRetainedSelectionAuthority: () => ({
        mint: () => ({
            handleId: 'sel_1_1',
            kind: 'document',
            contextId: 'doc-1',
            generation: 1,
        }),
    }),
    getRetainedSelectionAuthority: () => null,
}));

function approvedReview() {
    return {
        requestedGrants: ['documents.read', 'documents.write'],
        approvedGrants: ['documents.read', 'documents.write'],
        revision: `sha256-${'b'.repeat(64)}`,
        status: 'current' as const,
        authoritySha256: `sha256-${'c'.repeat(64)}`,
        packageDigest: `sha256-${'a'.repeat(64)}`,
    };
}

async function callRoute(): Promise<Record<string, unknown>> {
    const handler = (await import('../[pluginId]/first-action.post')).default;
    return (await handler({} as never)) as Record<string, unknown>;
}

describe('first-action documents.read gate', () => {
    beforeEach(() => {
        body = { documentId: 'doc-1' };
        resolvePackageMock.mockReset().mockResolvedValue({
            pluginId: 'sample.plugin',
            path: '/tmp/extensions/.store/sample.plugin/pkg',
            source: 'package',
            digest: `sha256-${'a'.repeat(64)}`,
        });
        candidateMock.mockReset().mockResolvedValue({
            requestedGrants: ['documents.read', 'documents.write'],
            releaseId: null,
            packageDigest: `sha256-${'a'.repeat(64)}`,
            authoritySha256: `sha256-${'c'.repeat(64)}`,
            authority: null,
        });
        reviewMock.mockReset().mockResolvedValue(approvedReview());
    });

    it('mints a selection handle when documents.read is approved', async () => {
        const result = await callRoute();
        expect(result.status).toBe('ready');
        expect(result.handle).toMatchObject({ contextId: 'doc-1' });
    });

    it('refuses a handle for a package that requests documents.read without approval', async () => {
        reviewMock.mockResolvedValue({
            requestedGrants: ['documents.read', 'documents.write'],
            approvedGrants: [],
            revision: `sha256-${'d'.repeat(64)}`,
            status: 'unreviewed' as const,
            authoritySha256: null,
            packageDigest: null,
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 403,
            data: { code: 'documents-grant-required' },
        });
    });

    it('does not gate a package that does not request documents.read', async () => {
        candidateMock.mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
            releaseId: null,
            packageDigest: `sha256-${'a'.repeat(64)}`,
            authoritySha256: `sha256-${'c'.repeat(64)}`,
            authority: null,
        });
        reviewMock.mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
            approvedGrants: [],
            revision: `sha256-${'d'.repeat(64)}`,
            status: 'unreviewed' as const,
            authoritySha256: null,
            packageDigest: null,
        });
        const result = await callRoute();
        expect(result.status).toBe('ready');
        expect(reviewMock).not.toHaveBeenCalled();
    });
});
