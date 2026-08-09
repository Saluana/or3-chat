import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isReactive, toRaw } from 'vue';
import { loadEditorExtensions } from '../editor/useEditorExtensionLoader';
import {
    listEditorExtensions,
    listEditorMarks,
    listEditorNodes,
    listRegisteredEditorExtensionIds,
    listRegisteredEditorMarkIds,
    listRegisteredEditorNodeIds,
    registerEditorExtension,
    registerEditorMark,
    registerEditorNode,
    unregisterEditorExtension,
    unregisterEditorMark,
    unregisterEditorNode,
    type EditorExtension,
    type EditorMark,
    type EditorNode,
} from '../editor/useEditorNodes';
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

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['editor-extensions'] : []
    );
}

function noSubscription() {
    return () => {};
}

function compareFamily<T extends { id: string; order?: number }>(input: {
    fixture: DifferentialSurfaceFixture<T>;
    register: (value: T) => unknown;
    unregister: (id: string) => unknown;
    list: () => T[];
    listIds: () => string[];
    nestedIdentity: (value: T) => unknown;
}) {
    const lastSources = new Map(
        input.fixture.registrations.map((value) => [value.id, value])
    );
    const adapter = (): DifferentialSurfaceAdapter<T> => ({
        register: input.register,
        unregister: input.unregister,
        snapshot: input.list,
        subscribe: noSubscription,
    });
    const clear = () => {
        for (const id of input.listIds()) input.unregister(id);
    };
    const capture = () =>
        captureDifferentialSurface({
            fixture: input.fixture,
            adapter: adapter(),
            getId: (value) => value.id,
            projectValue: (value) => ({
                id: value.id,
                order: value.order ?? 200,
                reactive: isReactive(value),
                callerIdentity: toRaw(value) === lastSources.get(value.id),
                nestedIdentity:
                    toRaw(input.nestedIdentity(value)) ===
                    input.nestedIdentity(lastSources.get(value.id)!),
            }),
        });

    select(false);
    clear();
    const expected = capture();
    clear();
    select(true);
    clear();
    const actual = capture();
    clear();
    select(false);
    expect(compareDifferentialSurfaces(expected, actual)).toEqual([]);
    expect(actual.projectedIds).toEqual(['early', 'a', 'z']);
    expect(actual.registerReturns.every((value) => value.kind === 'undefined')).toBe(
        true
    );
    expect(
        actual.projectedValues.every(
            (value) =>
                (value as { reactive: boolean; callerIdentity: boolean; nestedIdentity: boolean })
                    .reactive &&
                (value as { callerIdentity: boolean }).callerIdentity &&
                (value as { nestedIdentity: boolean }).nestedIdentity
        )
    ).toBe(true);
}

describe('editor extension contribution adapters', () => {
    it('matches node, mark, and generic identity, replacement, ordering, IDs, and returns', () => {
        requireCompatibilityProfile(profiles, 'registry.editor-extensions');
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        const createFixture = <T extends EditorNode | EditorMark | EditorExtension>(
            nestedKey: 'extension'
        ): DifferentialSurfaceFixture<T> => ({
            profileId: 'registry.editor-extensions',
            registrations: [
                { id: 'z', [nestedKey]: { name: 'old' } },
                { id: 'a', [nestedKey]: { name: 'a' } },
                { id: 'z', [nestedKey]: { name: 'replacement' } },
                { id: 'early', order: 100, [nestedKey]: { name: 'early' } },
            ] as unknown as T[],
            unregisterIds: ['missing'],
        });

        compareFamily<EditorNode>({
            fixture: createFixture<EditorNode>('extension'),
            register: registerEditorNode,
            unregister: unregisterEditorNode,
            list: listEditorNodes,
            listIds: listRegisteredEditorNodeIds,
            nestedIdentity: (value) => value.extension,
        });
        compareFamily<EditorMark>({
            fixture: createFixture<EditorMark>('extension'),
            register: registerEditorMark,
            unregister: unregisterEditorMark,
            list: listEditorMarks,
            listIds: listRegisteredEditorMarkIds,
            nestedIdentity: (value) => value.extension,
        });
        compareFamily<EditorExtension>({
            fixture: createFixture<EditorExtension>('extension'),
            register: registerEditorExtension,
            unregister: unregisterEditorExtension,
            list: listEditorExtensions,
            listIds: listRegisteredEditorExtensionIds,
            nestedIdentity: (value) => value.extension,
        });

        consoleWarn.mockRestore();
    });

    it.each([false, true])(
        'preserves eager precedence and warn-skip-continue loading when V2 selection is %s',
        async (enabled) => {
            select(enabled);
            for (const id of listRegisteredEditorExtensionIds()) {
                unregisterEditorExtension(id);
            }
            const eager = { name: 'Eager' };
            const recovered = { name: 'Recovered' };
            const unusedFactory = vi.fn(async () => ({ name: 'Unused' } as never));
            const calls: string[] = [];
            registerEditorExtension({
                id: 'eager',
                extension: eager as never,
                factory: unusedFactory,
            });
            registerEditorExtension({
                id: 'failure',
                factory: async () => {
                    calls.push('failure');
                    throw new Error('failure');
                },
            });
            registerEditorExtension({
                id: 'recovered',
                factory: async () => {
                    calls.push('recovered');
                    return recovered as never;
                },
            });
            const consoleWarn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            const loaded = await loadEditorExtensions(
                [],
                [],
                listEditorExtensions()
            );

            expect(loaded.extensions).toEqual([eager, recovered]);
            expect(calls).toEqual(['failure', 'recovered']);
            expect(unusedFactory).not.toHaveBeenCalled();
            expect(consoleWarn).toHaveBeenCalledTimes(1);
            consoleWarn.mockRestore();
            for (const id of listRegisteredEditorExtensionIds()) {
                unregisterEditorExtension(id);
            }
            select(false);
        }
    );
});
