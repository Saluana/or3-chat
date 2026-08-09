import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watch, type Component } from 'vue';
import {
    listRegisteredSidebarSectionIds,
    registerSidebarSection,
    unregisterSidebarSection,
    useSidebarSections,
    type SidebarSection,
    type SidebarSectionPlacement,
} from '../sidebar/useSidebarSections';
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

interface ProjectedSection {
    readonly section: SidebarSection;
    readonly placement: SidebarSectionPlacement;
}

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['sidebar-sections'] : []
    );
}

function clear() {
    for (const id of listRegisteredSidebarSectionIds()) {
        unregisterSidebarSection(id);
    }
}

function adapter(): DifferentialSurfaceAdapter<
    SidebarSection,
    ProjectedSection
> {
    const groups = useSidebarSections();
    const snapshot = (): readonly ProjectedSection[] => [
        ...groups.value.top.map((section) => ({ section, placement: 'top' as const })),
        ...groups.value.main.map((section) => ({
            section,
            placement: 'main' as const,
        })),
        ...groups.value.bottom.map((section) => ({
            section,
            placement: 'bottom' as const,
        })),
    ];
    return {
        register: registerSidebarSection,
        unregister: unregisterSidebarSection,
        snapshot,
        subscribe: (listener) => watch(groups, listener, { flush: 'sync' }),
    };
}

describe('sidebar sections contribution adapter', () => {
    it('matches placement, access, identity, replacement, order, and return behavior', () => {
        const componentA = { name: 'A' } as Component;
        const componentZ = { name: 'Z' } as Component;
        const firstReplacement = { name: 'FirstReplacement' } as Component;
        const finalReplacement = { name: 'FinalReplacement' } as Component;
        const componentTop = { name: 'Top' } as Component;
        const deniedComponent = { name: 'Denied' } as Component;
        const fixture: DifferentialSurfaceFixture<SidebarSection> = {
            profileId: 'registry.sidebar-sections',
            registrations: [
                { id: 'z', component: componentZ },
                { id: 'a', component: componentA },
                {
                    id: 'replace',
                    component: firstReplacement,
                    placement: 'top',
                },
                {
                    id: 'replace',
                    component: finalReplacement,
                    placement: 'bottom',
                },
                {
                    id: 'top',
                    component: componentTop,
                    placement: 'top',
                    order: 100,
                },
                {
                    id: 'denied',
                    component: deniedComponent,
                    placement: 'bottom',
                    access: { authRequired: true },
                },
            ],
        };
        requireCompatibilityProfile(profiles, fixture.profileId);

        select(false);
        clear();
        const expected = captureDifferentialSurface({
            fixture,
            adapter: adapter(),
            getId: (section) => section.id,
            getProjectedId: (value) => value.section.id,
            identityValue: (value) => value.section,
            projectValue: (value) => ({
                id: value.section.id,
                placement: value.placement,
                componentIdentity:
                    value.section.component === componentA ||
                    value.section.component === componentZ ||
                    value.section.component === componentTop ||
                    value.section.component === finalReplacement,
            }),
        });

        clear();
        select(true);
        clear();
        const actual = captureDifferentialSurface({
            fixture,
            adapter: adapter(),
            getId: (section) => section.id,
            getProjectedId: (value) => value.section.id,
            identityValue: (value) => value.section,
            projectValue: (value) => ({
                id: value.section.id,
                placement: value.placement,
                componentIdentity:
                    value.section.component === componentA ||
                    value.section.component === componentZ ||
                    value.section.component === componentTop ||
                    value.section.component === finalReplacement,
            }),
        });

        clear();
        select(false);
        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual.projectedValues).toEqual([
            { id: 'top', placement: 'top', componentIdentity: true },
            { id: 'a', placement: 'main', componentIdentity: true },
            { id: 'z', placement: 'main', componentIdentity: true },
            { id: 'replace', placement: 'bottom', componentIdentity: true },
        ]);
        expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(
            true
        );
    });
});
