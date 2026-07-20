import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isReactive, toRaw, watch } from 'vue';
import {
    loadAdminPlugins,
    registerAdminPage,
    registerAdminWidget,
    resolveAdminComponent,
    state,
    useAdminPages,
    useAdminWidgets,
    type AdminPageDef,
    type AdminWidgetDef,
} from '../admin/useAdminPlugins';
import { createContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import {
    captureDifferentialSurface,
    compareDifferentialSurfaces,
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
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
        enabled ? ['admin-extensions'] : []
    );
}

describe('admin extension contribution adapters', () => {
    it('matches replace-in-place pages/widgets, defaults, projections, and returns', () => {
        requireCompatibilityProfile(profiles, 'registry.admin-extensions');
        const prefix = `adapter-${crypto.randomUUID()}`;
        const pageFixture: DifferentialSurfaceFixture<AdminPageDef> = {
            profileId: 'registry.admin-extensions',
            registrations: [
                { id: `${prefix}-first`, label: 'First', component: {} },
                { id: `${prefix}-target`, label: 'Old', component: {} },
                { id: `${prefix}-last`, label: 'Last', component: {} },
                { id: `${prefix}-target`, label: 'New', component: {} },
            ],
        };
        const widgetFixture: DifferentialSurfaceFixture<AdminWidgetDef> = {
            profileId: 'registry.admin-extensions',
            registrations: [
                { id: `${prefix}-first-widget`, slot: 'overview', component: {} },
                { id: `${prefix}-target-widget`, slot: 'overview', component: {} },
                { id: `${prefix}-last-widget`, slot: 'workspace', component: {} },
                { id: `${prefix}-target-widget`, slot: 'system', component: {} },
            ],
        };

        const capture = (enabled: boolean) => {
            select(enabled);
            state.pages = [];
            state.widgets = [];
            const pages = useAdminPages();
            const widgets = useAdminWidgets();
            const pageResult = captureDifferentialSurface({
                fixture: pageFixture,
                adapter: {
                    register: registerAdminPage,
                    unregister: () => undefined,
                    snapshot: () =>
                        pages.value.filter((page) => page.id.startsWith(prefix)),
                    subscribe: (listener) =>
                        watch(pages, listener, { flush: 'sync' }),
                },
                getId: (page) => page.id,
                projectValue: (page) => ({
                    id: page.id,
                    label: page.label,
                    path: page.path,
                    order: page.order ?? 0,
                    reactive: isReactive(page),
                    normalizedCopy: !pageFixture.registrations.includes(
                        toRaw(page)
                    ),
                }),
            });
            const widgetResult = captureDifferentialSurface({
                fixture: widgetFixture,
                adapter: {
                    register: registerAdminWidget,
                    unregister: () => undefined,
                    snapshot: () =>
                        widgets.value.filter((widget) =>
                            widget.id.startsWith(prefix)
                        ),
                    subscribe: (listener) =>
                        watch(widgets, listener, { flush: 'sync' }),
                },
                getId: (widget) => widget.id,
                projectValue: (widget) => ({
                    id: widget.id,
                    slot: widget.slot,
                    order: widget.order ?? 0,
                    reactive: isReactive(widget),
                    callerIdentity:
                        toRaw(widget) ===
                        widgetFixture.registrations.find(
                            (source) =>
                                source.id === widget.id &&
                                source.slot === widget.slot
                        ),
                }),
            });
            return { pageResult, widgetResult };
        };

        const expected = capture(false);
        const expectedStateOrder = {
            pages: state.pages.map((page) => page.id),
            widgets: state.widgets.map((widget) => widget.id),
        };
        const actual = capture(true);
        const actualStateOrder = {
            pages: state.pages.map((page) => page.id),
            widgets: state.widgets.map((widget) => widget.id),
        };

        expect(
            compareDifferentialSurfaces(
                expected.pageResult,
                actual.pageResult
            )
        ).toEqual([]);
        expect(
            compareDifferentialSurfaces(
                expected.widgetResult,
                actual.widgetResult
            )
        ).toEqual([]);
        expect(actualStateOrder).toEqual(expectedStateOrder);
        expect(actual.pageResult.projectedValues[1]).toMatchObject({
            label: 'New',
            path: `${prefix}-target`,
            order: 0,
            reactive: true,
            normalizedCopy: true,
        });
        expect(actual.widgetResult.projectedValues[1]).toMatchObject({
            slot: 'system',
            order: 0,
            reactive: true,
            callerIdentity: true,
        });
        expect(
            actual.pageResult.registerReturns.every(
                (value) => value.kind === 'undefined'
            )
        ).toBe(true);
        expect(
            actual.widgetResult.registerReturns.every(
                (value) => value.kind === 'undefined'
            )
        ).toBe(true);

        state.pages = [];
        state.widgets = [];
        select(false);
    });

    it.each([false, true])(
        'preserves loaded-once discovery and bounded shared-ID FIFO caching when V2 selection is %s',
        async (enabled) => {
            select(enabled);
            const prefix = `cache-${enabled}-${crypto.randomUUID()}`;
            const firstDef = {
                id: `${prefix}-0`,
                component: async () => ({ name: 'First' }),
            };
            const first = resolveAdminComponent(firstDef);
            const sameId = resolveAdminComponent({
                id: firstDef.id,
                component: async () => ({ name: 'Replacement' }),
            });
            let last: unknown;
            let lastDef = firstDef;
            for (let index = 1; index <= 51; index++) {
                lastDef = {
                    id: `${prefix}-${index}`,
                    component: async () => ({ name: `Item${index}` }),
                };
                last = resolveAdminComponent(lastDef);
            }
            const firstAfterEviction = resolveAdminComponent(firstDef);
            const lastAgain = resolveAdminComponent(lastDef);
            const staticComponent = { name: 'Static' };

            expect(sameId).toBe(first);
            expect(firstAfterEviction).not.toBe(first);
            expect(lastAgain).toBe(last);
            expect(
                resolveAdminComponent({
                    id: `${prefix}-static`,
                    component: staticComponent,
                })
            ).toBe(staticComponent);
            await expect(loadAdminPlugins()).resolves.toBeUndefined();
            await expect(loadAdminPlugins()).resolves.toBeUndefined();
            select(false);
        }
    );
});
