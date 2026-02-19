import { beforeEach, describe, expect, it } from 'vitest';
import {
    listRegisteredDashboardPluginIds,
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    useDashboardPlugins,
} from '../useDashboardPlugins';

describe('useDashboardPlugins access gating', () => {
    beforeEach(() => {
        listRegisteredDashboardPluginIds().forEach((id) => unregisterDashboardPlugin(id));
    });

    it('keeps legacy plugins visible when access metadata is absent', () => {
        registerDashboardPlugin({
            id: 'legacy.plugin',
            icon: 'pixelarticons:app-window',
            label: 'Legacy Plugin',
        });

        const plugins = useDashboardPlugins().value;
        expect(plugins.map((entry) => entry.id)).toEqual(['legacy.plugin']);
    });

    it('hides denied plugins when policy requires authentication', () => {
        registerDashboardPlugin({
            id: 'auth.plugin',
            icon: 'pixelarticons:lock',
            label: 'Auth Plugin',
            access: { authRequired: true },
        });

        const plugins = useDashboardPlugins().value;
        expect(plugins.map((entry) => entry.id)).toEqual([]);
    });
});
