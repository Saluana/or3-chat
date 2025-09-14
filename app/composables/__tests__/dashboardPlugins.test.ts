import { describe, it, expect, beforeEach } from 'vitest';
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
} from '../ui-extensions/dashboard/useDashboardPlugins';
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
});
