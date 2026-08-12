import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import blankTheme from '../../blank/theme';
import retroTheme from '../../retro/theme';

const MOBILE_FONT_CLASS = 'max-lg:text-[16px]!';
const THEME_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const blankUi = blankTheme.ui as any;
const retroUi = retroTheme.ui as any;

describe('mobile form-control font-size contract', () => {
    it.each([
        ['blank', blankUi],
        ['retro', retroUi],
    ] as const)('%s theme keeps Nuxt UI editable controls mobile-safe', (_name, ui) => {
        expect(ui.input.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(ui.textarea.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(ui.select.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(ui.selectMenu.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(ui.selectMenu.slots.input).toContain(MOBILE_FONT_CLASS);
    });

    it.each(['blank', 'retro'] as const)(
        '%s stylesheet enforces the native and contenteditable safety floor',
        (themeName) => {
            const css = readFileSync(
                resolve(THEME_ROOT, themeName, 'styles.css'),
                'utf8'
            );

            expect(css).toContain('(hover: none) and (pointer: coarse)');
            expect(css).toContain('(max-width: 47.999rem)');
            expect(css).toContain(`html[data-theme="${themeName}"]`);
            expect(css).toContain('input[type="search"]');
            expect(css).toContain('input[type="password"]');
            expect(css).toContain('textarea');
            expect(css).toContain('select');
            expect(css).toContain(
                '[contenteditable]:not([contenteditable="false"])'
            );
            if (themeName === 'blank') {
                expect(css).toContain('--blank-mobile-input-text: 16px');
                expect(css).toContain(
                    'font-size: var(--blank-mobile-input-text) !important'
                );
            } else {
                expect(css).toContain('font-size: 16px !important');
            }
            expect(css).not.toContain('input[type="file"]');
        }
    );
});
