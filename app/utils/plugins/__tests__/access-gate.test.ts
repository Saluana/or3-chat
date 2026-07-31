import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    session: {
        authenticated: true,
        user: { id: 'user-1' },
        workspace: { id: 'workspace-1', name: 'Workspace' },
        role: 'owner' as const,
        entitlements: [] as string[],
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        public: { ssrAuthEnabled: false },
    }),
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => testState.session,
}));

describe('client plugin access gate', () => {
    beforeEach(() => {
        testState.session.entitlements = [];
    });

    it('uses entitlements from the cached session context', async () => {
        const { getPluginGateDecision } = await import('../access-gate');
        testState.session.entitlements = ['paid'];

        expect(
            getPluginGateDecision('plugin.reports', {
                requiredEntitlements: ['paid'],
            }).allowed
        ).toBe(true);
    });

    it('invalidates the local scope when entitlements change', async () => {
        const { getPluginGateDecision } = await import('../access-gate');
        const policy = { requiredEntitlements: ['paid'] };

        expect(getPluginGateDecision('plugin.reports', policy).allowed).toBe(
            false
        );
        testState.session.entitlements = ['paid'];
        expect(getPluginGateDecision('plugin.reports', policy).allowed).toBe(
            true
        );
    });
});
