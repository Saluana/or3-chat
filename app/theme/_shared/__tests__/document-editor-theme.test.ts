import { describe, expect, it } from 'vitest';
import { DEFAULT_ICONS, type IconToken } from '~/config/icon-tokens';
import blankIcons from '../../blank/icons.config';
import blankAppConfig from '../../blank/app.config';
import retroAppConfig from '../../retro/app.config';
import { documentsStyles as blankDocumentStyles } from '../../blank/styles/documents';
import { documentsStyles as retroDocumentStyles } from '../../retro/styles/documents';

const editorIconTokens = [
    'editor.document',
    'editor.search',
    'editor.inspector',
    'editor.ai',
    'editor.outline',
    'editor.history',
    'editor.format.bold',
    'editor.format.italic',
    'editor.format.underline',
    'editor.format.bullet-list',
    'editor.insert.code-block',
    'editor.insert.table',
    'editor.insert.image',
] as const satisfies readonly IconToken[];

describe('document editor theme contract', () => {
    it('publishes semantic defaults and blank-theme overrides for editor chrome', () => {
        for (const token of editorIconTokens) {
            expect(DEFAULT_ICONS[token]).toBeTruthy();
            expect(blankIcons[token]).toBeTruthy();
        }
    });

    it.each([
        ['blank', blankDocumentStyles],
        ['retro', retroDocumentStyles],
    ])('%s theme targets the current premium editor surfaces', (_name, styles) => {
        expect(styles).toHaveProperty('.document-editor-root');
        expect(styles).toHaveProperty('.document-editor-root .editor-topbar');
        expect(styles).toHaveProperty('.document-editor-root .document-editor-toolbar');
        expect(styles).toHaveProperty('.document-editor-root .document-inspector');
        expect(styles).toHaveProperty('.document-editor-root .document-ai-composer');
        expect(styles).toHaveProperty('.document-editor-root .selection-menu');
        expect(styles).toHaveProperty('.document-editor-root .slash-menu');
    });

    it.each([
        ['blank', blankAppConfig],
        ['retro', retroAppConfig],
    ])('%s theme styles the Nuxt UI controls used by the editor', (_name, config) => {
        expect(config.ui).toHaveProperty('button');
        expect(config.ui).toHaveProperty('input');
        expect(config.ui).toHaveProperty('textarea');
        expect(config.ui).toHaveProperty('select');
        expect(config.ui).toHaveProperty('selectMenu');
        expect(config.ui).toHaveProperty('tabs');
        expect(config.ui).toHaveProperty('card');
    });

    it.each([
        ['blank', blankAppConfig],
        ['retro', retroAppConfig],
    ])('%s theme keeps pill and link tabs visually distinct', (_name, config) => {
        const variants = config.ui.tabs.variants.variant;
        expect(variants.pill.list).toContain('bg-[var(--md-surface-container-low)]');
        expect(variants.link.list).toContain('bg-transparent');
        expect(variants.link.list).not.toContain('surface-container');
    });

    it.each([
        ['blank', blankAppConfig],
        ['retro', retroAppConfig],
    ])('%s theme centers square Nuxt UI buttons', (_name, config) => {
        expect(config.ui.button.variants.square.true).toContain('justify-center');
    });
});
