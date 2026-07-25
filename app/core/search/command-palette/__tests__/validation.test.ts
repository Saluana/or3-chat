import { describe, expect, it } from 'vitest';
import {
    validatePaletteAlias,
    validatePaletteCommandDefinition,
    validatePalettePostSourceDefinition,
    validatePostType,
} from '../validation';

describe('palette validation', () => {
    it('accepts valid aliases and rejects short/invalid ones', () => {
        expect(validatePaletteAlias('chat').ok).toBe(true);
        expect(validatePaletteAlias('a').ok).toBe(false);
        expect(validatePaletteAlias('Bad_Alias').ok).toBe(false);
    });

    it('rejects internal revision post types', () => {
        expect(validatePostType('or3:document-revision').ok).toBe(false);
        expect(validatePostType('example-todo').ok).toBe(true);
    });

    it('validates post source definitions', () => {
        const valid = validatePalettePostSourceDefinition({
            id: 'todo-source',
            label: 'Todos',
            postType: 'example-todo',
            categoryId: 'todo',
            filterAliases: ['todo'],
            metaKeys: ['completed'],
            openTarget: { kind: 'pane-app', appId: 'example-todo' },
        });
        expect(valid.ok).toBe(true);

        expect(
            validatePalettePostSourceDefinition({
                id: 'settings-source',
                label: 'Settings',
                postType: 'plugin-settings',
                categoryId: 'setting',
                filterAliases: ['setting'],
                openTarget: {
                    kind: 'dashboard',
                    pluginId: 'core:settings',
                    pageId: 'theme-settings',
                },
            }).ok
        ).toBe(true);

        const tooManyMeta = validatePalettePostSourceDefinition({
            id: 'todo-source',
            label: 'Todos',
            postType: 'example-todo',
            categoryId: 'todo',
            filterAliases: ['todo'],
            metaKeys: Array.from({ length: 17 }, (_, i) => `k${i}`),
            openTarget: { kind: 'pane-app', appId: 'example-todo' },
        });
        expect(tooManyMeta.ok).toBe(false);
    });

    it('validates command definitions', () => {
        expect(
            validatePaletteCommandDefinition({
                id: 'new-chat',
                label: 'New chat',
            }).ok
        ).toBe(true);
        expect(
            validatePaletteCommandDefinition({
                id: 'Bad',
                label: 'X',
            }).ok
        ).toBe(false);
    });
});
