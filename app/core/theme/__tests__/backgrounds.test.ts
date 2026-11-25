import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyThemeBackgrounds } from '../backgrounds';
import type { ThemeBackgrounds } from '~/theme/_shared/types';

describe('Theme Backgrounds', () => {
    const mockResolveToken = async (token: string) =>
        token.startsWith('internal-file://') ? null : token;

    afterEach(() => {
        document.documentElement.style.cssText = '';
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

            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1'))
                .toBe('url("/test-bg.webp")');
            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-opacity'))
                .toBe('0.5');
            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-repeat'))
                .toBe('repeat');
            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-size'))
                .toBe('200px');
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

            expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg-1'))
                .toBe('url("/sidebar.webp")');
            expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg-1-opacity'))
                .toBe('0.1');
            expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg-1-size'))
                .toBe('cover');
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

            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1'))
                .toBe('none');
            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-opacity'))
                .toBe('1');
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

            expect(document.documentElement.style.getPropertyValue('--app-header-gradient'))
                .toBe('url("/gradient.webp")');
        });

        it('should handle missing backgrounds gracefully', async () => {
            await applyThemeBackgrounds(undefined, {
                resolveToken: mockResolveToken,
            });

            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1'))
                .toBe('none');
            expect(document.documentElement.style.getPropertyValue('--app-content-bg-2'))
                .toBe('none');
            expect(document.documentElement.style.getPropertyValue('--app-sidebar-bg-1'))
                .toBe('none');
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

            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-opacity'))
                .toBe('1');
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

            expect(document.documentElement.style.getPropertyValue('--app-content-bg-1-repeat'))
                .toBe('repeat');
        });

    });
});

const identityResolver = async (token: string) => token;

describe('applyThemeBackgrounds', () => {
    beforeEach(() => {
        document.documentElement.style.cssText = '';
    });

    it('sets color variables when a layer provides a color', async () => {
        await applyThemeBackgrounds(
            {
                content: {
                    base: { color: '#123456' },
                    overlay: { color: '#654321' },
                },
                sidebar: { color: '#abcdef' },
            },
            { resolveToken: identityResolver }
        );

        expect(
            document.documentElement.style.getPropertyValue(
                '--app-content-bg-1-color'
            )
        ).toBe('#123456');
        expect(document.documentElement.style.getPropertyValue('--app-content-bg-2-color')).toBe('#654321');
        expect(
            document.documentElement.style.getPropertyValue(
                '--app-sidebar-bg-color'
            )
        ).toBe('#abcdef');
    });

    it('removes color variables when a layer omits color', async () => {
        const colors = ['--app-content-bg-1-color', '--app-content-bg-2-color', '--app-sidebar-bg-color'];
        for (const color of colors) document.documentElement.style.setProperty(color, '#ffffff');
        await applyThemeBackgrounds({ content: { base: {}, overlay: {} }, sidebar: {} }, { resolveToken: identityResolver });
        for (const color of colors) expect(document.documentElement.style.getPropertyValue(color)).toBe('');
    });
});
