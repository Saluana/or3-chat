import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The promotion boundary is safety-relevant: a candidate the install pipeline
 * staged must not be activatable around that pipeline, and the instance-wide
 * workspace preflight applies to every promotion, whatever created the candidate.
 */
const promoteMock = vi.fn();
const preflightMock = vi.fn();
const listForPluginMock = vi.fn();
const readManifestMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: {
        statusCode: number;
        statusMessage?: string;
        data?: unknown;
    }) => Object.assign(new Error(options.statusMessage ?? 'error'), options),
    readBody: async () => ({ candidateDigest: `sha256-${'a'.repeat(64)}` }),
    getRouterParam: () => 'or3.sample-utility',
}));

vi.mock('../../../../admin/api', () => ({
    requireAdminApiContext: async () => ({
        principal: { kind: 'super_admin', username: 'admin' },
        session: { workspace: { id: 'ws-1' }, user: { id: 'admin' } },
    }),
}));

vi.mock('../../../../admin/workspace-target', () => ({
    resolveAdminWorkspaceTarget: () => 'ws-1',
}));

vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        promotion: { promote: promoteMock },
        migration: { getStateVersion: async () => 1 },
        packages: { packagePath: () => '/tmp/does-not-need-to-exist' },
    }),
    readPackageGrantReview: async () => ({
        requestedGrants: [],
        approvedGrants: [],
        revision: 'g1',
        status: 'current',
    }),
    readPackageManifest: (...args: unknown[]) => readManifestMock(...args),
    readPluginStateSnapshot: async () => ({ settings: {}, stateVersion: 1 }),
    restorePluginStateSnapshot: async () => undefined,
}));

vi.mock('../../../../utils/plugins/acquisition/route-support', () => ({
    acquisitionServiceFor: async () => ({
        listForPlugin: (...args: unknown[]) => listForPluginMock(...args),
        preflightWorkspaces: (...args: unknown[]) => preflightMock(...args),
    }),
}));

vi.mock('../../../../utils/plugins/acquisition/route-identity', () => ({
    requesterIdentity: () => 'admin',
}));

describe('promote route guard', () => {
    beforeEach(() => {
        promoteMock.mockReset().mockResolvedValue({
            status: 'promoted',
            packageDigest: `sha256-${'a'.repeat(64)}`,
        });
        preflightMock.mockReset().mockResolvedValue({ checked: 1, blocking: [] });
        listForPluginMock.mockReset().mockResolvedValue([]);
        readManifestMock.mockReset().mockResolvedValue({ requestedGrants: ['settings.read'] });
    });

    async function callRoute(): Promise<unknown> {
        const handler = (
            await import('../packages/[pluginId]/promote.post')
        ).default;
        return await handler({
            context: { adminHooks: { doAction: async () => undefined } },
        } as never);
    }

    it('refuses a candidate an unfinished install operation owns', async () => {
        listForPluginMock.mockResolvedValue([
            {
                operationId: 'acq_1',
                candidateDigest: `sha256-${'a'.repeat(64)}`,
                status: 'blocked',
            },
        ]);
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'acquisition-required', operationId: 'acq_1' },
        });
        expect(promoteMock).not.toHaveBeenCalled();
    });

    it('refuses when an enabled workspace cannot read the version', async () => {
        preflightMock.mockResolvedValue({
            checked: 2,
            blocking: [{ workspaceId: 'ws-2', code: 'grant-review-stale' }],
        });
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'workspace-preflight-blocked' },
        });
        expect(promoteMock).not.toHaveBeenCalled();
    });

    it('promotes once the candidate is not owned and every workspace passes', async () => {
        const result = (await callRoute()) as { ok: boolean };
        expect(result.ok).toBe(true);
        expect(promoteMock).toHaveBeenCalledOnce();
        // Completed operations never block a later direct promotion.
        listForPluginMock.mockResolvedValue([
            {
                operationId: 'acq_done',
                candidateDigest: `sha256-${'a'.repeat(64)}`,
                status: 'completed',
            },
        ]);
        const again = (await callRoute()) as { ok: boolean };
        expect(again.ok).toBe(true);
    });
});
