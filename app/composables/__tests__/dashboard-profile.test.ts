import { beforeEach, describe, expect, it } from 'vitest';
import {
    getDashboardPluginPage,
    listDashboardPluginPages,
    listRegisteredDashboardPluginIds,
    registerDashboardPlugin,
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

});
