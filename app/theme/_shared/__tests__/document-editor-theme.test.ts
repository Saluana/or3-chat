import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ICONS, type IconToken } from '~/config/icon-tokens';
import blankIcons from '../../blank/icons.config';
import blankTheme from '../../blank/theme';
import { documentsStyles as blankDocumentStyles } from '../../blank/styles/documents';
import { documentsStyles as retroDocumentStyles } from '../../retro/styles/documents';
import retroTheme from '../../retro/theme';

const THEME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const blankUi = blankTheme.ui as any;
const retroUi = retroTheme.ui as any;

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
        expect(styles).toHaveProperty('.document-editor-root .setting-card');
        expect(styles).toHaveProperty('.document-editor-root .quick-action-row');
        expect(styles).toHaveProperty('.document-editor-root .revision-item');
    });

    it('retro document surfaces use shared border tokens', () => {
        const composer = retroDocumentStyles['.document-editor-root .document-ai-composer']?.style;
        const settingCard = retroDocumentStyles['.document-editor-root .setting-card']?.style;
        const revisionItem = retroDocumentStyles['.document-editor-root .revision-item']?.style;

        expect(composer?.border).toContain('var(--md-border-width)');
        expect(composer?.borderRadius).toBe('var(--md-border-radius)');
        expect(settingCard?.border).toContain('var(--md-border-width)');
        expect(settingCard?.borderRadius).toBe('var(--md-border-radius)');
        expect(revisionItem?.border).toContain('var(--md-border-width)');
        expect(revisionItem?.borderRadius).toBe('var(--md-border-radius)');
    });

    it('blank document AI composer shares the chat composer radius token', () => {
        const composer = blankDocumentStyles['.document-editor-root .document-ai-composer']?.style;
        expect(composer?.borderRadius).toBe('var(--chat-composer-border-radius, 28px)');
    });

    it('blank document inspector uses the standard theme border tokens', () => {
        const inspector = blankDocumentStyles['.document-editor-root .document-inspector']?.style;
        expect(inspector?.borderLeft).toBe(
            'var(--md-border-width) solid color-mix(in srgb, var(--md-border-color) 70%, transparent)'
        );
    });

    it('blank document editor does not draw a focus border around the writing canvas', () => {
        const editor =
            blankDocumentStyles[
                '.document-editor-root .document-content .ProseMirror:focus-visible'
            ]?.style;
        expect(editor?.outline).toBe('none');
    });

    it('retro polishes the document formatting toolbar without touching blank', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');
        const cyberpunkCssPath = resolve(THEME_ROOT, 'cyberpunk', 'styles.css');
        let cyberpunkCss = '';
        try {
            cyberpunkCss = readFileSync(cyberpunkCssPath, 'utf8');
        } catch {
            cyberpunkCss = '';
        }

        expect(retroCss).toContain('Document formatting toolbar — retro polish only');
        expect(retroCss).toContain('--doc-tb-size: 36px');
        expect(retroCss).toContain('--doc-tb-gap: 4px');
        expect(retroCss).toContain('--doc-tb-group: 11px');
        expect(retroCss).toContain('--doc-tb-shadow-idle:');
        expect(retroCss).toContain('--doc-tb-shadow-hover:');
        expect(retroCss).toContain('--doc-tb-shadow-room: 3px');
        expect(retroCss).toContain('padding-block: var(--doc-tb-shadow-room)');
        expect(retroCss).toContain('min-height: 52px');
        expect(retroCss).toContain('.editor-toolbar--compact');
        expect(retroCss).toContain('.workflow-app .workflow-toolbar');
        expect(retroCss).toContain('.workflow-toolbar--compact');
        expect(retroCss).toContain('.workflow-toolbar--mobile');
        expect(retroCss).toContain('.workflow-validation-status');
        expect(retroCss).toContain('.workflow-run-button');
        expect(retroCss).toContain('display: inline-flex !important');
        expect(retroCss).toContain('white-space: nowrap');
        expect(retroCss).toContain('--doc-tb-size: 34px');
        expect(retroCss).toContain('--doc-tb-gap: 3px');
        expect(retroCss).toContain('min-height: 50px');
        expect(retroCss).toContain('.more-button');
        expect(retroCss).toContain('.inspector-toggle-button');
        expect(retroCss).toContain(
            '.outline-item.active .outline-marker'
        );
        expect(retroCss).toContain('color: var(--md-on-primary) !important');
        expect(retroCss).toContain('.selection-menu button.active');
        expect(retroCss).toContain('.revision-icon');
        expect(retroCss).toContain('.inspector-tabs');
        expect(retroCss).toContain("html[data-theme='retro'].dark");
        expect(retroCss).toContain('--doc-tb-ink: var(--md-on-surface)');
        expect(retroCss).toContain(
            '.document-content\n\t:is(h1, h2, h3, h4)'
        );

        expect(blankCss).not.toContain('Document formatting toolbar — retro polish only');
        expect(blankCss).not.toContain('--doc-tb-size');
        expect(blankCss).not.toContain(
            '.outline-item.active .outline-marker'
        );
        expect(blankCss).not.toContain('.revision-icon');
        expect(cyberpunkCss).not.toContain('--doc-tb-size');
        expect(cyberpunkCss).not.toContain(
            '.outline-item.active .outline-marker'
        );

        // Dark primary must stay lighter than the old #2C638B face-on-navy value.
        expect(retroTheme.colors.dark?.primary).toBe('#5BA3D4');
        expect(retroTheme.colors.dark?.primaryTint).toBe('#8EC4E8');
        expect(retroTheme.colors.dark?.error).toBe('#FF8A8A');
        expect(retroTheme.colors.warning).toBe('#9A4D00');
        expect(retroTheme.colors.dark?.warning).toBe('#FFB86A');
        expect(retroTheme.borderWidthSubtle).toBe('1px');
        expect(retroTheme.borderWidthStrong).toBe('2px');
        expect(retroCss).toContain('.settings-overlay');
        expect(retroCss).toContain("button[aria-label^='Remove']");
        expect(blankCss).not.toContain('.settings-overlay .quick-action-number');
        expect(blankDocumentStyles).not.toHaveProperty(
            '.document-editor-root .editor-toolbar--compact'
        );
        expect(
            retroDocumentStyles['.document-editor-root .document-editor-toolbar']
                ?.style?.boxShadow
        ).toBe('none');
    });

    it('retro polishes the mobile More sheet without touching blank', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');

        expect(retroCss).toContain('Mobile More sheet');
        expect(retroCss).toContain('--more-radius: 3px');
        expect(retroCss).toContain('--more-icon: 1.85rem');
        expect(retroCss).toContain('--more-shadow-card: 3px 3px 0');
        expect(retroCss).toContain('--more-card-face:');
        expect(retroCss).toContain('border-radius: 6px 6px 0 0');
        expect(retroCss).toContain('.more-status-badge::before');
        expect(retroCss).toContain('repeating-linear-gradient');
        expect(retroCss).toContain('.mobile-nav-more-auth .more-row');
        expect(blankCss).not.toContain('Mobile More sheet');
        expect(blankCss).not.toContain('--more-radius');
        expect(blankCss).not.toContain('--more-shadow-card');
    });

    it('retro polishes the agent connections modal without touching blank', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');

        expect(retroCss).toContain('Agent connections modal');
        expect(retroCss).toContain('--agent-conn-radius: 3px');
        expect(retroCss).toContain('--agent-conn-header: var(--md-primary)');
        expect(retroCss).toContain('.agent-conn-badge--active');
        expect(retroCss).toContain('.agent-conn-badge--locked');
        expect(retroCss).toContain('.agent-conn-host--selected');
        expect(retroCss).toContain('inset 3px 0 0 var(--md-primary)');
        expect(retroCss).toContain('.agent-conn-host-list');
        expect(retroCss).toContain(
            "/* One border on the Nuxt UI base slot — never stack on the inner input */"
        );
        expect(retroCss).toContain('.agent-conn-icon-tile');
        expect(retroCss).toContain('.agent-conn-forget');
        expect(retroCss).toContain('.agent-conn-unlock');
        expect(retroCss).toContain('.agent-conn-remote-title');
        expect(retroCss).toContain('Agent connections — dark mode');
        expect(retroCss).toContain('--agent-conn-page: #1d232b');
        expect(retroCss).toContain('--agent-conn-header: #2c638b');
        expect(retroCss).toContain('--agent-conn-shadow: 2px 2px 0 #080a0d');
        expect(retroCss).toContain('--agent-conn-input-bg: #2a3340');
        expect(retroCss).toContain('--agent-conn-btn-hover:');
        expect(blankCss).not.toContain('--agent-conn-radius: 3px');
        expect(blankCss).not.toContain('--agent-conn-page: #1d232b');
        expect(blankCss).not.toContain('Agent connections — dark mode');
    });

    it('retro lifts dark agent unlock prompts off near-black wells', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');

        expect(retroCss).toContain('Agent unlock prompts — retro dark');
        expect(retroCss).toContain('--agent-unlock-raised: #222a34');
        expect(retroCss).toContain("[data-testid='external-agent-recovery']");
        expect(retroCss).toContain('.agent-connection-notice');
        expect(blankCss).not.toContain('Agent unlock prompts — retro dark');
        expect(blankCss).not.toContain('--agent-unlock-raised: #222a34');
    });

    it('retro keeps home sidebar item offset shadows from being clipped by Or3Scroll', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');

        expect(retroCss).toContain(
            ".sidebar-scroll.or3-scroll .or3-scroll-item {\n\toverflow: visible;"
        );
        expect(retroCss).toContain('display: flow-root;');
        expect(retroCss).toContain('margin-right: 3px;');
        expect(retroCss).toContain(
            '.sidebar-scroll.or3-scroll .or3-scroll-item:hover'
        );
        expect(blankCss).not.toContain(
            '.sidebar-scroll.or3-scroll .or3-scroll-item'
        );
    });

    it('blank polishes the agent connections modal without touching retro hard-edge', () => {
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');

        expect(blankCss).toContain('Agent connections modal (teleported) — blank polish');
        expect(blankCss).toContain('--agent-conn-radius: 12px');
        expect(blankCss).toContain('--agent-conn-radius-md: 9px');
        expect(blankCss).toContain('--agent-conn-sidebar: #f2f4f7');
        expect(blankCss).toContain('--agent-conn-selected:');
        expect(blankCss).toContain('--agent-conn-btn: #2a2a2e');
        expect(blankCss).toContain('--agent-conn-hover: #ffffff');
        expect(blankCss).toContain('--agent-conn-selected: #e4e9ef');
        expect(blankCss).toContain('.agent-conn-host--selected');
        expect(blankCss).toContain('inset 2px 0 0');
        expect(blankCss).toContain('.agent-conn-badge--locked');
        expect(blankCss).toContain('.agent-conn-forget');
        expect(blankCss).toContain('Override blank\'s global rounded-full buttons');
        expect(blankCss).toContain('Agent connections — blank dark mode');
        expect(blankCss).toContain('--agent-conn-page: #212121');
        expect(blankCss).toContain('--agent-conn-sidebar: #191919');
        expect(blankCss).toContain('--agent-conn-btn: #ececec');
        expect(blankCss).toContain('Agent unlock prompts');
        expect(blankCss).toContain('--md-surface-container-lowest: #1c1c1c');
        expect(blankCss).toContain('--md-surface-container-low: #2a2a2a');
        expect(blankCss).toContain('.agent-connection-notice');
        expect(blankCss).toContain("[data-testid='external-agent-recovery']");
        expect(retroCss).not.toContain('blank polish');
        expect(retroCss).not.toContain('--agent-conn-radius: 12px');
        expect(retroCss).not.toContain('--agent-conn-btn: #2a2a2e');
        expect(retroCss).not.toContain('Agent connections — blank dark mode');
        expect(retroCss).not.toContain('--md-surface-container-lowest: #1c1c1c');
    });

    it('retro densifies the mobile open-tabs switcher without touching blank', () => {
        const retroCss = readFileSync(resolve(THEME_ROOT, 'retro', 'styles.css'), 'utf8');
        const blankCss = readFileSync(resolve(THEME_ROOT, 'blank', 'styles.css'), 'utf8');
        const retroShell = readFileSync(
            resolve(THEME_ROOT, 'retro', 'styles', 'shell.ts'),
            'utf8'
        );

        expect(retroCss).toContain('list-row composition');
        expect(retroCss).toContain('--tab-switcher-radius: 3px');
        expect(retroCss).toContain('--tab-switcher-row-h: 4.25rem');
        expect(retroCss).toContain('height: 44px !important');
        expect(retroCss).toContain('grid-template-columns: 1.4fr 0.8fr');
        expect(retroCss).toContain('gap: 0.65rem !important; /* ~10–11px */');
        expect(retroCss).toContain('gap: 0.75rem !important; /* 12px */');
        expect(retroCss).toContain('width: 1.5rem !important; /* 24px */');
        expect(retroCss).toContain('border-left-color: var(--md-primary)');
        expect(retroCss).toContain('Quiet X');
        expect(retroCss).toContain(
            '.workspace-tab-switcher-option-opened {\n\t\tdisplay: none !important;'
        );
        expect(retroCss).toContain('Open tabs switcher — dark mode hierarchy');
        expect(retroCss).toContain('--ts-page: #101418');
        expect(retroCss).toContain('--ts-raised: #222a34');
        expect(retroCss).toContain('--ts-new: #2a3340');
        expect(retroCss).toContain('--ts-sort: #d2d8e0');
        expect(retroCss).toContain('--ts-border: #3a4656');
        expect(retroCss).toContain('--ts-border-muted: #2f3a48');
        expect(retroCss).toContain('--ts-shadow: 2px 2px 0 #080a0d');
        expect(retroCss).toContain('--ts-done:');
        expect(retroCss).toContain('--ts-done-hover:');
        expect(retroCss).toContain('border-left-width: 4px');
        expect(retroShell).toContain("'input#shell.tab-switcher-search'");
        expect(retroShell).toContain("variant: 'ghost'");
        expect(blankCss).not.toContain('list-row composition');
        expect(blankCss).not.toContain('--tab-switcher-row-h');
        expect(blankCss).not.toContain('Quiet X');
        expect(blankCss).not.toContain('Open tabs switcher — dark mode hierarchy');
    });

    it('retro keeps chrome pixel fonts but uses a readable stack for the writing canvas', () => {
        const root = retroDocumentStyles['.document-editor-root']?.style;
        const canvas = retroDocumentStyles['.document-editor-root .document-canvas']?.style;
        const content = retroDocumentStyles['.document-editor-root .document-content']?.style;
        const title = retroDocumentStyles['.document-editor-root .document-title-field textarea']?.style;

        expect(root?.fontFamily).toBe('var(--font-sans)');
        expect(canvas?.fontFamily).toContain('IBM Plex Sans');
        expect(content?.fontFamily).toContain('IBM Plex Sans');
        expect(title?.fontFamily).toContain('IBM Plex Sans');
        expect(content?.fontFamily).not.toContain('VT323');
    });

    it.each([
        ['blank', blankUi],
        ['retro', retroUi],
    ])('%s theme styles the Nuxt UI controls used by the editor', (_name, ui) => {
        expect(ui).toHaveProperty('button');
        expect(ui).toHaveProperty('input');
        expect(ui).toHaveProperty('textarea');
        expect(ui).toHaveProperty('select');
        expect(ui).toHaveProperty('selectMenu');
        expect(ui).toHaveProperty('tabs');
        expect(ui).toHaveProperty('card');
    });

    it('retro modal titles use a readable face and truncate instead of wrapping awkwardly', () => {
        const title = retroUi.modal.slots.title;
        expect(title).toContain('font-vt323');
        expect(title).toContain('truncate');
        expect(title).toContain('min-w-0');
        expect(title).not.toContain('text-lg!');
    });

    it.each([
        ['blank', blankUi],
        ['retro', retroUi],
    ])('%s theme keeps pill and link tabs visually distinct', (_name, ui) => {
        const variants = ui.tabs.variants.variant;
        expect(variants.pill.list).toContain('bg-[var(--md-surface-container-low)]');
        expect(variants.link.list).toContain('bg-transparent');
        expect(variants.link.list).not.toContain('surface-container');
    });

    it.each([
        ['blank', blankUi],
        ['retro', retroUi],
    ])('%s theme centers square Nuxt UI buttons', (_name, ui) => {
        expect(ui.button.variants.square.true).toContain('justify-center');
    });
});
