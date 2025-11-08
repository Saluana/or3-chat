import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyThemeBackgrounds, buildBackgroundsFromSettings } from '../backgrounds';
import type { ThemeBackgrounds } from '~/theme/_shared/types';
import type { ThemeSettings } from '../theme-types';

describe('Theme Backgrounds', () => {
    let mockResolveToken: ReturnType<typeof vi.fn>;
    let originalDocument: Document;

    beforeEach(() => {
        originalDocument = global.document;
        mockResolveToken = vi.fn(async (token: string) => {
            if (token.startsWith('internal-file://')) return null;
            return token;
        });

        // Create minimal DOM mock
        const mockStyle = new Map<string, string>();
        global.document = {
            documentElement: {
                style: {
                    setProperty: vi.fn((key: string, value: string) => {
                        mockStyle.set(key, value);
                    }),
                    getPropertyValue: vi.fn((key: string) => mockStyle.get(key) || ''),
                },
            },
        } as any;
    });

    afterEach(() => {
        global.document = originalDocument;
        vi.clearAllMocks();
    });

    describe('applyThemeBackgrounds', () => {
        it('should apply content base layer with all properties', async () => {
            const backgrounds: ThemeBackgrounds = {
                content: {
                    base: {
                        image: '/test-bg.webp',
                        opacity: 0.5,
                        repeat: 'repeat',
                        size: '200px',
                    },
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1',
                'url("/test-bg.webp")'
            );
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-opacity', '0.5');
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-repeat', 'repeat');
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-size', '200px');
        });

        it('should apply sidebar layer', async () => {
            const backgrounds: ThemeBackgrounds = {
                sidebar: {
                    image: '/sidebar.webp',
                    opacity: 0.1,
                    repeat: 'no-repeat',
                    fit: 'cover',
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-1',
                'url("/sidebar.webp")'
            );
            expect(setProperty).toHaveBeenCalledWith('--app-sidebar-bg-1-opacity', '0.1');
            expect(setProperty).toHaveBeenCalledWith('--app-sidebar-bg-1-size', 'cover');
        });

        it('should clear layers when image is null', async () => {
            const backgrounds: ThemeBackgrounds = {
                content: {
                    base: {
                        image: null,
                    },
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1', 'none');
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-opacity', '1');
        });

        it('should apply gradients', async () => {
            const backgrounds: ThemeBackgrounds = {
                headerGradient: {
                    image: '/gradient.webp',
                    repeat: 'repeat-x',
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-header-gradient',
                'url("/gradient.webp")'
            );
        });

        it('should handle missing backgrounds gracefully', async () => {
            await applyThemeBackgrounds(undefined, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1', 'none');
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-2', 'none');
            expect(setProperty).toHaveBeenCalledWith('--app-sidebar-bg-1', 'none');
        });

        it('should clamp opacity to 0-1 range', async () => {
            const backgrounds: ThemeBackgrounds = {
                content: {
                    base: {
                        image: '/test.webp',
                        opacity: 1.5,
                    },
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-opacity', '1');
        });

        it('should normalize invalid repeat values to default', async () => {
            const backgrounds: ThemeBackgrounds = {
                content: {
                    base: {
                        image: '/test.webp',
                        repeat: 'invalid' as any,
                    },
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style.setProperty as any;
            expect(setProperty).toHaveBeenCalledWith('--app-content-bg-1-repeat', 'repeat');
        });
    });

    describe('buildBackgroundsFromSettings', () => {
        it('should convert ThemeSettings to ThemeBackgrounds', () => {
            const settings: ThemeSettings = {
                baseFontPx: 20,
                useSystemFont: false,
                showHeaderGradient: true,
                showBottomBarGradient: true,
                customBgColorsEnabled: false,
                contentBg1Color: 'var(--md-surface)',
                contentBg2Color: 'var(--md-surface)',
                sidebarBgColor: 'var(--md-surface)',
                headerBgColor: 'var(--md-surface)',
                bottomBarBgColor: 'var(--md-surface)',
                contentBg1: '/bg.webp',
                contentBg2: '/bg2.webp',
                contentBg1Opacity: 0.08,
                contentBg2Opacity: 0.125,
                contentBg1Repeat: 'repeat',
                contentBg2Repeat: 'no-repeat',
                contentBg1SizePx: 150,
                contentBg2SizePx: 380,
                contentBg1Fit: false,
                contentBg2Fit: true,
                sidebarBg: '/sidebar.webp',
                sidebarBgOpacity: 0.1,
                sidebarRepeat: 'repeat',
                sidebarBgSizePx: 240,
                sidebarBgFit: false,
                contentRepeat: 'repeat',
                reducePatternsInHighContrast: false,
            };

            const backgrounds = buildBackgroundsFromSettings(settings);

            expect(backgrounds.content?.base).toEqual({
                image: '/bg.webp',
                opacity: 0.08,
                repeat: 'repeat',
                size: '150px',
                fit: undefined,
            });

            expect(backgrounds.content?.overlay).toEqual({
                image: '/bg2.webp',
                opacity: 0.125,
                repeat: 'no-repeat',
                size: undefined,
                fit: 'cover',
            });

            expect(backgrounds.sidebar).toEqual({
                image: '/sidebar.webp',
                opacity: 0.1,
                repeat: 'repeat',
                size: '240px',
                fit: undefined,
            });

            expect(backgrounds.headerGradient).toBeDefined();
            expect(backgrounds.bottomNavGradient).toBeDefined();
        });

        it('should handle null images', () => {
            const settings: ThemeSettings = {
                baseFontPx: 20,
                useSystemFont: false,
                showHeaderGradient: false,
                showBottomBarGradient: false,
                customBgColorsEnabled: false,
                contentBg1Color: 'var(--md-surface)',
                contentBg2Color: 'var(--md-surface)',
                sidebarBgColor: 'var(--md-surface)',
                headerBgColor: 'var(--md-surface)',
                bottomBarBgColor: 'var(--md-surface)',
                contentBg1: null,
                contentBg2: null,
                contentBg1Opacity: 0,
                contentBg2Opacity: 0,
                contentBg1Repeat: 'repeat',
                contentBg2Repeat: 'repeat',
                contentBg1SizePx: 150,
                contentBg2SizePx: 380,
                contentBg1Fit: false,
                contentBg2Fit: false,
                sidebarBg: null,
                sidebarBgOpacity: 0,
                sidebarRepeat: 'repeat',
                contentRepeat: 'repeat',
                reducePatternsInHighContrast: false,
            };

            const backgrounds = buildBackgroundsFromSettings(settings);

            expect(backgrounds.content?.base).toBeUndefined();
            expect(backgrounds.content?.overlay).toBeUndefined();
            expect(backgrounds.sidebar).toBeUndefined();
            expect(backgrounds.headerGradient).toBeUndefined();
            expect(backgrounds.bottomNavGradient).toBeUndefined();
        });
    });
});
