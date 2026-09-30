import { describe, expect, it, vi } from 'vitest';

const currentDigest = `sha256-${'a'.repeat(64)}`;
const previousDigest = `sha256-${'b'.repeat(64)}`;
const mocks = vi.hoisted(() => ({ rollback: vi.fn(), revoke: vi.fn() }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: () => 'acme.test',
    readBody: async () => ({ expectedCurrentDigest: currentDigest, expectedPreviousDigest: previousDigest, expectedPointerRevision: 3, expectedEnabledWorkspaceSha256: `sha256-${'c'.repeat(64)}` }),
    createError: (input: { statusCode: number; statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
}));
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: async () => ({}) }));
vi.mock('../../../../../admin/workspace-target', () => ({ assertExpectedAdminWorkspace: vi.fn(), resolveAdminWorkspaceTarget: () => 'ws-admin' }));
vi.mock('../../../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({}) }));
vi.mock('../../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        pointers: { readPointer: async () => ({ current: { packageDigest: currentDigest }, previous: { packageDigest: previousDigest }, revision: 3 }) },
        promotion: { rollback: mocks.rollback },
        migration: { getStateVersion: async () => 1 },
    }),
    readPluginStateSnapshot: async () => ({}), restorePluginStateSnapshot: async () => undefined,
}));
vi.mock('../../../../../admin/plugins/rollback-workspaces', () => ({ prepareRollbackWorkspacePreflight: async () => async () => ({ checked: 1, blocking: [] }) }));
vi.mock('../../../../../utils/plugins/isolation/activation-registry', () => ({ revokeHostActivationsForPlugin: mocks.revoke }));

const { default: route } = await import('../[pluginId]/rollback.post');

describe('rollback commit response', () => {
    it('reports a committed rollback even if an optional admin hook fails afterward', async () => {
        mocks.rollback.mockResolvedValue({ status: 'rolled-back', pointer: { current: { packageDigest: previousDigest } } });
        const event = { context: { adminHooks: { doAction: async () => { throw new Error('hook failed'); } } } };
        await expect(route(event as never)).resolves.toMatchObject({ ok: true, status: 'rolled-back' });
        expect(mocks.revoke).toHaveBeenCalledWith('acme.test', 'selected-package-changed');
    });
});
