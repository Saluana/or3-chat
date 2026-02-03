import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateThemeDefinition } from '../validate-theme';

const baseTheme = {
    name: 'test',
    colors: {
        primary: '#000000',
        secondary: '#ffffff',
        surface: '#f5f5f5',
    },
};

describe('validateThemeDefinition color validation', () => {
    const originalCSS = globalThis.CSS;

    afterEach(() => {
        (globalThis as any).CSS = originalCSS;
        vi.restoreAllMocks();
    });

    it('uses CSS.supports when available', () => {
        (globalThis as any).CSS = {
            supports: vi.fn((prop: string, value: string) => {
                if (prop !== 'color') return false;
                return value === 'rebeccapurple';
            }),
        };

        const result = validateThemeDefinition({
            ...baseTheme,
            colors: {
                ...baseTheme.colors,
                primary: 'rebeccapurple',
                secondary: 'not-a-color',
            },
        });

        expect((globalThis.CSS as any).supports).toHaveBeenCalledWith(
            'color',
            'rebeccapurple'
        );
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]?.code).toBe('THEME_005');
    });

    it('falls back to regex validation when CSS.supports is unavailable', () => {
        (globalThis as any).CSS = undefined;

        const result = validateThemeDefinition({
            ...baseTheme,
            colors: {
                ...baseTheme.colors,
                primary: '#123456',
                secondary: 'not-a-color',
            },
        });

        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]?.code).toBe('THEME_005');
    });
});
