import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { UserThemeOverrides } from '../user-overrides-types';

// Mock dependencies - must be defined before imports
vi.mock('../backgrounds', () => ({
    applyThemeBackgrounds: vi.fn().mockResolvedValue(undefined),
    createThemeBackgroundTokenResolver: vi.fn(() => vi.fn()),
}));

// Now we can safely import
const { applyMergedTheme } = await import('../apply-merged-theme');
const { applyThemeBackgrounds } = await import('../backgrounds');

const mockLoadTheme = vi.fn();

// Mock Nuxt app and theme plugin
const mockThemePlugin = {
    activeTheme: { value: 'retro' },
    loadTheme: mockLoadTheme,
};

describe('applyMergedTheme', () => {
    beforeEach(() => {
        // Setup DOM
        document.documentElement.style.cssText = '';

        // Mock global nuxtApp
        (globalThis as any).useNuxtApp = () => ({
            $theme: mockThemePlugin,
        });

        // Reset mocks
        vi.clearAllMocks();

        // Default theme mock
        mockLoadTheme.mockResolvedValue({
            name: 'retro',
            backgrounds: {
                content: {
                    base: {
                        image: '/base.png',
                        opacity: 0.2,
                        color: '#ffffff',
                    },
                    overlay: {
                        image: '/overlay.png',
                        opacity: 0.1,
                        color: '#f5f5f5',
                    },
                },
                sidebar: {
                    color: '#fafafa',
                },
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should apply typography overrides to CSS variables', async () => {
        const overrides: UserThemeOverrides = {
            typography: {
                baseFontPx: 18,
                useSystemFont: true,
            },
            colors: { enabled: false },
            backgrounds: { enabled: false },
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--app-font-size-root')).toBe('18px');
        expect(style.getPropertyValue('--app-font-sans-current')).toContain(
            'ui-sans-serif'
        );
    });

    it('applies and removes shared shape overrides', async () => {
        const style = document.documentElement.style;

        await applyMergedTheme(
            'light',
            {
                shape: {
                    enabled: true,
                    borderWidthPx: 2.5,
                    borderRadiusPx: 18,
                },
                colors: { enabled: false },
                backgrounds: { enabled: false },
                typography: {},
                ui: {},
            },
            mockThemePlugin as any
        );

        expect(style.getPropertyValue('--md-border-width')).toBe('2.5px');
        expect(style.getPropertyValue('--md-border-radius')).toBe('18px');

        await applyMergedTheme(
            'light',
            {
                shape: { enabled: false },
                colors: { enabled: false },
                backgrounds: { enabled: false },
                typography: {},
                ui: {},
            },
            mockThemePlugin as any
        );

        expect(style.getPropertyValue('--md-border-width')).toBe('');
        expect(style.getPropertyValue('--md-border-radius')).toBe('');
    });

    it('should apply color palette overrides when enabled', async () => {
        const overrides: UserThemeOverrides = {
            colors: {
                enabled: true,
                primary: '#ff0000',
                secondary: '#00ff00',
            },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--md-primary')).toBe('#ff0000');
        expect(style.getPropertyValue('--md-secondary')).toBe('#00ff00');
    });

    it('applies interaction, border, and semantic compatibility variables', async () => {
        const overrides: UserThemeOverrides = {
            colors: {
                enabled: true,
                borderColor: '#111111',
                surfaceHover: '#222222',
                surfaceActive: '#333333',
                success: '#44aa66',
                warning: '#cc8800',
            },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--md-border-color')).toBe('#111111');
        expect(style.getPropertyValue('--md-surface-hover')).toBe('#222222');
        expect(style.getPropertyValue('--md-surface-active')).toBe('#333333');
        expect(style.getPropertyValue('--md-success')).toBe('#44aa66');
        expect(
            style.getPropertyValue('--md-extended-color-success-color')
        ).toBe('#44aa66');
        expect(style.getPropertyValue('--md-warning')).toBe('#cc8800');
        expect(
            style.getPropertyValue('--md-extended-color-warning-color')
        ).toBe('#cc8800');
    });

    it('should remove color palette when disabled', async () => {
        // First apply with enabled
        const enabledOverrides: UserThemeOverrides = {
            colors: {
                enabled: true,
                primary: '#ff0000',
            },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', enabledOverrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--md-primary')).toBe('#ff0000');

        // Then disable
        const disabledOverrides: UserThemeOverrides = {
            colors: { enabled: false },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', disabledOverrides, mockThemePlugin as any);

        expect(style.getPropertyValue('--md-primary')).toBe('');
    });

    it('removes semantic compatibility variables when colors are disabled', async () => {
        const style = document.documentElement.style;
        style.setProperty('--md-success', '#44aa66');
        style.setProperty('--md-extended-color-success-color', '#44aa66');
        style.setProperty('--md-warning', '#cc8800');
        style.setProperty('--md-extended-color-warning-color', '#cc8800');

        await applyMergedTheme(
            'light',
            {
                colors: { enabled: false },
                backgrounds: { enabled: false },
                typography: {},
                ui: {},
            },
            mockThemePlugin as any
        );

        expect(style.getPropertyValue('--md-success')).toBe('');
        expect(
            style.getPropertyValue('--md-extended-color-success-color')
        ).toBe('');
        expect(style.getPropertyValue('--md-warning')).toBe('');
        expect(
            style.getPropertyValue('--md-extended-color-warning-color')
        ).toBe('');
    });

    it('removes an omitted color while user colors remain enabled', async () => {
        const style = document.documentElement.style;
        style.setProperty('--md-secondary', '#00ff00');
        await applyMergedTheme(
            'light',
            {
                colors: { enabled: true, primary: '#ff0000' },
                backgrounds: { enabled: false },
                typography: {},
                ui: {},
            },
            mockThemePlugin as any
        );

        expect(style.getPropertyValue('--md-primary')).toBe('#ff0000');
        expect(style.getPropertyValue('--md-secondary')).toBe('');
    });

    it('should merge background layers correctly', async () => {
        const overrides: UserThemeOverrides = {
            backgrounds: {
                content: {
                    base: {
                        url: '/user-image.png',
                        opacity: 0.8,
                        sizePx: 400,
                        fit: false,
                        repeat: 'repeat',
                        color: '#ffffff',
                    },
                },
            },
            colors: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        expect(applyThemeBackgrounds).toHaveBeenCalledWith(
            expect.objectContaining({
                content: {
                    base: expect.objectContaining({
                        image: '/user-image.png',
                        opacity: 0.8,
                    }),
                    overlay: expect.any(Object),
                },
            }),
            expect.any(Object)
        );
    });

    it('should apply background color overrides when enabled', async () => {
        const overrides: UserThemeOverrides = {
            backgrounds: {
                enabled: true,
                content: {
                    base: {
                        url: null,
                        opacity: 0,
                        sizePx: 240,
                        fit: false,
                        repeat: 'repeat',
                        color: '#123456',
                    },
                },
            },
            colors: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--app-content-bg-1-color')).toBe(
            '#123456'
        );
    });

    it('should preserve theme background colors when overrides are disabled', async () => {
        const baselineColor = '#ffffff';
        document.documentElement.style.setProperty(
            '--app-content-bg-1-color',
            baselineColor
        );

        const overrides: UserThemeOverrides = {
            backgrounds: { enabled: false },
            colors: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        expect(
            document.documentElement.style.getPropertyValue(
                '--app-content-bg-1-color'
            )
        ).toBe(baselineColor);
    });

    it('should handle gradient visibility toggles', async () => {
        const overrides: UserThemeOverrides = {
            backgrounds: {
                headerGradient: { enabled: false },
                bottomNavGradient: { enabled: true },
            },
            colors: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--app-header-gradient-display')).toBe(
            'none'
        );
        expect(style.getPropertyValue('--app-bottomnav-gradient-display')).toBe(
            'block'
        );
    });

    it('should return early if theme plugin not found', async () => {
        (globalThis as any).useNuxtApp = () => ({
            $theme: undefined,
        });

        const overrides: UserThemeOverrides = {
            colors: { enabled: false },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, undefined);

        // Should not call applyThemeBackgrounds
        expect(applyThemeBackgrounds).not.toHaveBeenCalled();
    });

    it('should return early if theme load fails', async () => {
        mockLoadTheme.mockResolvedValue(null);

        const overrides: UserThemeOverrides = {
            colors: { enabled: false },
            backgrounds: { enabled: false },
            typography: {},
            ui: {},
        };

        await applyMergedTheme('light', overrides, mockThemePlugin as any);

        // Should not call applyThemeBackgrounds
        expect(applyThemeBackgrounds).not.toHaveBeenCalled();
    });
});
