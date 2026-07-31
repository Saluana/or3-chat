import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watch } from 'vue';
import {
    listRegisteredSidebarFooterActionIds,
    registerSidebarFooterAction,
    unregisterSidebarFooterAction,
    useSidebarFooterActions,
    type SidebarFooterAction,
    type SidebarFooterActionEntry,
} from '../sidebar/useSidebarSections';
import {
    listRegisteredDocumentHistoryActionIds,
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    useDocumentHistoryActions,
    type DocumentHistoryAction,
} from '../documents/useDocumentHistoryActions';
import {
    listRegisteredThreadHistoryActionIds,
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    useThreadHistoryActions,
    type ThreadHistoryAction,
} from '../threads/useThreadHistoryActions';
import { createContributionSurfaceSelection } from '../plugins/contribution-surface-selection';
import {
    captureDifferentialSurface,
    compareDifferentialSurfaces,
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
    type DifferentialSurfaceAdapter,
    type DifferentialSurfaceFixture,
} from '../../../tests/plugin-runtime/differential-surface-harness';
import type { PluginContributionSurfaceId } from '~~/shared/plugins/contribution-surfaces';

const profiles = JSON.parse(
    readFileSync(
        resolve(process.cwd(), 'planning/plugin-runtime-v2/compatibility-profiles.json'),
        'utf8'
    )
) as CompatibilityProfileDocument;

function select(surfaces: PluginContributionSurfaceId[]) {
    (globalThis as { __or3ContributionSurfaceSelection?: unknown }).__or3ContributionSurfaceSelection =
        createContributionSurfaceSelection(surfaces);
}

function clear(ids: () => string[], unregister: (id: string) => void) {
    for (const id of ids()) unregister(id);
}

function compareProfile<TRegistration, TProjection>(input: {
    surface: PluginContributionSurfaceId;
    fixture: DifferentialSurfaceFixture<TRegistration>;
    adapter: () => DifferentialSurfaceAdapter<TRegistration, TProjection>;
    getId: (value: TRegistration) => string;
    getProjectedId: (value: TProjection) => string;
    identityValue: (value: TProjection) => unknown;
    projectValue: (value: TProjection) => unknown;
    clear: () => void;
}) {
    requireCompatibilityProfile(profiles, input.fixture.profileId);
    select([]);
    input.clear();
    const expected = captureDifferentialSurface({ ...input, adapter: input.adapter() });
    input.clear();
    select([input.surface]);
    input.clear();
    const actual = captureDifferentialSurface({ ...input, adapter: input.adapter() });
    input.clear();
    select([]);
    expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
    return actual;
}

describe('footer and history contribution adapters', () => {
    it('matches footer visibility, disabled, access, order, and handle behavior', () => {
        const fixture: DifferentialSurfaceFixture<SidebarFooterAction> = {
            profileId: 'registry.sidebar-footer-actions',
            registrations: [
                { id: 'z', icon: 'first', handler: () => {} },
                { id: 'z', icon: 'replacement', disabled: () => true, handler: () => {} },
                { id: 'a', icon: 'a', handler: () => {} },
                { id: 'hidden', icon: 'h', visible: () => false, handler: () => {} },
                { id: 'denied', icon: 'd', access: { authRequired: true }, handler: () => {} },
            ],
            disposeRegistrations: [0],
        };
        const actual = compareProfile({
            surface: 'sidebar-footer-actions',
            fixture,
            adapter: () => {
                const items = useSidebarFooterActions();
                return {
                    register: registerSidebarFooterAction,
                    unregister: unregisterSidebarFooterAction,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            getProjectedId: (value: SidebarFooterActionEntry) => value.action.id,
            identityValue: (value: SidebarFooterActionEntry) => value.action,
            projectValue: (value: SidebarFooterActionEntry) => ({
                id: value.action.id,
                icon: value.action.icon,
                disabled: value.disabled,
            }),
            clear: () =>
                clear(listRegisteredSidebarFooterActionIds, unregisterSidebarFooterAction),
        });
        expect(actual.projectedValues).toEqual([
            { id: 'a', icon: 'a', disabled: false },
            { id: 'z', icon: 'replacement', disabled: true },
        ]);
    });

    it.each([
        {
            label: 'document',
            surface: 'document-history-actions' as const,
            register: registerDocumentHistoryAction,
            unregister: unregisterDocumentHistoryAction,
            listIds: listRegisteredDocumentHistoryActionIds,
            useItems: useDocumentHistoryActions,
        },
        {
            label: 'thread',
            surface: 'thread-history-actions' as const,
            register: registerThreadHistoryAction,
            unregister: unregisterThreadHistoryAction,
            listIds: listRegisteredThreadHistoryActionIds,
            useItems: useThreadHistoryActions,
        },
    ])('matches $label history void returns, replacement, and ordering', (surface) => {
        type Action = DocumentHistoryAction | ThreadHistoryAction;
        const fixture: DifferentialSurfaceFixture<Action> = {
            profileId: 'registry.history-actions',
            registrations: [
                { id: 'z', icon: 'z', label: 'first', handler: () => {} },
                { id: 'z', icon: 'z2', label: 'replacement', handler: () => {} },
                { id: 'a', icon: 'a', label: 'default', handler: () => {} },
                { id: 'early', order: 100, icon: 'e', label: 'early', handler: () => {} },
            ],
        };
        const actual = compareProfile<Action, Action>({
            surface: surface.surface,
            fixture,
            adapter: () => {
                const items = surface.useItems();
                return {
                    register: surface.register as (value: Action) => unknown,
                    unregister: surface.unregister,
                    snapshot: () => items.value as readonly Action[],
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            getProjectedId: (value) => value.id,
            identityValue: (value) => value,
            projectValue: (value) => ({
                id: value.id,
                label: value.label,
                order: value.order ?? 200,
            }),
            clear: () => clear(surface.listIds, surface.unregister),
        });
        expect(actual.projectedIds).toEqual(['early', 'a', 'z']);
        expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(true);
    });
});
