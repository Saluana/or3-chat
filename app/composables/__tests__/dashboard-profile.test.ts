import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getDashboardPluginPage,
    listDashboardPluginPages,
    listRegisteredDashboardPluginIds,
    registerDashboardPlugin,
    resolveDashboardPluginPageComponent,
    unregisterDashboardPlugin,
    useDashboardNavigation,
    useDashboardPlugins,
} from '../dashboard/useDashboardPlugins';

describe('V1 dashboard registry profile', () => {
    beforeEach(() => {
        for (const id of listRegisteredDashboardPluginIds()) unregisterDashboardPlugin(id);
        useDashboardNavigation({ baseItems: [] }).reset();
    });

    it('shallow-freezes plugin copies and replaces inline pages as one family', () => {
        const pages = [{ id: 'old-a', title: 'Old A', component: { name: 'OldA' } }];
        registerDashboardPlugin({ id: 'profile:inline', icon: 'i', label: 'Old', pages });
        pages.push({ id: 'caller-only', title: 'Caller only', component: { name: 'Caller' } });

        const stored = useDashboardPlugins().value[0]!;
        expect(Object.isFrozen(stored)).toBe(true);
        expect(stored.pages).not.toBe(pages);
        expect(stored.pages?.map((page) => page.id)).toEqual(['old-a']);
        expect(Object.isFrozen(stored.pages)).toBe(false);
        expect(Object.isFrozen(getDashboardPluginPage('profile:inline', 'old-a'))).toBe(true);

        registerDashboardPlugin({
            id: 'profile:inline',
            icon: 'i',
            label: 'New',
            pages: [{ id: 'new-a', title: 'New A', component: { name: 'NewA' } }],
        });
        expect(listDashboardPluginPages('profile:inline').map((page) => page.id)).toEqual(['new-a']);
        expect(getDashboardPluginPage('profile:inline', 'old-a')).toBeUndefined();
    });

    it('uses stable map insertion for equal-order plugins and pages', () => {
        registerDashboardPlugin({
            id: 'z-plugin',
            icon: 'i',
            label: 'Z',
            pages: [
                { id: 'z-page', title: 'Z', component: {} },
                { id: 'a-page', title: 'A', component: {} },
            ],
        });
        registerDashboardPlugin({ id: 'a-plugin', icon: 'i', label: 'A' });

        expect(useDashboardPlugins().value.map((plugin) => plugin.id)).toEqual(['z-plugin', 'a-plugin']);
        expect(listDashboardPluginPages('z-plugin').map((page) => page.id)).toEqual(['z-page', 'a-page']);
    });

    it('merges access with page fields overriding plugin fields', () => {
        registerDashboardPlugin({
            id: 'profile:plugin-denied',
            icon: 'i',
            label: 'Denied plugin',
            access: { authRequired: true },
            pages: [{ id: 'cannot-weaken', title: 'Cannot weaken', component: {}, access: { authRequired: false } }],
        });
        registerDashboardPlugin({
            id: 'profile:page-denied',
            icon: 'i',
            label: 'Denied page',
            pages: [{ id: 'strict-page', title: 'Strict page', component: {}, access: { authRequired: true } }],
        });

        expect(useDashboardPlugins().value.map((plugin) => plugin.id)).not.toContain('profile:plugin-denied');
        // This is the V1 merge profile: the page-level false overrides the plugin-level true.
        expect(getDashboardPluginPage('profile:plugin-denied', 'cannot-weaken')).toBeDefined();
        expect(listDashboardPluginPages('profile:page-denied')).toEqual([]);
    });

    it('does not cache failed loads, so navigation retry can resolve and clear its error', async () => {
        const component = { name: 'Recovered' };
        const loader = vi.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue({ default: component });
        registerDashboardPlugin({
            id: 'profile:retry',
            icon: 'i',
            label: 'Retry',
            pages: [{ id: 'page', title: 'Page', component: loader }],
        });
        const nav = useDashboardNavigation();

        const failed = await nav.openPage('profile:retry', 'page');
        expect(failed).toMatchObject({ ok: false, error: { code: 'resolve-error' } });
        expect(nav.state.error?.code).toBe('resolve-error');
        const recovered = await nav.openPage('profile:retry', 'page');
        expect(recovered).toEqual({ ok: true });
        expect(nav.state.error).toBeNull();
        expect(nav.resolvedPageComponent.value).toBe(component);
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('invalidates inline replacement caches and preserves active navigation state on removal', async () => {
        registerDashboardPlugin({
            id: 'profile:active',
            icon: 'i',
            label: 'Active',
            pages: [
                { id: 'page', title: 'Old', component: { name: 'Old' } },
                { id: 'other', title: 'Other', component: { name: 'Other' } },
            ],
        });
        const old = await resolveDashboardPluginPageComponent('profile:active', 'page');
        const nav = useDashboardNavigation();
        await nav.openPlugin('profile:active');
        expect(nav.state.activePluginId).toBe('profile:active');

        registerDashboardPlugin({
            id: 'profile:active',
            icon: 'i',
            label: 'Replacement',
            pages: [{ id: 'page', title: 'New', component: { name: 'New' } }],
        });
        const replacement = await resolveDashboardPluginPageComponent('profile:active', 'page');
        expect((old as { name?: string }).name).toBe('Old');
        expect((replacement as { name?: string }).name).toBe('New');

        unregisterDashboardPlugin('profile:active');
        expect(nav.state.activePluginId).toBe('profile:active');
        expect(nav.state.view).toBe('page');
    });
});
