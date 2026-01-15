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
    name: 'retro',
    displayName: 'Retro theme',
    description:
        'Classic retro aesthetic with pixel-perfect styling and nostalgic vibes',
    isDefault: false,
    stylesheets: ['~/theme/retro/styles.css'],
    borderWidth: '2px',
    borderRadius: '3px',
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
        borderColor: '#032640',

        // Semantic colors
        success: '#51cf66',
        warning: '#ffa94d',
        error: '#ff6b6b',
        info: '#E8F1F8',
        infoHover: '#DCEAF4',
        infoActive: '#C6DDEE',
        onInfo: '#000000',
        topHeaderBg: '#F1F3F5',

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

            surface: '#1A1E23',
            surfaceHover: '#172332',
            surfaceActive: '#223344',
            onSurface: '#e2e2e6',
            surfaceVariant: '#000000',
            onSurfaceVariant: '#c3c7cf',
            inverseSurface: '#e2e2e6',
            inverseOnSurface: '#2f3033',

            outline: '#8d9199',
            borderColor: '#577a94',

            info: '#111417',
            infoHover: '#1A1F23',
            infoActive: '#0C0E10',
            onInfo: '#DDE3E8',
            success: '#51cf66',
            warning: '#ffa94d',
            error: '#ffb3b3',
            topHeaderBg: '#1A1E23',
        },
    },

    backgrounds: {
        content: {
            base: {
                image: '/bg-repeat.v2.webp',
                opacity: 0.065,
                repeat: 'repeat',
                size: '150px',
            },
            overlay: {
                image: '/bg-repeat-2.v2.webp',
                opacity: 0.075,
                repeat: 'repeat',
                size: '420px',
            },
        },
        sidebar: {
            image: '/sidebar-repeater.v2.webp',
            opacity: 0.055,
            repeat: 'repeat',
            size: '240px',
        },
        headerGradient: {
            image: '/gradient-x.webp',
            repeat: 'repeat',
            size: 'auto 100%',
        },
        bottomNavGradient: {
            image: null,
            color: 'transparent',
        },
    },

    fonts: {
        sans: '"VT323", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
        heading: '"Press Start 2P", ui-sans-serif, system-ui, sans-serif',
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
        modal: {
            close: {
                square: true,
                size: 'sm',
                variant: 'solid',
                color: 'on-surface',
                class: 'flex items-center justify-center leading-none',
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
        '#top-header .theme-btn': {
            style: {
                minHeight: '24px',
                minWidth: '24px',
            },
        },
    },
});
