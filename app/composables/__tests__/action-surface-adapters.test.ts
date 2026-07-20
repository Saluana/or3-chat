import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watch } from 'vue';
import {
    listRegisteredMessageActionIds,
    registerMessageAction,
    unregisterMessageAction,
    useMessageActions,
    type ChatMessageAction,
} from '../chat/useMessageActions';
import {
    listRegisteredHeaderActionIds,
    registerHeaderAction,
    unregisterHeaderAction,
    useHeaderActions,
    type HeaderAction,
    type HeaderActionEntry,
} from '../sidebar/useHeaderActions';
import {
    listRegisteredComposerActionIds,
    registerComposerAction,
    unregisterComposerAction,
    useComposerActions,
    type ComposerAction,
    type ComposerActionEntry,
} from '../sidebar/useComposerActions';
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
    (
        globalThis as typeof globalThis & {
            __or3ContributionSurfaceSelection?: ReturnType<
                typeof createContributionSurfaceSelection
            >;
        }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(surfaces);
}

function clear(ids: () => string[], unregister: (id: string) => void) {
    for (const id of ids()) unregister(id);
}

function compareProfile<TRegistration, TProjection>(input: {
    profileId: string;
    surface: PluginContributionSurfaceId;
    fixture: DifferentialSurfaceFixture<TRegistration>;
    adapter: () => DifferentialSurfaceAdapter<TRegistration, TProjection>;
    getId: (value: TRegistration) => string;
    getProjectedId: (value: TProjection) => string;
    identityValue: (value: TProjection) => unknown;
    projectValue: (value: TProjection) => unknown;
    clear: () => void;
}) {
    requireCompatibilityProfile(profiles, input.profileId);
    select([]);
    input.clear();
    const expected = captureDifferentialSurface({
        fixture: input.fixture,
        adapter: input.adapter(),
        getId: input.getId,
        getProjectedId: input.getProjectedId,
        identityValue: input.identityValue,
        projectValue: input.projectValue,
    });
    input.clear();

    select([input.surface]);
    input.clear();
    const actual = captureDifferentialSurface({
        fixture: input.fixture,
        adapter: input.adapter(),
        getId: input.getId,
        getProjectedId: input.getProjectedId,
        identityValue: input.identityValue,
        projectValue: input.projectValue,
    });
    input.clear();
    select([]);

    expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
    return actual;
}

describe('first-wave contribution surface adapters', () => {
    it('matches the message-action profile', () => {
        const fixture: DifferentialSurfaceFixture<ChatMessageAction> = {
            profileId: 'registry.message-actions',
            registrations: [
                { id: 'b', icon: 'b', tooltip: 'first', showOn: 'both', handler: () => {} },
                { id: 'b', icon: 'b', tooltip: 'replacement', showOn: 'both', handler: () => {} },
                { id: 'a', icon: 'a', tooltip: 'default', showOn: 'assistant', handler: () => {} },
                { id: 'early', order: 100, icon: 'e', tooltip: 'early', showOn: 'both', handler: () => {} },
                { id: 'user-only', icon: 'u', tooltip: 'user', showOn: 'user', handler: () => {} },
            ],
            disposeRegistrations: [0],
        };
        const actual = compareProfile({
            profileId: fixture.profileId,
            surface: 'message-actions',
            fixture,
            adapter: () => {
                const items = useMessageActions({ role: 'assistant' });
                return {
                    register: registerMessageAction,
                    unregister: unregisterMessageAction,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            getProjectedId: (value) => value.id,
            identityValue: (value) => value,
            projectValue: (value) => ({ id: value.id, tooltip: value.tooltip, order: value.order ?? 200 }),
            clear: () => clear(listRegisteredMessageActionIds, unregisterMessageAction),
        });
        expect(actual.projectedIds).toEqual(['early', 'a', 'b']);
    });

    it('matches header visibility, disabled, ordering, and return behavior', () => {
        const fixture: DifferentialSurfaceFixture<HeaderAction> = {
            profileId: 'registry.header-actions',
            registrations: [
                { id: 'z', icon: 'first', handler: () => {} },
                { id: 'z', icon: 'replacement', disabled: () => true, handler: () => {} },
                { id: 'a', icon: 'a', handler: () => {} },
                { id: 'hidden', icon: 'h', visible: () => false, handler: () => {} },
            ],
            disposeRegistrations: [0],
        };
        const actual = compareProfile({
            profileId: fixture.profileId,
            surface: 'header-actions',
            fixture,
            adapter: () => {
                const items = useHeaderActions();
                return {
                    register: registerHeaderAction,
                    unregister: unregisterHeaderAction,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            getProjectedId: (value: HeaderActionEntry) => value.action.id,
            identityValue: (value: HeaderActionEntry) => value.action,
            projectValue: (value: HeaderActionEntry) => ({
                id: value.action.id,
                icon: value.action.icon,
                disabled: value.disabled,
            }),
            clear: () => clear(listRegisteredHeaderActionIds, unregisterHeaderAction),
        });
        expect(actual.projectedValues).toEqual([
            { id: 'a', icon: 'a', disabled: false },
            { id: 'z', icon: 'replacement', disabled: true },
        ]);
    });

    it('matches composer stable order-only ties and context evaluation', () => {
        const fixture: DifferentialSurfaceFixture<ComposerAction> = {
            profileId: 'registry.composer-actions',
            registrations: [
                { id: 'z', icon: 'first', handler: () => {} },
                { id: 'z', icon: 'replacement', disabled: () => true, handler: () => {} },
                { id: 'a', icon: 'a', handler: () => {} },
                { id: 'hidden', icon: 'h', visible: () => false, handler: () => {} },
            ],
            disposeRegistrations: [0],
        };
        const actual = compareProfile({
            profileId: fixture.profileId,
            surface: 'composer-actions',
            fixture,
            adapter: () => {
                const items = useComposerActions();
                return {
                    register: registerComposerAction,
                    unregister: unregisterComposerAction,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            getProjectedId: (value: ComposerActionEntry) => value.action.id,
            identityValue: (value: ComposerActionEntry) => value.action,
            projectValue: (value: ComposerActionEntry) => ({
                id: value.action.id,
                icon: value.action.icon,
                disabled: value.disabled,
            }),
            clear: () => clear(listRegisteredComposerActionIds, unregisterComposerAction),
        });
        expect(actual.projectedValues).toEqual([
            { id: 'z', icon: 'replacement', disabled: true },
            { id: 'a', icon: 'a', disabled: false },
        ]);
    });
});
