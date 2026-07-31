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

    it('rejects invalid colors', () => {
        const result = validateThemeDefinition(createTheme('not-a-color-value'));
        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.code === 'THEME_005')).toBe(true);
    });
});

describe('validateThemeDefinition safe declarative values', () => {
    it('rejects external stylesheets and declaration injection', () => {
        const theme = createTheme('#3366ff');
        theme.stylesheets = ['https://cdn.example/theme.css'];
        theme.overrides = {
            button: { style: { color: 'red; background: url(https://evil.test/x)' } },
        };

        const result = validateThemeDefinition(theme);
        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.code)).toEqual(
            expect.arrayContaining(['THEME_017', 'THEME_019'])
        );
    });

    it('warns for a legacy component override and rejects incompatible contracts', () => {
        const legacy = createTheme('#3366ff');
        legacy.customComponents = { 'chat-input': './components/Input.vue' };
        expect(validateThemeDefinition(legacy).warnings).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'THEME_020' })])
        );

        const incompatible = {
            ...legacy,
            componentContractVersion: 2,
        } as unknown as Parameters<typeof validateThemeDefinition>[0];
        expect(validateThemeDefinition(incompatible).errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'THEME_021' })])
        );
    });

    it('rejects event handlers in override props', () => {
        const theme = createTheme('#3366ff');
        theme.overrides = {
            button: { onClick: 'javascript:alert(1)' },
        };
        expect(validateThemeDefinition(theme).errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'THEME_022' })])
        );
    });
});
