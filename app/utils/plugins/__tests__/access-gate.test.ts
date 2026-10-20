import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    ssrAuthEnabled: false,
    fetch: vi.fn(),
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
        public: { ssrAuthEnabled: testState.ssrAuthEnabled },
    }),
}));

vi.mock('ofetch', () => ({
    $fetch: testState.fetch,
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => testState.session,
}));

describe('client plugin access gate', () => {
    beforeEach(() => {
        vi.stubGlobal('process', { ...process, client: true });
        vi.resetModules();
        delete (globalThis as Record<string, unknown>).__or3PluginGateState;
        delete (globalThis as Record<string, unknown>).__or3PluginGateListeners;
        testState.ssrAuthEnabled = false;
        testState.fetch.mockReset();
        testState.session.authenticated = true;
        testState.session.workspace.id = 'workspace-1';
        testState.session.entitlements = [];
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('batches distinct startup gates and caches their independent decisions', async () => {
        testState.ssrAuthEnabled = true;
        const { getPluginGateDecision } = await import('../access-gate');
        testState.fetch.mockResolvedValue({ decisions: {
            'plugin.one': { allowed: true, reasons: [], effectivePolicy: {} },
            'plugin.two': { allowed: false, reasons: ['plugin-disabled'], effectivePolicy: {} },
        } });

        getPluginGateDecision('plugin.one');
        getPluginGateDecision('plugin.two');
        getPluginGateDecision('plugin.one');
        await vi.waitFor(() => expect(testState.fetch).toHaveBeenCalled());
        expect(testState.fetch).toHaveBeenCalledTimes(1);
        expect(getPluginGateDecision('plugin.two').allowed).toBe(false);
        expect(getPluginGateDecision('plugin.one').allowed).toBe(true);
        expect(testState.fetch).toHaveBeenCalledWith('/api/plugins/access', expect.objectContaining({
            query: { pluginIds: ['plugin.one', 'plugin.two'] }, retry: 0,
        }));
    });

    it('ignores a previous workspace batch while its replacement is pending', async () => {
        testState.ssrAuthEnabled = true;
        let finishOld!: (value: unknown) => void;
        let finishNew!: (value: unknown) => void;
        testState.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
            .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
        const { getPluginGateDecision, isPluginGateDecisionPending } = await import('../access-gate');
        getPluginGateDecision('plugin.one');
        await Promise.resolve();
        testState.session.workspace.id = 'workspace-2';
        getPluginGateDecision('plugin.one');
        await Promise.resolve();
        finishOld({ decisions: { 'plugin.one': { allowed: false, reasons: ['plugin-disabled'], effectivePolicy: {} } } });
        await Promise.resolve();
        expect(getPluginGateDecision('plugin.one').allowed).toBe(true);
        expect(isPluginGateDecisionPending('plugin.one')).toBe(true);
        finishNew({ decisions: { 'plugin.one': { allowed: true, reasons: [], effectivePolicy: {} } } });
        await vi.waitFor(() => expect(isPluginGateDecisionPending('plugin.one')).toBe(false));
        expect(getPluginGateDecision('plugin.one').allowed).toBe(true);
        expect(testState.fetch).toHaveBeenCalledTimes(2);
    });

    it('bounds failed gate retries across reactive reevaluation', async () => {
        vi.useFakeTimers();
        testState.ssrAuthEnabled = true;
        testState.fetch.mockRejectedValue(new Error('Unavailable'));
        const { getPluginGateDecision } = await import('../access-gate');
        for (let i = 0; i < 20; i++) {
            getPluginGateDecision('plugin.offline');
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(testState.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        getPluginGateDecision('plugin.offline');
        await vi.advanceTimersByTimeAsync(0);
        expect(testState.fetch).toHaveBeenCalledTimes(2);
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

    it('does not request a server decision for a signed-out session', async () => {
        const { getPluginGateDecision } = await import('../access-gate');
        testState.ssrAuthEnabled = true;
        testState.session.authenticated = false;

        expect(
            getPluginGateDecision('plugin.reports', { authRequired: true })
                .allowed
        ).toBe(false);
        await Promise.resolve();
        expect(testState.fetch).not.toHaveBeenCalled();
    });
});
