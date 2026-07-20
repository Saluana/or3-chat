import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isReactive, watch, type Component } from 'vue';
import {
    useSidebarPages,
    type RegisteredSidebarPage,
    type SidebarPageDef,
} from '../sidebar/useSidebarPages';
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
const originalClient = process.client;

function setClient(value: boolean) {
    Object.defineProperty(process, 'client', { value, configurable: true });
}

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['sidebar-pages'] : []
    );
}

function clear() {
    const pages = useSidebarPages();
    for (const page of pages.listSidebarPages.value) {
        pages.unregisterSidebarPage(page.id);
    }
    pages.unregisterSidebarPage('denied-page');
}

function adapter(): DifferentialSurfaceAdapter<
    SidebarPageDef,
    RegisteredSidebarPage
> {
    const pages = useSidebarPages();
    return {
        register: pages.registerSidebarPage,
        unregister: pages.unregisterSidebarPage,
        snapshot: () => pages.listSidebarPages.value,
        subscribe: (listener) =>
            watch(pages.listSidebarPages, listener, { flush: 'sync' }),
    };
}

describe('sidebar pages contribution adapter', () => {
    it('matches validation, defaults, components, access, callbacks, and disposal', () => {
        const firstComponent = { name: 'First' } as Component;
        const replacementComponent = { name: 'Replacement' } as Component;
        const loader = async () => ({ name: 'AsyncPage' });
        const provideContext = () => {};
        const canActivate = () => true;
        const onActivate = () => {};
        const onDeactivate = () => {};
        const fixture: DifferentialSurfaceFixture<SidebarPageDef> = {
            profileId: 'registry.sidebar-pages',
            registrations: [
                { id: 'Bad ID', label: 'Page', icon: 'i', component: {} },
                { id: 'valid', label: '', icon: 'i', component: {} },
                { id: 'valid', label: 'Page', icon: '', component: {} },
                {
                    id: 'z-page',
                    label: 'Original',
                    icon: 'z',
                    component: firstComponent,
                },
                {
                    id: 'a-page',
                    label: 'Async',
                    icon: 'a',
                    component: loader,
                    provideContext,
                    canActivate,
                    onActivate,
                    onDeactivate,
                },
                {
                    id: 'sidebar-home',
                    label: 'Home',
                    icon: 'home',
                    component: {},
                },
                {
                    id: 'denied-page',
                    label: 'Denied',
                    icon: 'denied',
                    component: {},
                    access: { authRequired: true },
                },
                {
                    id: 'z-page',
                    label: 'Replacement',
                    icon: 'z2',
                    component: replacementComponent,
                },
            ],
            disposeRegistrations: [3],
        };
        requireCompatibilityProfile(profiles, fixture.profileId);
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        setClient(true);

        const capture = () =>
            captureDifferentialSurface({
                fixture,
                adapter: adapter(),
                getId: (page) => page.id,
                projectValue: (page) => ({
                    id: page.id,
                    label: page.label,
                    order: page.order,
                    usesDefaultHeader: page.usesDefaultHeader,
                    staticComponentIdentity:
                        page.component === replacementComponent,
                    asyncWrapped: Boolean(
                        (page.component as { __asyncLoader?: unknown })
                            .__asyncLoader
                    ),
                    componentReactive: isReactive(page.component),
                    callbackIdentity:
                        page.provideContext === provideContext &&
                        page.canActivate === canActivate &&
                        page.onActivate === onActivate &&
                        page.onDeactivate === onDeactivate,
                }),
            });

        select(false);
        clear();
        const expected = capture();
        clear();
        select(true);
        clear();
        const actual = capture();

        const pages = useSidebarPages();
        expect(pages.getSidebarPage('z-page')?.label).toBe('Replacement');
        expect(pages.getSidebarPage('denied-page')).toBeDefined();
        expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
        expect(actual.projectedIds).toEqual([
            'z-page',
            'a-page',
            'sidebar-home',
        ]);
        expect(actual.exceptions.map((error) => error.message)).toEqual([
            'Page id must be lowercase alphanumeric with hyphens',
            'Label is required',
            'Icon is required',
        ]);
        expect(
            actual.registerReturns
                .slice(3)
                .every((value) => value.kind === 'disposer-function')
        ).toBe(true);
        expect(actual.disposeReturns).toEqual([{ kind: 'undefined' }]);
        expect(actual.projectedValues).toEqual([
            {
                id: 'z-page',
                label: 'Replacement',
                order: 200,
                usesDefaultHeader: false,
                staticComponentIdentity: true,
                asyncWrapped: false,
                componentReactive: false,
                callbackIdentity: false,
            },
            {
                id: 'a-page',
                label: 'Async',
                order: 200,
                usesDefaultHeader: false,
                staticComponentIdentity: false,
                asyncWrapped: true,
                componentReactive: false,
                callbackIdentity: true,
            },
            {
                id: 'sidebar-home',
                label: 'Home',
                order: 200,
                usesDefaultHeader: true,
                staticComponentIdentity: false,
                asyncWrapped: false,
                componentReactive: false,
                callbackIdentity: false,
            },
        ]);

        clear();
        select(false);
        setClient(originalClient ?? true);
        consoleWarn.mockRestore();
        consoleError.mockRestore();
    });

    it.each([false, true])(
        'keeps server registration a no-op when V2 selection is %s',
        (enabled) => {
            select(enabled);
            setClient(true);
            clear();
            setClient(false);
            const pages = useSidebarPages();
            const dispose = pages.registerSidebarPage({
                id: 'server-page',
                label: 'Server',
                icon: 'server',
                component: {},
            });
            expect(pages.getSidebarPage('server-page')).toBeUndefined();
            expect(dispose()).toBeUndefined();
            setClient(originalClient ?? true);
            select(false);
        }
    );
});
