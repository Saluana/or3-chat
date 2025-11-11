import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyThemeBackgrounds } from '../backgrounds';
import type { ThemeBackgrounds } from '~/theme/_shared/types';

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
        const styleApi = {
            setProperty: vi.fn((key: string, value: string) => {
                mockStyle.set(key, value);
            }),
            getPropertyValue: vi.fn((key: string) => mockStyle.get(key) || ''),
            removeProperty: vi.fn((key: string) => {
                mockStyle.delete(key);
                return '';
            }),
        };

        global.document = {
            documentElement: {
                style: styleApi,
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1',
                'url("/test-bg.webp")'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-opacity',
                '0.5'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-repeat',
                'repeat'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-size',
                '200px'
            );
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-1',
                'url("/sidebar.webp")'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-1-opacity',
                '0.1'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-1-size',
                'cover'
            );
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1',
                'none'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-opacity',
                '1'
            );
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-header-gradient',
                'url("/gradient.webp")'
            );
        });

        it('should handle missing backgrounds gracefully', async () => {
            await applyThemeBackgrounds(undefined, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1',
                'none'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-2',
                'none'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-1',
                'none'
            );
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-opacity',
                '1'
            );
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

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-repeat',
                'repeat'
            );
        });

        it('should set color variables when provided by the theme', async () => {
            const backgrounds: ThemeBackgrounds = {
                content: {
                    base: {
                        color: '#123456',
                    },
                    overlay: {
                        color: '#654321',
                    },
                },
                sidebar: {
                    color: '#abcdef',
                },
            };

            await applyThemeBackgrounds(backgrounds, {
                resolveToken: mockResolveToken,
            });

            const setProperty = document.documentElement.style
                .setProperty as any;
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-color',
                '#123456'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-content-bg-2-color',
                '#654321'
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-color',
                '#abcdef'
            );
        });

        it('should remove color variables when a layer omits color', async () => {
            const removeProperty = document.documentElement.style
                .removeProperty as any;

            await applyThemeBackgrounds(
                {
                    content: {
                        base: {},
                    },
                    sidebar: {},
                },
                {
                    resolveToken: mockResolveToken,
                }
            );

            expect(removeProperty).toHaveBeenCalledWith(
                '--app-content-bg-1-color'
            );
            expect(removeProperty).toHaveBeenCalledWith(
                '--app-sidebar-bg-color'
            );
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
        expect(
            document.documentElement.style.getPropertyValue(
                '--app-sidebar-bg-color'
            )
        ).toBe('#abcdef');
    });

    it('removes color variables when a layer omits color', async () => {
        document.documentElement.style.setProperty(
            '--app-content-bg-1-color',
            '#ffffff'
        );

        await applyThemeBackgrounds(
            {
                content: {
                    base: {},
                },
            },
            { resolveToken: identityResolver }
        );

        expect(
            document.documentElement.style.getPropertyValue(
                '--app-content-bg-1-color'
            )
        ).toBe('');
    });
});
