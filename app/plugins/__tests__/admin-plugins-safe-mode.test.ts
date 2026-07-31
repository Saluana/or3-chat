import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    runtimeConfig: {
        public: {
            ssrAuthEnabled: true,
            admin: { disableNonCorePlugins: true },
        },
    },
    loadAdminPlugins: vi.fn(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => testState.runtimeConfig,
}));

vi.mock('~/composables/admin/useAdminPlugins', () => ({
    loadAdminPlugins: testState.loadAdminPlugins,
}));

describe('admin plugin boot safe mode', () => {
    beforeEach(() => {
        testState.loadAdminPlugins.mockReset().mockResolvedValue(undefined);
        testState.runtimeConfig.public.ssrAuthEnabled = true;
        testState.runtimeConfig.public.admin.disableNonCorePlugins = true;
        vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
    });

    it('does not call the admin plugin loader in safe mode', async () => {
        const boot = (await import('../admin-plugins.client')).default as () => Promise<void>;

        await boot();

        expect(testState.loadAdminPlugins).not.toHaveBeenCalled();
    });

    it('preserves the V1 loader path when safe mode is disabled', async () => {
        testState.runtimeConfig.public.admin.disableNonCorePlugins = false;
        const boot = (await import('../admin-plugins.client')).default as () => Promise<void>;

        await boot();

        expect(testState.loadAdminPlugins).toHaveBeenCalledOnce();
    });
});

