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

    it('emits optional semantic shape tiers for theme authors', () => {
        const css = generateThemeCssVariables({
            ...baseTheme,
            borderWidthSubtle: '1px',
            borderWidth: '2px',
            borderWidthStrong: '4px',
            borderRadiusSmall: '3px',
            borderRadius: '8px',
            borderRadiusLarge: '16px',
        });

        expect(css).toContain('--md-border-width-subtle: 1px;');
        expect(css).toContain('--md-border-width: 2px;');
        expect(css).toContain('--md-border-width-strong: 4px;');
        expect(css).toContain('--md-border-radius-small: 3px;');
        expect(css).toContain('--md-border-radius: 8px;');
        expect(css).toContain('--md-border-radius-large: 16px;');
    });

    it('emits explicitly authored density, focus, motion, and elevation tokens', () => {
        const css = generateThemeCssVariables({
            ...baseTheme,
            density: {
                controlHeightSmall: '28px',
                controlHeightMedium: '36px',
                controlHeightLarge: '44px',
                spaceControl: '8px',
                spaceSection: '16px',
            },
            focus: { ringColor: '#123456', ringOffset: '3px' },
            motion: {
                durationFast: '100ms',
                durationMedium: '200ms',
                durationSlow: '300ms',
                easingStandard: 'ease-out',
            },
            elevation: {
                low: '0 1px 2px rgb(0 0 0 / 0.05)',
                medium: '0 2px 4px rgb(0 0 0 / 0.1)',
                high: '0 8px 16px rgb(0 0 0 / 0.15)',
            },
        });

        expect(css).toContain('--app-control-height-medium: 36px;');
        expect(css).toContain('--app-space-section: 16px;');
        expect(css).toContain('--md-focus-ring: #123456;');
        expect(css).toContain('--app-focus-ring-offset: 3px;');
        expect(css).toContain('--app-motion-duration-medium: 200ms;');
        expect(css).toContain('--app-elevation-high: 0 8px 16px rgb(0 0 0 / 0.15);');
    });
});
