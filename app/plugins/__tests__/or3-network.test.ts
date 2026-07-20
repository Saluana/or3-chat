import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerDashboardPluginMock = vi.fn();
const registerPaneAppMock = vi.fn();
const runtimeConfigRef = {
    value: {
        public: {
            ssrAuthEnabled: true,
            or3Net: {
                enabled: true,
                hostUrl: 'https://net.test',
            },
        },
    },
};

vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
    registerDashboardPlugin: registerDashboardPluginMock,
}));

vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: () => ({
        registerPaneApp: registerPaneAppMock,
    }),
}));

describe('or3-network dashboard plugin', () => {
    beforeEach(() => {
        vi.resetModules();
        registerDashboardPluginMock.mockReset();
        registerPaneAppMock.mockReset();
        vi.stubGlobal('defineNuxtPlugin', (fn: () => unknown) => fn);
        vi.stubGlobal('useRuntimeConfig', () => runtimeConfigRef.value);
        runtimeConfigRef.value = {
            public: {
                ssrAuthEnabled: true,
                or3Net: {
                    enabled: true,
                    hostUrl: 'https://net.test',
                },
            },
        };
    });

    it('registers the dashboard plugin when OR3 Net is enabled', async () => {
        const module = await import('../or3-network.client');
        const plugin = module.default as () => void;
        plugin();

        expect(registerDashboardPluginMock).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'core:or3-network',
                label: 'OR3 Network',
            })
        );
        expect(registerPaneAppMock).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'or3-net-preview',
                label: 'OR3 Net Preview',
            })
        );
    });

    it('stays inactive when OR3 Net is disabled', async () => {
        runtimeConfigRef.value = {
            public: {
                ssrAuthEnabled: true,
                or3Net: {
                    enabled: false,
                    hostUrl: '',
                },
            },
        };

        const module = await import('../or3-network.client');
        const plugin = module.default as () => void;
        plugin();

        expect(registerDashboardPluginMock).not.toHaveBeenCalled();
    });
});
