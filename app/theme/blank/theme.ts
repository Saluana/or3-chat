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
import { dashboardOverrides, dashboardStyles } from './styles/dashboard';
import { documentsOverrides, documentsStyles } from './styles/documents';

export default defineTheme({
    name: 'blank',
    displayName: 'Blank theme',
    description: 'Minimalist blank theme with clean and simple design',
    isDefault: true,

    borderWidth: '1px',
    borderRadius: '8px',
    // Material Design 3 color palette for retro theme
    // These will generate CSS variables for both light and dark modes
    colors: {
        // Primary colors
        primary: '#086DB8',
        primaryTint: '#2A8FD6',
        primaryShade: '#064F89',
        onPrimary: '#ffffff',
        primaryContainer: '#2C638B',
        onPrimaryContainer: '#002020',
        primaryBorder: '#0A5D99',
        primaryHover: '#0A7FD1',
        primaryActive: '#075A8F',

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
        surfaceHover: '#F2F7FC',
        surfaceActive: '#EBF3FB',
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
        infoHover: '#DCEAF4',
        infoActive: '#C6DDEE',
        onInfo: '#000000',

        // Dark mode overrides
        dark: {
            primary: '#2C638B',
            primaryTint: '#4E8FBC',
            primaryShade: '#204968',
            onPrimary: '#FFFFFF',
            primaryContainer: '#00504e',
            onPrimaryContainer: '#b2f5ea',
            primaryBorder: '#234E6D',
            primaryHover: '#3978A4',
            primaryActive: '#234C67',

            secondary: '#ffb3b3',
            onSecondary: '#5f1314',
            secondaryContainer: '#7d1f20',
            onSecondaryContainer: '#ffd7d7',

            tertiary: '#ffe66d',
            onTertiary: '#3a3000',
            tertiaryContainer: '#554600',
            onTertiaryContainer: '#fff9c4',

            surface: '#000000',
            surfaceHover: '#172332',
            surfaceActive: '#223344',
            onSurface: '#e2e2e6',
            surfaceVariant: '#000000',
            onSurfaceVariant: '#c3c7cf',
            inverseSurface: '#e2e2e6',
            inverseOnSurface: '#2f3033',

            outline: '#8d9199',
            borderColor: '#3A4A57',

            info: '#111417',
            infoHover: '#1A1F23',
            infoActive: '#0C0E10',
            onInfo: '#DDE3E8',
            success: '#51cf66',
            warning: '#ffa94d',
            error: '#ffb3b3',
        },
    },

    backgrounds: {
        content: {
            base: { color: 'var(--md-surface)' },
        },
        sidebar: {},
    },

    fonts: {
        sans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
        heading: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
        baseSize: '16px',
        baseWeight: '400',
    },

    // Component overrides using the new selector syntax
    // These provide default styling for all retro-themed components
    overrides: {
        formField: {
            ui: {
                base: 'flex flex-col',
                label: 'text-xs font-light px-1 text-[var(--md-on-surface)]/70 -mb-0.5!',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        // Global input overrides
        input: {
            ui: {
                root: 'font-[IBM_Plex_Sans]!',
                variants: {
                    variant: {
                        outline:
                            'text-highlighted bg-default ring-0 focus-visible:ring-1 focus-visible:ring-[color:var(--md-primary)]',
                    },
                    size: {
                        sm: { base: 'h-[32px] text-[12px]!' },
                        md: { base: 'h-[40px] text-[14px]!' },
                        lg: { base: 'h-[48px] text-[16px]!' },
                    },
                },
            },
        },
        selectmenu: {
            ui: {
                base: 'text-[15px] leading-[20px]',
                value: 'text-[15px]',
                placeholder: 'text-[15px]',
                label: 'text-[15px]',
                item: 'text-[15px]',
                itemLabel: 'text-[15px]',
                content: 'text-[15px]',
            },
        },

        ...chatOverrides,
        ...sidebarOverrides,
        ...dashboardOverrides,
        ...documentsOverrides,
    },
    // CSS Selectors for direct DOM targeting
    // These target elements that can't easily be integrated with the component override system
    cssSelectors: {
        ...sidebarCssSelectors,
        ...chatCssSelectors,
        ...dashboardStyles,
        ...documentsStyles,
        '.theme-btn': {
            style: {
                border: 'var(--md-border-width) solid var(--md-border-color)',
                borderRadius: 'var(--md-border-radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            },
        },
        '.theme-btn:hover': {
            style: {
                backgroundColor: 'var(--md-surface-hover)',
            },
        },
        '.theme-btn:active': {
            style: {
                backgroundColor: 'var(--md-surface-active)',
            },
        },
        '#top-nav .theme-btn': {
            style: {
                border: 'none !important',
            },
        },
        '#top-header .theme-btn': {
            style: {
                border: 'none !important',
                minHeight: '24px',
                minWidth: '24px',
            },
        },
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
