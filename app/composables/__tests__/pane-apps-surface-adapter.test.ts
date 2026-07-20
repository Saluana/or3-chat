import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { watch, type Component } from 'vue';
import {
    usePaneApps,
    type PaneAppDef,
    type RegisteredPaneApp,
} from '../core/usePaneApps';
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
            'planning/plugin-runtime-v2/compatibility-profiles.json'
        ),
        'utf8'
    )
) as CompatibilityProfileDocument;

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['pane-apps'] : []
    );
}

function clear() {
    const paneApps = usePaneApps();
    for (const app of paneApps.listPaneApps.value) {
        paneApps.unregisterPaneApp(app.id);
    }
}

function adapter(): DifferentialSurfaceAdapter<PaneAppDef, RegisteredPaneApp> {
    const paneApps = usePaneApps();
    return {
        register: paneApps.registerPaneApp,
        unregister: paneApps.unregisterPaneApp,
        snapshot: () => paneApps.listPaneApps.value,
        subscribe: (listener) =>
            watch(paneApps.listPaneApps, listener, { flush: 'sync' }),
    };
}

describe('pane apps contribution adapter', () => {
    it('matches validation, normalization, stable ties, getters, and exact ownership', () => {
        const componentZ = { name: 'Z' } as Component;
        const componentReplacement = { name: 'Replacement' } as Component;
        const loader = async () => ({ name: 'AsyncPane' });
        const createInitialRecord = async () => ({ id: 'created' });
        const fixture: DifferentialSurfaceFixture<PaneAppDef> = {
            profileId: 'registry.pane-apps',
            registrations: [
                { id: 'Bad ID', label: 'Pane', component: {} },
                { id: 'valid', label: '', component: {} },
                { id: 'z-pane', label: 'Original', component: componentZ },
                {
                    id: 'a-pane',
                    label: 'Async',
                    component: loader,
                    postType: 'custom-post',
                    createInitialRecord,
                },
                {
                    id: 'z-pane',
                    label: 'Replacement',
                    component: componentReplacement,
                },
            ],
            disposeRegistrations: [2],
        };
        requireCompatibilityProfile(profiles, fixture.profileId);
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        select(false);
        clear();
        const expected = captureDifferentialSurface({
            fixture,
            adapter: adapter(),
            getId: (app) => app.id,
            projectValue: (app) => ({
                id: app.id,
                label: app.label,
                order: app.order,
                componentIdentity:
                    app.component === componentReplacement ||
                    app.component === loader,
                postType: app.postType,
                callbackIdentity: app.createInitialRecord === createInitialRecord,
            }),
        });

        clear();
        select(true);
        clear();
        const actual = captureDifferentialSurface({
            fixture,
            adapter: adapter(),
            getId: (app) => app.id,
            projectValue: (app) => ({
                id: app.id,
                label: app.label,
                order: app.order,
                componentIdentity:
                    app.component === componentReplacement ||
                    app.component === loader,
                postType: app.postType,
                callbackIdentity: app.createInitialRecord === createInitialRecord,
            }),
        });

        const paneApps = usePaneApps();
        expect(paneApps.getPaneApp('z-pane')?.label).toBe('Replacement');
        expect(paneApps.getPaneApp('missing-pane')).toBeUndefined();
        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual.projectedIds).toEqual(['z-pane', 'a-pane']);
        expect(actual.exceptions.map((error) => error.message)).toEqual([
            'App id must be lowercase alphanumeric with hyphens',
            'Label is required',
        ]);
        expect(actual.registerReturns.slice(2).every(
            (value) => value.kind === 'registration-handle'
        )).toBe(true);
        expect(actual.disposeReturns).toEqual([
            { kind: 'boolean', value: false },
        ]);
        expect(actual.projectedValues).toEqual([
            {
                id: 'z-pane',
                label: 'Replacement',
                order: 200,
                componentIdentity: true,
                postType: undefined,
                callbackIdentity: false,
            },
            {
                id: 'a-pane',
                label: 'Async',
                order: 200,
                componentIdentity: true,
                postType: 'custom-post',
                callbackIdentity: true,
            },
        ]);

        clear();
        select(false);
        consoleError.mockRestore();
    });
});
