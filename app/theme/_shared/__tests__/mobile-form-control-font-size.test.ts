import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import blankAppConfig from '../../blank/app.config';
import retroAppConfig from '../../retro/app.config';

const MOBILE_FONT_CLASS = 'max-lg:text-[16px]!';
const THEME_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);

describe('mobile form-control font-size contract', () => {
    it.each([
        ['blank', blankAppConfig],
        ['retro', retroAppConfig],
    ] as const)('%s config keeps Nuxt UI editable controls mobile-safe', (_name, config) => {
        expect(config.ui.input.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(config.ui.textarea.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(config.ui.select.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(config.ui.selectMenu.slots.base).toContain(MOBILE_FONT_CLASS);
        expect(config.ui.selectMenu.slots.input).toContain(MOBILE_FONT_CLASS);
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
            expect(css).toContain('font-size: 16px !important');
            expect(css).not.toContain('input[type="file"]');
        }
    );
});
