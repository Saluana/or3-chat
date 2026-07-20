import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    listRegisteredDashboardPluginIds,
    registerDashboardPlugin,
    resolveDashboardPluginPageComponent,
    unregisterDashboardPlugin,
    useDashboardNavigation,
} from '../dashboard/useDashboardPlugins';
import { createContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import {
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
} from '../../../tests/plugin-runtime/differential-surface-harness';

const profiles = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'planning/plugin-runtime-v2/compatibility-profiles.json'
        ),
        'utf8'
    )
) as CompatibilityProfileDocument;

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['dashboard-navigation'] : []
    );
}

function clearPlugins() {
    for (const id of listRegisteredDashboardPluginIds()) {
        unregisterDashboardPlugin(id);
    }
}

async function captureNavigation(enabled: boolean) {
    select(enabled);
    clearPlugins();
    const navigation = useDashboardNavigation({ baseItems: [] });
    navigation.reset();

    const recoveredComponent = { name: 'Recovered' };
    const retryLoader = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue({ default: recoveredComponent });
    registerDashboardPlugin({
        id: 'retry-plugin',
        icon: 'retry',
        label: 'Retry',
        pages: [{ id: 'page', title: 'Page', component: retryLoader }],
    });

    const failed = await navigation.openPage('retry-plugin', 'page');
    const recovered = await navigation.openPage('retry-plugin', 'page');
    const recoveredErrorCleared = navigation.state.error === null;
    const cached = await resolveDashboardPluginPageComponent(
        'retry-plugin',
        'page'
    );

    const replacementComponent = { name: 'Replacement' };
    registerDashboardPlugin({
        id: 'retry-plugin',
        icon: 'replacement',
        label: 'Replacement',
        pages: [
            { id: 'page', title: 'Replacement', component: replacementComponent },
        ],
    });
    const replacement = await resolveDashboardPluginPageComponent(
        'retry-plugin',
        'page'
    );

    registerDashboardPlugin({
        id: 'active-plugin',
        icon: 'active',
        label: 'Active',
        pages: [
            { id: 'one', title: 'One', component: { name: 'One' } },
            { id: 'two', title: 'Two', component: { name: 'Two' } },
        ],
    });
    const opened = await navigation.openPlugin('active-plugin');
    unregisterDashboardPlugin('active-plugin');
    const retainedAfterRemoval = {
        view: navigation.state.view,
        activePluginId: navigation.state.activePluginId,
        activePageId: navigation.state.activePageId,
    };

    const afterRemovalComponent = { name: 'AfterRemoval' };
    registerDashboardPlugin({
        id: 'active-plugin',
        icon: 'active-new',
        label: 'Active New',
        pages: [
            {
                id: 'one',
                title: 'One New',
                component: afterRemovalComponent,
            },
        ],
    });
    const afterRemoval = await resolveDashboardPluginPageComponent(
        'active-plugin',
        'one'
    );
    const missing = await navigation.openPage('missing-plugin', 'missing-page');

    const observation = {
        failed: failed.ok ? null : failed.error.code,
        recovered: recovered.ok,
        recoveredErrorCleared,
        retryCalls: retryLoader.mock.calls.length,
        cachedIdentity: cached === recoveredComponent,
        replacementIdentity: replacement === replacementComponent,
        opened: opened.ok,
        retainedAfterRemoval,
        afterRemovalIdentity: afterRemoval === afterRemovalComponent,
        missing: missing.ok ? null : missing.error.code,
    };

    clearPlugins();
    navigation.reset();
    return observation;
}

describe('dashboard navigation contribution adapter', () => {
    it('matches resolution, retry, replacement, removal, active state, and caches', async () => {
        requireCompatibilityProfile(profiles, 'registry.dashboard');
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        const expected = await captureNavigation(false);
        const actual = await captureNavigation(true);

        expect(actual).toEqual(expected);
        expect(actual).toEqual({
            failed: 'resolve-error',
            recovered: true,
            recoveredErrorCleared: true,
            retryCalls: 2,
            cachedIdentity: true,
            replacementIdentity: true,
            opened: true,
            retainedAfterRemoval: {
                view: 'page',
                activePluginId: 'active-plugin',
                activePageId: null,
            },
            afterRemovalIdentity: true,
            missing: 'missing-plugin',
        });

        select(false);
        consoleWarn.mockRestore();
    });
});
