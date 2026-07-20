import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ref, watch } from 'vue';
import {
    listRegisteredProjectTreeActionIds,
    registerProjectTreeAction,
    unregisterProjectTreeAction,
    useProjectTreeActions,
    type ProjectTreeAction,
} from '../projects/useProjectTreeActions';
import {
    listRegisteredEditorToolbarButtonIds,
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    useEditorToolbarButtons,
    type EditorToolbarButton,
} from '../editor/useEditorToolbar';
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

function compareProfile<T>(input: {
    surface: PluginContributionSurfaceId;
    fixture: DifferentialSurfaceFixture<T>;
    adapter: () => DifferentialSurfaceAdapter<T>;
    getId: (value: T) => string;
    projectValue: (value: T) => unknown;
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

describe('project tree and editor toolbar adapters', () => {
    it('matches project-tree void returns, replacement, stored showOn, and ordering', () => {
        const fixture: DifferentialSurfaceFixture<ProjectTreeAction> = {
            profileId: 'registry.project-tree-actions',
            registrations: [
                { id: 'z', icon: 'z', label: 'first', showOn: ['root'], handler: () => {} },
                { id: 'z', icon: 'z2', label: 'replacement', showOn: ['doc'], handler: () => {} },
                { id: 'a', icon: 'a', label: 'default', handler: () => {} },
                { id: 'early', order: 100, icon: 'e', label: 'early', handler: () => {} },
            ],
        };
        const actual = compareProfile({
            surface: 'project-tree-actions',
            fixture,
            adapter: () => {
                const items = useProjectTreeActions();
                return {
                    register: registerProjectTreeAction,
                    unregister: unregisterProjectTreeAction,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            projectValue: (value) => ({
                id: value.id,
                label: value.label,
                order: value.order ?? 200,
                showOn: value.showOn,
            }),
            clear: () => clear(listRegisteredProjectTreeActionIds, unregisterProjectTreeAction),
        });
        expect(actual.projectedIds).toEqual(['early', 'a', 'z']);
        expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(true);
    });

    it('matches editor ordering and hides false or throwing visibility predicates', () => {
        const fixture: DifferentialSurfaceFixture<EditorToolbarButton> = {
            profileId: 'registry.editor-toolbar',
            registrations: [
                { id: 'z', icon: 'first', onClick: () => {} },
                { id: 'z', icon: 'replacement', onClick: () => {} },
                { id: 'a', icon: 'a', visible: () => true, onClick: () => {} },
                { id: 'hidden', icon: 'h', visible: () => false, onClick: () => {} },
                {
                    id: 'throws',
                    icon: 't',
                    visible: () => {
                        throw new Error('visibility boom');
                    },
                    onClick: () => {},
                },
                { id: 'early', order: 100, icon: 'e', onClick: () => {} },
            ],
        };
        const actual = compareProfile({
            surface: 'editor-toolbar',
            fixture,
            adapter: () => {
                const items = useEditorToolbarButtons(ref({} as never));
                return {
                    register: registerEditorToolbarButton,
                    unregister: unregisterEditorToolbarButton,
                    snapshot: () => items.value,
                    subscribe: (listener) => watch(items, listener, { flush: 'sync' }),
                };
            },
            getId: (value) => value.id,
            projectValue: (value) => ({ id: value.id, icon: value.icon, order: value.order ?? 200 }),
            clear: () =>
                clear(listRegisteredEditorToolbarButtonIds, unregisterEditorToolbarButton),
        });
        expect(actual.projectedIds).toEqual(['early', 'a', 'z']);
        expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(true);
    });
});
