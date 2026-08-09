import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { watch, type Component } from 'vue';
import {
    getDashboardPluginPage,
    getPluginCapabilities,
    hasAllCapabilities,
    hasAnyCapability,
    hasCapability,
    listDashboardPluginPages,
    listRegisteredDashboardPluginIds,
    registerDashboardPlugin,
    registerDashboardPluginPage,
    unregisterDashboardPlugin,
    unregisterDashboardPluginPage,
    useDashboardPluginPages,
    useDashboardPlugins,
    type DashboardPlugin,
    type DashboardPluginPage,
} from '../dashboard/useDashboardPlugins';
import { createContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import {
    captureDifferentialSurface,
    compareDifferentialSurfaces,
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
    type DifferentialSurfaceAdapter,
    type DifferentialSurfaceFixture,
} from '../../../tests/plugin-runtime/differential-surface-harness';

const profiles = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'planning/complete/plugin-runtime-v2/compatibility-profiles.json'
        ),
        'utf8'
    )
) as CompatibilityProfileDocument;

interface PageRegistration {
    readonly pluginId: string;
    readonly page: DashboardPluginPage;
}

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['dashboard'] : []
    );
}

function clear() {
    for (const id of listRegisteredDashboardPluginIds()) {
        unregisterDashboardPlugin(id);
    }
    unregisterDashboardPluginPage('page-host');
}

function capturePlugins(
    fixture: DifferentialSurfaceFixture<DashboardPlugin>
) {
    const plugins = useDashboardPlugins();
    return captureDifferentialSurface({
        fixture,
        adapter: {
            register: registerDashboardPlugin,
            unregister: unregisterDashboardPlugin,
            snapshot: () => plugins.value,
            subscribe: (listener) =>
                watch(plugins, listener, { flush: 'sync' }),
        },
        getId: (plugin) => plugin.id,
        projectValue: (plugin) => ({
            id: plugin.id,
            label: plugin.label,
            order: plugin.order ?? 200,
            pageIds: listDashboardPluginPages(plugin.id).map((page) => page.id),
            pagesCopied: plugin.pages !== fixture.registrations.find(
                (source) => source.id === plugin.id && source.label === plugin.label
            )?.pages,
        }),
    });
}

function capturePages(
    fixture: DifferentialSurfaceFixture<PageRegistration>
) {
    const pages = useDashboardPluginPages(() => 'page-host');
    const adapter: DifferentialSurfaceAdapter<
        PageRegistration,
        DashboardPluginPage
    > = {
        register: ({ pluginId, page }) =>
            registerDashboardPluginPage(pluginId, page),
        unregister: (id) => {
            const [pluginId, pageId] = JSON.parse(id) as [string, string];
            unregisterDashboardPluginPage(pluginId, pageId);
        },
        snapshot: () => pages.value,
        subscribe: (listener) => watch(pages, listener, { flush: 'sync' }),
    };
    return captureDifferentialSurface({
        fixture,
        adapter,
        getId: (entry) => JSON.stringify([entry.pluginId, entry.page.id]),
        getProjectedId: (page) => JSON.stringify(['page-host', page.id]),
        projectValue: (page) => ({
            id: page.id,
            title: page.title,
            order: page.order ?? 200,
        }),
    });
}

describe('dashboard record contribution adapters', () => {
    it('matches inline replacement page projection notifications', () => {
        const capture = (enabled: boolean) => {
            select(enabled);
            clear();
            registerDashboardPlugin({
                id: 'inline-host',
                icon: 'host',
                label: 'Host',
                pages: [
                    { id: 'one', title: 'One', component: {} },
                    { id: 'two', title: 'Two', component: {} },
                ],
            });
            const pages = useDashboardPluginPages(() => 'inline-host');
            let notifications = 0;
            const stop = watch(
                pages,
                () => {
                    notifications += 1;
                },
                { flush: 'sync' }
            );
            registerDashboardPlugin({
                id: 'inline-host',
                icon: 'replacement',
                label: 'Replacement',
                pages: [{ id: 'new', title: 'New', component: {} }],
            });
            const result = {
                notifications,
                ids: pages.value.map((page) => page.id),
            };
            stop();
            clear();
            return result;
        };

        expect(capture(true)).toEqual(capture(false));
        select(false);
    });

    it('matches plugin replacement, inline page replacement, projection, and ownership', () => {
        const oldPage = { name: 'Old' } as Component;
        const newPage = { name: 'New' } as Component;
        const fixture: DifferentialSurfaceFixture<DashboardPlugin> = {
            profileId: 'registry.dashboard',
            registrations: [
                {
                    id: 'z-plugin',
                    icon: 'z',
                    label: 'Old',
                    capabilities: ['read', 'write'],
                    pages: [
                        { id: 'old-a', title: 'Old A', component: oldPage },
                        { id: 'old-b', title: 'Old B', component: {} },
                    ],
                },
                { id: 'a-plugin', icon: 'a', label: 'A' },
                {
                    id: 'denied-plugin',
                    icon: 'denied',
                    label: 'Denied',
                    access: { authRequired: true },
                },
                {
                    id: 'z-plugin',
                    icon: 'z2',
                    label: 'Replacement',
                    capabilities: ['read', 'write'],
                    pages: [{ id: 'new-a', title: 'New A', component: newPage }],
                },
            ],
            disposeRegistrations: [0],
        };
        requireCompatibilityProfile(profiles, fixture.profileId);
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        select(false);
        clear();
        const expected = capturePlugins(fixture);
        clear();
        select(true);
        clear();
        const actual = capturePlugins(fixture);

        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual.projectedIds).toEqual(['z-plugin', 'a-plugin']);
        expect(actual.projectedValues).toEqual([
            {
                id: 'z-plugin',
                label: 'Replacement',
                order: 200,
                pageIds: ['new-a'],
                pagesCopied: true,
            },
            {
                id: 'a-plugin',
                label: 'A',
                order: 200,
                pageIds: [],
                pagesCopied: false,
            },
        ]);
        expect(actual.disposeReturns).toEqual([
            { kind: 'boolean', value: false },
        ]);
        expect(getDashboardPluginPage('z-plugin', 'old-a')).toBeUndefined();
        expect(Object.isFrozen(getDashboardPluginPage('z-plugin', 'new-a'))).toBe(
            true
        );
        expect(hasCapability('z-plugin', 'read')).toBe(true);
        expect(hasAllCapabilities('z-plugin', ['read', 'write'])).toBe(true);
        expect(hasAnyCapability('z-plugin', ['missing', 'write'])).toBe(true);
        expect(getPluginCapabilities('z-plugin')).toEqual(['read', 'write']);

        clear();
        select(false);
        consoleWarn.mockRestore();
    });

    it('matches standalone page replacement, access merge, freezing, and order ties', () => {
        const first = { name: 'First' } as Component;
        const replacement = { name: 'Replacement' } as Component;
        const fixture: DifferentialSurfaceFixture<PageRegistration> = {
            profileId: 'registry.dashboard',
            registrations: [
                {
                    pluginId: 'page-host',
                    page: {
                        id: 'z-page',
                        title: 'Original',
                        component: first,
                        access: { authRequired: false },
                    },
                },
                {
                    pluginId: 'page-host',
                    page: {
                        id: 'a-page',
                        title: 'A',
                        component: {},
                        access: { authRequired: false },
                    },
                },
                {
                    pluginId: 'page-host',
                    page: {
                        id: 'z-page',
                        title: 'Replacement',
                        component: replacement,
                        access: { authRequired: false },
                    },
                },
                {
                    pluginId: 'page-host',
                    page: {
                        id: 'denied-page',
                        title: 'Denied',
                        component: {},
                        access: { authRequired: true },
                    },
                },
            ],
            unregisterIds: [JSON.stringify(['page-host', 'missing-page'])],
        };
        requireCompatibilityProfile(profiles, fixture.profileId);

        const run = (enabled: boolean) => {
            select(enabled);
            clear();
            registerDashboardPlugin({
                id: 'page-host',
                icon: 'host',
                label: 'Host',
                access: { authRequired: true },
            });
            return capturePages(fixture);
        };
        const expected = run(false);
        clear();
        const actual = run(true);

        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual.projectedIds).toEqual([
            '["page-host","z-page"]',
            '["page-host","a-page"]',
        ]);
        expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(
            true
        );
        expect(Object.isFrozen(getDashboardPluginPage('page-host', 'z-page'))).toBe(
            true
        );
        expect(getDashboardPluginPage('page-host', 'z-page')?.component).toBe(
            replacement
        );

        clear();
        select(false);
    });
});
