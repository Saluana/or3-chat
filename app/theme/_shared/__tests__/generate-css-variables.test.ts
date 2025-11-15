import { describe, it, expect } from 'vitest';
import { generateThemeCssVariables } from '../generate-css-variables';

const baseTheme = {
    name: 'test',
    colors: {
        primary: '#000000',
        secondary: '#111111',
        surface: '#ffffff',
    },
} as const;

describe('generateThemeCssVariables', () => {
    it('includes font variables for light palette', () => {
        const css = generateThemeCssVariables({
            ...baseTheme,
            fonts: {
                sans: '"Inter", sans-serif',
                heading: '"Space Grotesk", sans-serif',
                baseSize: '18px',
                baseWeight: '500',
            },
        });

        expect(css).toContain('--font-sans: "Inter", sans-serif;');
        expect(css).toContain('--font-heading: "Space Grotesk", sans-serif;');
        expect(css).toContain('--app-font-size-root: 18px;');
        expect(css).toContain('--app-font-weight-root: 500;');
    });

    it('includes dark font variables even without dark colors', () => {
        const css = generateThemeCssVariables({
            ...baseTheme,
            fonts: {
                heading: '"Space Grotesk", sans-serif',
                dark: {
                    heading: '"Space Grotesk Bold", sans-serif',
                    baseSize: '17px',
                    baseWeight: '600',
                },
            },
        });

        expect(css).toContain('--font-heading: "Space Grotesk", sans-serif;');
        expect(css).toContain(
            '--font-heading: "Space Grotesk Bold", sans-serif;'
        );
        expect(css).toMatch(/\.dark html\[data-theme="test"]/);
        expect(css).toContain('--app-font-size-root: 17px;');
        expect(css).toContain('--app-font-weight-root: 600;');
    });
});
