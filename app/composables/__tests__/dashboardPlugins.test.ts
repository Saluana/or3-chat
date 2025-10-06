import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    registerDashboardPluginPage,
    unregisterDashboardPluginPage,
    useDashboardPlugins,
    useDashboardPluginPages,
    listRegisteredDashboardPluginIds,
    listDashboardPluginPages,
    resolveDashboardPluginPageComponent,
    useDashboardNavigation,
} from '../dashboard/useDashboardPlugins';
import { nextTick, h, ref } from 'vue';

// Helper to flush Vue computed updates
async function flush() {
    await nextTick();
}

describe('dashboard plugin registry', () => {
    beforeEach(() => {
        // Clear global registries manually (simulate fresh state)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g: any = globalThis as any;
        g.__or3DashboardPluginsRegistry?.clear?.();
        g.__or3DashboardPluginPagesRegistry?.clear?.();
        // Force an empty re-register path by re-registering nothing.
        useDashboardNavigation({ baseItems: [] }).reset();
    });

    it('registers a simple plugin and lists it', async () => {
        registerDashboardPlugin({
            id: 'test:one',
            icon: 'pixelarticons:star',
            label: 'One',
        });
        await flush();
        expect(listRegisteredDashboardPluginIds()).toContain('test:one');
        const plugins = useDashboardPlugins().value.map((p) => p.id);
        expect(plugins).toContain('test:one');
    });

    it('re-registering same id replaces plugin (label update)', async () => {
        registerDashboardPlugin({ id: 'test:dup', icon: 'x', label: 'Old' });
        registerDashboardPlugin({ id: 'test:dup', icon: 'y', label: 'New' });
        await flush();
        const plug = useDashboardPlugins().value.find(
            (p) => p.id === 'test:dup'
        );
        expect(plug?.label).toBe('New');
    });

    it('unregister removes plugin and its pages', async () => {
        registerDashboardPlugin({
            id: 'test:remove',
            icon: 'i',
            label: 'Remove',
            pages: [{ id: 'p', title: 'P', component: { render: () => null } }],
        });
        await flush();
        expect(listRegisteredDashboardPluginIds()).toContain('test:remove');
        unregisterDashboardPlugin('test:remove');
        await flush();
        expect(listRegisteredDashboardPluginIds()).not.toContain('test:remove');
        expect(listDashboardPluginPages('test:remove').length).toBe(0);
    });

    it('registers inline pages and exposes them via listDashboardPluginPages', async () => {
        registerDashboardPlugin({
            id: 'test:inline',
            icon: 'i',
            label: 'Inline',
            pages: [
                { id: 'a', title: 'A', component: { render: () => null } },
                {
                    id: 'b',
                    title: 'B',
                    order: 50,
                    component: { render: () => null },
                },
            ],
        });
        await flush();
        const pages = listDashboardPluginPages('test:inline');
        expect(pages.map((p) => p.id).sort()).toEqual(['a', 'b']);
    });

    it('incremental page registration works', async () => {
        registerDashboardPlugin({ id: 'test:incr', icon: 'i', label: 'Incr' });
        registerDashboardPluginPage('test:incr', {
            id: 'p1',
            title: 'P1',
            component: { render: () => null },
        });
        registerDashboardPluginPage('test:incr', {
            id: 'p2',
            title: 'P2',
            component: { render: () => null },
        });
        await flush();
        const pages = listDashboardPluginPages('test:incr');
        expect(pages.length).toBe(2);
    });

    it('page re-registration replaces previous definition', async () => {
        registerDashboardPlugin({ id: 'test:modify', icon: 'i', label: 'Mod' });
        registerDashboardPluginPage('test:modify', {
            id: 'p',
            title: 'Old',
            component: { render: () => null },
        });
        registerDashboardPluginPage('test:modify', {
            id: 'p',
            title: 'New',
            component: { render: () => null },
        });
        await flush();
        const page = listDashboardPluginPages('test:modify').find(
            (p) => p.id === 'p'
        );
        expect(page?.title).toBe('New');
    });

    it('unregister single page', async () => {
        registerDashboardPlugin({
            id: 'test:single-remove',
            icon: 'i',
            label: 'SR',
        });
        registerDashboardPluginPage('test:single-remove', {
            id: 'p1',
            title: 'P1',
            component: { render: () => null },
        });
        registerDashboardPluginPage('test:single-remove', {
            id: 'p2',
            title: 'P2',
            component: { render: () => null },
        });
        await flush();
        unregisterDashboardPluginPage('test:single-remove', 'p1');
        await flush();
        const pages = listDashboardPluginPages('test:single-remove');
        expect(pages.map((p) => p.id)).toEqual(['p2']);
    });

    it('unregister all pages for plugin only', async () => {
        registerDashboardPlugin({
            id: 'test:clear-pages',
            icon: 'i',
            label: 'CP',
        });
        registerDashboardPluginPage('test:clear-pages', {
            id: 'x',
            title: 'X',
            component: { render: () => null },
        });
        registerDashboardPluginPage('test:clear-pages', {
            id: 'y',
            title: 'Y',
            component: { render: () => null },
        });
        await flush();
        unregisterDashboardPluginPage('test:clear-pages');
        await flush();
        expect(listDashboardPluginPages('test:clear-pages').length).toBe(0);
    });

    it('useDashboardPluginPages reacts to active plugin id function', async () => {
        registerDashboardPlugin({ id: 'test:reactive', icon: 'i', label: 'R' });
        registerDashboardPluginPage('test:reactive', {
            id: 'r1',
            title: 'R1',
            component: { render: () => null },
        });
        // Use a ref so the computed captures reactivity; plain object prop would not trigger updates.
        const source = ref<string | undefined>('test:reactive');
        const pagesComputed = useDashboardPluginPages(() => source.value);
        await flush();
        expect(pagesComputed.value.length).toBe(1);
        registerDashboardPluginPage('test:reactive', {
            id: 'r2',
            title: 'R2',
            component: { render: () => null },
        });
        await flush();
        expect(pagesComputed.value.map((p) => p.id).sort()).toEqual([
            'r1',
            'r2',
        ]);
        source.value = undefined;
        await flush();
        // When plugin id function returns undefined we expect an empty list
        expect(pagesComputed.value).toEqual([]);
    });

    it('resolveDashboardPluginPageComponent resolves sync component', async () => {
        registerDashboardPlugin({
            id: 'test:resolve-sync',
            icon: 'i',
            label: 'RS',
        });
        const Comp = { name: 'SyncComp', render: () => null };
        registerDashboardPluginPage('test:resolve-sync', {
            id: 'p',
            title: 'P',
            component: Comp,
        });
        const resolved = await resolveDashboardPluginPageComponent(
            'test:resolve-sync',
            'p'
        );
        expect(resolved).toBe(Comp);
    });

    it('resolveDashboardPluginPageComponent resolves async component factory', async () => {
        registerDashboardPlugin({
            id: 'test:resolve-async',
            icon: 'i',
            label: 'RA',
        });
        registerDashboardPluginPage('test:resolve-async', {
            id: 'p',
            title: 'P',
            component: () =>
                Promise.resolve({
                    default: { name: 'AsyncComp', render: () => null },
                }),
        });
        const resolved = await resolveDashboardPluginPageComponent(
            'test:resolve-async',
            'p'
        );
        expect((resolved as any)?.name).toBe('AsyncComp');
    });

    it('resolveDashboardPluginPageComponent caches result', async () => {
        let loadCount = 0;
        registerDashboardPlugin({
            id: 'test:cache',
            icon: 'i',
            label: 'Cache',
        });
        registerDashboardPluginPage('test:cache', {
            id: 'p',
            title: 'P',
            component: () =>
                Promise.resolve({
                    default: {
                        name: 'Cached',
                        render: () => {
                            loadCount++;
                            return h('div');
                        },
                    },
                }),
        });
        const r1 = await resolveDashboardPluginPageComponent('test:cache', 'p');
        const r2 = await resolveDashboardPluginPageComponent('test:cache', 'p');
        expect(r1).toBe(r2);
    });

    it('handles missing plugin/page gracefully', async () => {
        const resolved = await resolveDashboardPluginPageComponent(
            'no:plugin',
            'nope'
        );
        expect(resolved).toBeUndefined();
    });

    it('re-registering same page id invalidates cached component', async () => {
        registerDashboardPlugin({
            id: 'test:cache-invalidate',
            icon: 'i',
            label: 'CI',
        });
        registerDashboardPluginPage('test:cache-invalidate', {
            id: 'p',
            title: 'P',
            component: { name: 'CompV1', render: () => null },
        });
        const first = await resolveDashboardPluginPageComponent(
            'test:cache-invalidate',
            'p'
        );
        registerDashboardPluginPage('test:cache-invalidate', {
            id: 'p',
            title: 'P',
            component: { name: 'CompV2', render: () => null },
        });
        const second = await resolveDashboardPluginPageComponent(
            'test:cache-invalidate',
            'p'
        );
        expect((first as any)?.name).toBe('CompV1');
        expect((second as any)?.name).toBe('CompV2');
    });

    it('unregister single page clears its cached component', async () => {
        registerDashboardPlugin({
            id: 'test:cache-remove',
            icon: 'i',
            label: 'CR',
        });
        registerDashboardPluginPage('test:cache-remove', {
            id: 'p',
            title: 'P',
            component: { name: 'CompA', render: () => null },
        });
        const a = await resolveDashboardPluginPageComponent(
            'test:cache-remove',
            'p'
        );
        unregisterDashboardPluginPage('test:cache-remove', 'p');
        registerDashboardPluginPage('test:cache-remove', {
            id: 'p',
            title: 'P',
            component: { name: 'CompB', render: () => null },
        });
        const b = await resolveDashboardPluginPageComponent(
            'test:cache-remove',
            'p'
        );
        expect((a as any)?.name).toBe('CompA');
        expect((b as any)?.name).toBe('CompB');
    });

    it('unregister plugin clears all its page caches', async () => {
        registerDashboardPlugin({
            id: 'test:plugin-remove-cache',
            icon: 'i',
            label: 'PRC',
        });
        registerDashboardPluginPage('test:plugin-remove-cache', {
            id: 'p1',
            title: 'P1',
            component: { name: 'Old1', render: () => null },
        });
        registerDashboardPluginPage('test:plugin-remove-cache', {
            id: 'p2',
            title: 'P2',
            component: { name: 'Old2', render: () => null },
        });
        const r1 = await resolveDashboardPluginPageComponent(
            'test:plugin-remove-cache',
            'p1'
        );
        const r2 = await resolveDashboardPluginPageComponent(
            'test:plugin-remove-cache',
            'p2'
        );
        unregisterDashboardPlugin('test:plugin-remove-cache');
        registerDashboardPlugin({
            id: 'test:plugin-remove-cache',
            icon: 'i',
            label: 'PRC2',
        });
        registerDashboardPluginPage('test:plugin-remove-cache', {
            id: 'p1',
            title: 'P1',
            component: { name: 'New1', render: () => null },
        });
        registerDashboardPluginPage('test:plugin-remove-cache', {
            id: 'p2',
            title: 'P2',
            component: { name: 'New2', render: () => null },
        });
        const n1 = await resolveDashboardPluginPageComponent(
            'test:plugin-remove-cache',
            'p1'
        );
        const n2 = await resolveDashboardPluginPageComponent(
            'test:plugin-remove-cache',
            'p2'
        );
        expect((r1 as any)?.name).toBe('Old1');
        expect((r2 as any)?.name).toBe('Old2');
        expect((n1 as any)?.name).toBe('New1');
        expect((n2 as any)?.name).toBe('New2');
    });

    it('useDashboardPlugins returns a defensive sorted copy', async () => {
        registerDashboardPlugin({
            id: 'test:sort-a',
            icon: 'i',
            label: 'A',
            order: 300,
        });
        registerDashboardPlugin({
            id: 'test:sort-b',
            icon: 'i',
            label: 'B',
            order: 100,
        });
        const comp = useDashboardPlugins();
        const first = comp.value;
        expect(first.map((p) => p.id)).toEqual(['test:sort-b', 'test:sort-a']);
        (first as any).push({ id: 'fake', icon: 'x', label: 'Fake' });
        let threw = false;
        try {
            (first[0] as any).label = 'CHANGED';
        } catch {
            threw = true;
        }
        expect(threw).toBe(true); // frozen object prevented mutation
        // Force recompute by registering another plugin
        registerDashboardPlugin({
            id: 'test:sort-c',
            icon: 'i',
            label: 'C',
            order: 200,
        });
        await flush();
        const second = comp.value; // newly computed array
        expect(second.find((p) => p.id === 'fake')).toBeUndefined();
        const orig = second.find((p) => p.id === 'test:sort-b');
        expect(orig?.label).toBe('B');
    });

    it('dev overwriting plugin emits a warning', async () => {
        const prevDev = (process as any).dev;
        (process as any).dev = true;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerDashboardPlugin({ id: 'test:warn', icon: 'i', label: 'W1' });
        registerDashboardPlugin({ id: 'test:warn', icon: 'i', label: 'W2' });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
        (process as any).dev = prevDev;
    });

    it('warns when async loader returns non-component object', async () => {
        const prevDev = (process as any).dev;
        (process as any).dev = true;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerDashboardPlugin({
            id: 'test:bad-loader',
            icon: 'i',
            label: 'BL',
        });
        registerDashboardPluginPage('test:bad-loader', {
            id: 'p',
            title: 'P',
            component: () => Promise.resolve(42 as any),
        });
        const resolved = await resolveDashboardPluginPageComponent(
            'test:bad-loader',
            'p'
        );
        expect(resolved).toBe(42 as any);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
        (process as any).dev = prevDev;
    });

    describe('useDashboardNavigation', () => {
        it('dispatches handler when plugin has no pages', async () => {
            const handler = vi.fn();
            registerDashboardPlugin({
                id: 'test:nav-handler',
                icon: 'pixelarticons:star',
                label: 'Nav Handler',
                handler,
            });
            await flush();
            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:nav-handler');
            expect(result.ok).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePageId).toBeNull();
            expect(nav.state.error).toBeNull();
        });

        it('opens single-page plugin directly', async () => {
            const Comp = { name: 'NavSingle', render: () => null };
            registerDashboardPlugin({
                id: 'test:nav-single',
                icon: 'pixelarticons:circle',
                label: 'Nav Single',
                pages: [
                    {
                        id: 'main',
                        title: 'Main',
                        component: Comp,
                    },
                ],
            });
            await flush();
            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:nav-single');
            expect(result.ok).toBe(true);
            expect(nav.state.view).toBe('page');
            expect(nav.state.activePluginId).toBe('test:nav-single');
            expect(nav.state.activePageId).toBe('main');
            expect(nav.resolvedPageComponent.value).toBeTruthy();
            expect((nav.resolvedPageComponent.value as any).name).toBe(
                'NavSingle'
            );
            expect(nav.state.loadingPage).toBe(false);
            expect(nav.state.error).toBeNull();
        });

        it('enters landing mode for multi-page plugins and supports back navigation', async () => {
            const PageA = { name: 'PageA', render: () => null };
            const PageB = { name: 'PageB', render: () => null };
            registerDashboardPlugin({
                id: 'test:nav-multi',
                icon: 'pixelarticons:square',
                label: 'Nav Multi',
                pages: [
                    {
                        id: 'one',
                        title: 'One',
                        component: PageA,
                    },
                    {
                        id: 'two',
                        title: 'Two',
                        component: PageB,
                    },
                ],
            });
            await flush();
            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('test:nav-multi');
            expect(result.ok).toBe(true);
            expect(nav.state.view).toBe('page');
            expect(nav.state.activePluginId).toBe('test:nav-multi');
            expect(nav.state.activePageId).toBeNull();
            expect(nav.landingPages.value.map((p) => p.id)).toEqual([
                'one',
                'two',
            ]);
            const pageResult = await nav.openPage('test:nav-multi', 'one');
            expect(pageResult.ok).toBe(true);
            expect(nav.state.activePageId).toBe('one');
            expect((nav.resolvedPageComponent.value as any).name).toBe('PageA');
            nav.goBack();
            expect(nav.state.activePageId).toBeNull();
            expect(nav.state.view).toBe('page');
            nav.goBack();
            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePluginId).toBeNull();
        });

        it('surfaces structured error for missing plugin', async () => {
            const nav = useDashboardNavigation();
            const result = await nav.openPlugin('missing:nav');
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('missing-plugin');
                expect(result.error.pluginId).toBe('missing:nav');
            }
            expect(nav.state.error?.code).toBe('missing-plugin');
            expect(nav.state.view).toBe('dashboard');
            expect(nav.state.activePluginId).toBeNull();
        });

        it('surfaces structured error for missing page', async () => {
            registerDashboardPlugin({
                id: 'test:nav-missing-page',
                icon: 'pixelarticons:triangle',
                label: 'Nav Missing Page',
            });
            await flush();
            const nav = useDashboardNavigation();
            const result = await nav.openPage(
                'test:nav-missing-page',
                'does-not-exist'
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('missing-page');
                expect(result.error.pageId).toBe('does-not-exist');
            }
            expect(nav.state.error?.code).toBe('missing-page');
            expect(nav.state.activePageId).toBeNull();
            expect(nav.state.view).toBe('page');
        });
    });
});
