import { beforeEach, describe, expect, it } from 'vitest';
import {
    __resetPaletteRegistryForTests,
    getPaletteAliasMap,
    listPaletteCategories,
    listPaletteCommands,
    listPalettePostSourceDefinitions,
    listPaletteSources,
    registerPaletteCommand,
    registerPalettePostSourceDefinition,
    registerPaletteSource,
} from '../registry';
import { registerPluginPostSource } from '../sources/register-core';
import type { PaletteSearchSource } from '../types';
import { CORE_PALETTE_CATEGORIES } from '../types';

function makeSource(
    overrides: Partial<PaletteSearchSource> & { id: string }
): PaletteSearchSource {
    const category =
        CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat') ??
        CORE_PALETTE_CATEGORIES[0]!;
    return {
        label: overrides.label ?? overrides.id,
        category,
        order: 100,
        load: async () => [],
        ...overrides,
    };
}

describe('palette registry', () => {
    beforeEach(() => {
        __resetPaletteRegistryForTests();
    });

    it('registers core aliases by default', () => {
        const map = getPaletteAliasMap();
        expect(map.get('chat')).toBe('chat');
        expect(map.get('doc')).toBe('document');
        expect(map.get('command')).toBe('command');
        expect(listPaletteCategories()).toEqual([]);
    });

    it('registers and sorts commands by order then id', () => {
        registerPaletteCommand(
            { id: 'b-cmd', label: 'B', order: 10 },
            () => ({ ok: true })
        );
        registerPaletteCommand(
            { id: 'a-cmd', label: 'A', order: 10 },
            () => ({ ok: true })
        );
        registerPaletteCommand(
            { id: 'z-cmd', label: 'Z', order: 1 },
            () => ({ ok: true })
        );
        expect(listPaletteCommands().map((c) => c.id)).toEqual([
            'z-cmd',
            'a-cmd',
            'b-cmd',
        ]);
        expect(listPaletteCategories().map((category) => category.id)).toEqual([
            'command',
        ]);
    });

    it('exact-owner dispose leaves newer registration intact', () => {
        const first = registerPaletteCommand(
            { id: 'new-chat', label: 'First' },
            () => ({ ok: true })
        );
        const second = registerPaletteCommand(
            { id: 'new-chat', label: 'Second' },
            () => ({ ok: true })
        );
        expect(listPaletteCommands()[0]?.label).toBe('Second');
        expect(first.dispose()).toBe(false);
        expect(listPaletteCommands()[0]?.label).toBe('Second');
        expect(second.dispose()).toBe(true);
        expect(listPaletteCommands()).toHaveLength(0);
    });

    it('rejects conflicting aliases without changing the owner', () => {
        registerPaletteSource(makeSource({ id: 'chat-core' }));
        const before = getPaletteAliasMap().get('chat');
        expect(() =>
            registerPalettePostSourceDefinition(
                {
                    id: 'plugin-chat',
                    label: 'Plugin Chat',
                    postType: 'plugin-chat',
                    categoryId: 'plugin-chat',
                    filterAliases: ['chat'],
                    openTarget: { kind: 'pane-app', appId: 'plugin-chat' },
                },
                { pluginId: 'example' }
            )
        ).toThrow(/already owned/);
        expect(getPaletteAliasMap().get('chat')).toBe(before);
    });

    it('registers post source aliases for custom categories', () => {
        const handle = registerPalettePostSourceDefinition(
            {
                id: 'todo-source',
                label: 'Todos',
                postType: 'example-todo',
                categoryId: 'todo',
                filterAliases: ['todo'],
                openTarget: { kind: 'pane-app', appId: 'example-todo' },
            },
            { pluginId: 'todo-plugin' }
        );
        expect(getPaletteAliasMap().get('todo')).toBe('todo');
        handle.dispose();
        expect(getPaletteAliasMap().has('todo')).toBe(false);
    });

    it('transfers aliases cleanly when a post source is replaced', () => {
        const first = registerPalettePostSourceDefinition(
            {
                id: 'todo-source',
                label: 'Todos',
                postType: 'example-todo',
                categoryId: 'todo',
                filterAliases: ['todo'],
                openTarget: { kind: 'pane-app', appId: 'example-todo' },
            },
            { pluginId: 'todo-plugin', pluginGeneration: 1 }
        );
        const second = registerPalettePostSourceDefinition(
            {
                id: 'todo-source',
                label: 'Tasks',
                postType: 'example-todo',
                categoryId: 'todo',
                filterAliases: ['task'],
                openTarget: { kind: 'pane-app', appId: 'example-todo' },
            },
            { pluginId: 'todo-plugin', pluginGeneration: 2 }
        );

        expect(getPaletteAliasMap().has('todo')).toBe(false);
        expect(getPaletteAliasMap().get('task')).toBe('todo');
        expect(first.dispose()).toBe(false);
        expect(second.dispose()).toBe(true);
        expect(getPaletteAliasMap().has('task')).toBe(false);
    });

    it('protects core and cross-plugin contribution identities', () => {
        registerPaletteCommand(
            { id: 'new-chat', label: 'Core new chat' },
            () => ({ ok: true })
        );
        expect(() =>
            registerPaletteCommand(
                { id: 'new-chat', label: 'Hijacked' },
                () => ({ ok: true }),
                { pluginId: 'evil-plugin' }
            )
        ).toThrow(/reserved/);
        expect(listPaletteCommands()[0]?.label).toBe('Core new chat');

        registerPaletteCommand(
            { id: 'plugin-command', label: 'Owner A' },
            () => ({ ok: true }),
            { pluginId: 'plugin-a' }
        );
        expect(() =>
            registerPaletteCommand(
                { id: 'plugin-command', label: 'Owner B' },
                () => ({ ok: true }),
                { pluginId: 'plugin-b' }
            )
        ).toThrow(/already owned/);
        expect(
            listPaletteCommands().find((command) => command.id === 'plugin-command')
                ?.label
        ).toBe('Owner A');

        expect(() =>
            registerPaletteSource(
                makeSource({ id: 'chat', pluginId: 'evil-plugin' })
            )
        ).toThrow(/reserved/);
        expect(() =>
            registerPaletteSource(
                makeSource({ id: 'workspace-tab', pluginId: 'evil-plugin' })
            )
        ).toThrow(/reserved/);
    });

    it('does not expose inaccessible sources, commands, aliases, or categories', () => {
        const access = { requiredEntitlements: ['palette-secret'] };
        registerPaletteCommand(
            {
                id: 'secret-command',
                label: 'Secret command',
                access,
            },
            () => ({ ok: true }),
            { pluginId: 'secret-plugin' }
        );
        registerPalettePostSourceDefinition(
            {
                id: 'secret-source',
                label: 'Secrets',
                postType: 'secret-post',
                categoryId: 'secret',
                filterAliases: ['secret'],
                access,
                openTarget: { kind: 'pane-app', appId: 'secret-app' },
            },
            { pluginId: 'secret-plugin' }
        );
        registerPaletteSource(
            makeSource({
                id: 'secret-source',
                pluginId: 'secret-plugin',
                access,
                category: {
                    id: 'secret',
                    label: 'Secrets',
                    aliases: ['secret'],
                    order: 100,
                },
            })
        );

        expect(listPaletteCommands().some((item) => item.id === 'secret-command'))
            .toBe(false);
        expect(listPaletteSources().some((item) => item.id === 'secret-source'))
            .toBe(false);
        expect(getPaletteAliasMap().has('secret')).toBe(false);
        expect(listPaletteCategories().some((item) => item.id === 'secret'))
            .toBe(false);
    });

    it('rolls back aliases and definitions when live source registration fails', () => {
        expect(() =>
            registerPluginPostSource({
                definition: {
                    id: 'chat',
                    label: 'Bad source',
                    postType: 'bad-source',
                    categoryId: 'bad-source',
                    filterAliases: ['bad-source'],
                    openTarget: { kind: 'pane-app', appId: 'bad-source' },
                },
                pluginId: 'bad-plugin',
            })
        ).toThrow(/reserved/);
        expect(getPaletteAliasMap().has('bad-source')).toBe(false);
        expect(
            listPalettePostSourceDefinitions().some(
                (definition) => definition.id === 'chat'
            )
        ).toBe(false);
    });
});
