/**
 * Retro Theme - Default Theme for Or3 Chat
 *
 * This is the original retro aesthetic theme, migrated to the refined theme system.
 * It features pixel-perfect styling with hard borders, offset shadows, and a nostalgic vibe.
 *
 * All retro-specific styles are contained within this theme package and loaded
 * conditionally when the retro theme is active.
 */

import { defineTheme } from '../_shared/define-theme';
import { sidebarOverrides, sidebarCssSelectors } from './styles/sidebar';
import { chatOverrides, chatCssSelectors } from './styles/chat';

export default defineTheme({
    name: 'pog',
    displayName: 'Pog theme',
    description:
        'Classic retro aesthetic with pixel-perfect styling and nostalgic vibes',
    isDefault: true,

    borderWidth: '1px',
    borderRadius: '8px',
    // Material Design 3 color palette for retro theme
    // These will generate CSS variables for both light and dark modes
    colors: {
        // Primary colors
        primary: '#086DB8',
        onPrimary: '#ffffff',
        primaryContainer: '#2C638B',
        onPrimaryContainer: '#002020',

        // Secondary colors
        secondary: '#ff6b6b',
        onSecondary: '#ffffff',
        secondaryContainer: '#ffd7d7',
        onSecondaryContainer: '#410002',

        // Tertiary colors
        tertiary: '#ffe66d',
        onTertiary: '#000000',
        tertiaryContainer: '#fff9c4',
        onTertiaryContainer: '#1f1b00',

        // Surface colors
        surface: '#ffffff',
        onSurface: '#022344',
        surfaceVariant: '#ffffff',
        onSurfaceVariant: '#43474e',
        inverseSurface: '#2f3033',
        inverseOnSurface: '#f1f0f4',

        // Outline & borders
        outline: '#73777f',
        borderColor: '#e5e5e5',

        // Semantic colors
        success: '#51cf66',
        warning: '#ffa94d',
        error: '#ff6b6b',
        info: '#E8F1F8',

        // Dark mode overrides
        dark: {
            primary: '#2C638B',
            onPrimary: '#003735',
            primaryContainer: '#00504e',
            onPrimaryContainer: '#b2f5ea',

            secondary: '#ffb3b3',
            onSecondary: '#5f1314',
            secondaryContainer: '#7d1f20',
            onSecondaryContainer: '#ffd7d7',

            tertiary: '#ffe66d',
            onTertiary: '#3a3000',
            tertiaryContainer: '#554600',
            onTertiaryContainer: '#fff9c4',

            surface: '#ffffff',
            onSurface: '#e2e2e6',
            surfaceVariant: '#43474e',
            onSurfaceVariant: '#c3c7cf',
            inverseSurface: '#e2e2e6',
            inverseOnSurface: '#2f3033',

            outline: '#8d9199',
            borderColor: '#8d9199',

            success: '#51cf66',
            warning: '#ffa94d',
            error: '#ffb3b3',
        },
    },

    backgrounds: {
        content: {
            base: { color: '#ffffff' },
        },
        sidebar: {},
    },

    // Component overrides using the new selector syntax
    // These provide default styling for all retro-themed components
    overrides: {
        // Global input overrides
        input: {
            ui: {
                variants: {
                    variant: {
                        outline:
                            'text-highlighted bg-default ring-0 focus-visible:ring-1 focus-visible:ring-[color:var(--md-primary)]',
                    },
                },
            },
        },
        // Global button overrides
        button: {
            ui: {
                variants: {
                    size: {
                        xs: { base: 'h-[24px] w-[24px] !px-0 !text-[14px]' },
                        sm: { base: 'h-[32px] !px-[12px] !text-[14px]' },
                        md: { base: 'h-[40px] !px-[16px] !text-[14px]' },
                        lg: { base: 'h-[56px] !px-[24px] !text-[20px]' },
                    },
                },
            },
        },
        ...chatOverrides,
        ...sidebarOverrides,
    },
    // CSS Selectors for direct DOM targeting
    // These target elements that can't easily be integrated with the component override system
    cssSelectors: {
        ...sidebarCssSelectors,
        ...chatCssSelectors,
        // Example: Third-party Monaco editor styling
        // '.monaco-editor': {
        //     style: {
        //         border: '2px solid var(--md-outline)',
        //         borderRadius: '3px',
        //     },
        //     class: 'retro-shadow',
        // },
        // Example: TipTap editor styling
        // '.tiptap': {
        //     style: {
        //         fontFamily: 'VT323, monospace',
        //         fontSize: '20px',
        //     },
        //     class: 'prose prose-retro',
        // },
        // Example: Modal overlays
        // '.modal-overlay': {
        //     class: 'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
        // },
    },
});
