import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    useDashboardNavigation,
} from '../dashboard/useDashboardPlugins';
import { nextTick } from 'vue';

// Helper to flush Vue computed updates
async function flush() {
    await nextTick();
}

describe('dashboard memory leak and error handling fixes', () => {
    beforeEach(() => {
        // Clear global registries
        const g: any = globalThis as any;
        g.__or3DashboardPluginsRegistry?.clear?.();
        g.__or3DashboardPluginPagesRegistry?.clear?.();
        useDashboardNavigation({ baseItems: [] }).reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('handler error visibility', () => {
        it('surfaces handler errors in state and result', async () => {
            const errorMessage = 'Handler intentionally failed';
            const throwingHandler = vi.fn(() => {
                throw new Error(errorMessage);
            });

            registerDashboardPlugin({
                id: 'test:error-handler',
                icon: 'pixelarticons:warning',
                label: 'Error Handler',
                handler: throwingHandler,
            });

            await flush();

            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:error-handler');

            // Error must be visible in result
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('handler-error');
                expect(result.error.pluginId).toBe('test:error-handler');
                expect(result.error.message).toContain('handler failed');
                expect(result.error.cause).toBeInstanceOf(Error);
            }

            // Error must be visible in navigation state
            expect(nav.state.error).not.toBeNull();
            expect(nav.state.error?.code).toBe('handler-error');
            expect(nav.state.error?.pluginId).toBe('test:error-handler');

            // View should be dashboard (not stuck in broken state)
            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePluginId).toBeNull();
        });

        it('successful handler clears error and returns to dashboard', async () => {
            const successHandler = vi.fn().mockResolvedValue(undefined);

            registerDashboardPlugin({
                id: 'test:success-handler',
                icon: 'pixelarticons:check',
                label: 'Success Handler',
                handler: successHandler,
            });

            await flush();

            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:success-handler');

            expect(result.ok).toBe(true);
            expect(nav.state.error).toBeNull();
            expect(nav.state.view).toBe('dashboard');
            expect(successHandler).toHaveBeenCalledTimes(1);
            expect(successHandler).toHaveBeenCalledWith({
                id: 'test:success-handler',
            });
        });

        it('async handler rejection is caught and surfaced', async () => {
            const asyncErrorHandler = vi
                .fn()
                .mockRejectedValue(new Error('Async failure'));

            registerDashboardPlugin({
                id: 'test:async-error',
                icon: 'pixelarticons:zap',
                label: 'Async Error',
                handler: asyncErrorHandler,
            });

            await flush();

            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:async-error');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('handler-error');
                expect(result.error.cause).toBeInstanceOf(Error);
            }
            expect(nav.state.error).not.toBeNull();
        });
    });

    describe('missing plugin/page error states', () => {
        it('openPlugin with missing plugin returns structured error', async () => {
            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('nonexistent:plugin');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('missing-plugin');
                expect(result.error.pluginId).toBe('nonexistent:plugin');
            }
            expect(nav.state.error?.code).toBe('missing-plugin');
            expect(nav.state.view).toBe('dashboard');
        });

        it('openPage with missing page returns structured error', async () => {
            registerDashboardPlugin({
                id: 'test:no-pages',
                icon: 'pixelarticons:square',
                label: 'No Pages',
            });

            await flush();

            const nav = useDashboardNavigation();
            const result = await nav.openPage('test:no-pages', 'nonexistent');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('missing-page');
                expect(result.error.pageId).toBe('nonexistent');
                expect(result.error.pluginId).toBe('test:no-pages');
            }
            expect(nav.state.error?.code).toBe('missing-page');
        });
    });

    describe('navigation state cleanup', () => {
        it('reset clears all navigation state', async () => {
            registerDashboardPlugin({
                id: 'test:reset',
                icon: 'pixelarticons:circle',
                label: 'Reset Test',
                pages: [
                    {
                        id: 'page',
                        title: 'Page',
                        component: { render: () => null },
                    },
                ],
            });

            await flush();

            const nav = useDashboardNavigation();
            await nav.openPlugin('test:reset');

            expect(nav.state.view).toBe('page');
            expect(nav.state.activePluginId).toBe('test:reset');

            nav.reset();

            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePluginId).toBeNull();
            expect(nav.state.activePageId).toBeNull();
            expect(nav.state.error).toBeNull();
            expect(nav.state.loadingPage).toBe(false);
            expect(nav.resolvedPageComponent.value).toBeNull();
        });

        it('goBack from page view returns to dashboard', async () => {
            registerDashboardPlugin({
                id: 'test:back',
                icon: 'pixelarticons:circle',
                label: 'Back Test',
                pages: [
                    {
                        id: 'page',
                        title: 'Page',
                        component: { render: () => null },
                    },
                ],
            });

            await flush();

            const nav = useDashboardNavigation();
            await nav.openPlugin('test:back');
            expect(nav.state.view).toBe('page');

            nav.goBack();
            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePluginId).toBeNull();
        });
    });
});
