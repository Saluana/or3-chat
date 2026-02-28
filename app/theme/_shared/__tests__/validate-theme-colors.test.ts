import { describe, expect, it } from 'vitest';
import { validateThemeDefinition } from '../validate-theme';
import type { ThemeDefinition } from '../types';

function createTheme(primary: string): ThemeDefinition {
    return {
        name: 'test-theme',
        colors: {
            primary,
            secondary: '#334455',
            surface: '#ffffff',
        },
    };
}

describe('validateThemeDefinition color validation', () => {
    it('accepts valid colors', () => {
        const result = validateThemeDefinition(createTheme('rgb(10 20 30 / 40%)'));
        expect(result.warnings.find((w) => w.code === 'THEME_005')).toBeUndefined();
    });

    it('warns on invalid colors', () => {
        const result = validateThemeDefinition(createTheme('not-a-color-value'));
        expect(result.warnings.some((w) => w.code === 'THEME_005')).toBe(true);
    });
});
