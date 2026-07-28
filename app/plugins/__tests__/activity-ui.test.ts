import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerDashboardPlugin: vi.fn(),
    registerPaneApp: vi.fn(),
    dashboardDispose: vi.fn(),
    paneDispose: vi.fn(),
}));

vi.mock('#app', () => ({
    defineNuxtPlugin: (plugin: () => void) => plugin,
}));

vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
    registerDashboardPlugin: mocks.registerDashboardPlugin,
}));

vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: () => ({
        registerPaneApp: mocks.registerPaneApp,
    }),
}));

describe('activity UI plugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.registerDashboardPlugin.mockReturnValue({
            dispose: mocks.dashboardDispose,
        });
        mocks.registerPaneApp.mockReturnValue({
            dispose: mocks.paneDispose,
        });
    });

    it('registers Activity in the Dashboard and retains direct detail panes', async () => {
        const plugin = (await import('../activity-ui.client')).default as () => void;

        plugin();

        expect(mocks.registerDashboardPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'or3:activity',
                label: 'Activity',
                pages: [
                    expect.objectContaining({
                        id: 'overview',
                        title: 'Activity Center',
                        component: expect.any(Function),
                    }),
                ],
            })
        );
        expect(mocks.registerPaneApp).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'or3-activity-detail',
                component: expect.any(Function),
            })
        );
    });
});
