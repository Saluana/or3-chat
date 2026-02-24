/**
 * Cyberpunk Theme for Or3 Chat
 *
 * Neon-drenched, dark-surface aesthetic inspired by cyberpunk game UIs.
 * Electric cyan primary, hot red secondary, neon yellow tertiary.
 * Angular borders, subtle glow effects, monospace-accented typography.
 *
 * Scoped to [data-theme="cyberpunk"] to prevent style leakage.
 */

import { defineTheme } from '../_shared/define-theme';
import { sidebarOverrides, sidebarCssSelectors } from './styles/sidebar';
import { chatOverrides, chatCssSelectors } from './styles/chat';
import { dashboardOverrides, dashboardStyles } from './styles/dashboard';
import { documentsOverrides, documentsStyles } from './styles/documents';

export default defineTheme({
    name: 'cyberpunk',
    displayName: 'Cyberpunk',
    description:
        'Neon-drenched dark theme with electric cyan, hot red accents, and angular UI inspired by cyberpunk game interfaces',
    isDefault: false,
    stylesheets: ['~/theme/cyberpunk/styles.css'],
    borderWidth: '1px',
    borderRadius: '2px',

    colors: {
        // Primary — electric cyan
        primary: '#00b8d4',
        primaryTint: '#33c9e0',
        primaryShade: '#0097a7',
        onPrimary: '#ffffff',
        primaryContainer: '#006874',
        onPrimaryContainer: '#e0f7fa',
        primaryBorder: '#00acc1',
        primaryHover: '#26c6da',
        primaryActive: '#0097a7',

        // Secondary — hot red / crimson
        secondary: '#ff003c',
        onSecondary: '#ffffff',
        secondaryContainer: '#5c0018',
        onSecondaryContainer: '#ffb3c1',

        // Tertiary — neon yellow
        tertiary: '#fcf206',
        onTertiary: '#1a1900',
        tertiaryContainer: '#3d3a00',
        onTertiaryContainer: '#fffe8a',

        // Surface — cool-tinted light backgrounds
        surface: '#dce4ec',
        surfaceHover: '#c8d4e0',
        surfaceActive: '#b0bfd0',
        surfaceContainerLowest: '#e8eef4',
        onSurface: '#0a1628',
        surfaceVariant: '#b4c4d4',
        onSurfaceVariant: '#2a3858',
        inverseSurface: '#0d1b2a',
        inverseOnSurface: '#d0e0f0',

        // Outline & borders
        outline: '#4a5878',
        borderColor: '#0097a7',

        // Semantic colors
        success: '#00c853',
        warning: '#ff8f00',
        error: '#d50032',
        errorHover: '#ff4569',
        errorActive: '#b0002a',
        info: '#c8e6ec',
        infoHover: '#b0d8e2',
        infoActive: '#98cad8',
        onInfo: '#001f24',
        topHeaderBg: '#c4d0de',

        // Dark mode — the true cyberpunk experience
        dark: {
            primary: '#00e5ff',
            primaryTint: '#4cf0ff',
            primaryShade: '#00b8d4',
            onPrimary: '#001f24',
            primaryContainer: '#003840',
            onPrimaryContainer: '#b2ebf2',
            primaryBorder: '#00bcd4',
            primaryHover: '#33ebff',
            primaryActive: '#00b8d4',

            secondary: '#ff1744',
            onSecondary: '#ffffff',
            secondaryContainer: '#7a0020',
            onSecondaryContainer: '#ffb3c1',

            tertiary: '#fcf206',
            onTertiary: '#1a1900',
            tertiaryContainer: '#3d3a00',
            onTertiaryContainer: '#fffe8a',

            surface: '#0a0e17',
            surfaceHover: '#111928',
            surfaceActive: '#1a2338',
            surfaceContainerLowest: '#060a10',
            onSurface: '#d0e0f0',
            surfaceVariant: '#141e30',
            onSurfaceVariant: '#8898b0',
            inverseSurface: '#d0e0f0',
            inverseOnSurface: '#0a0e17',

            outline: '#3a4a68',
            borderColor: '#00bcd4',

            info: '#0a1520',
            infoHover: '#0e1c2e',
            infoActive: '#142638',
            onInfo: '#b0c8e0',
            success: '#00e676',
            warning: '#ffab00',
            error: '#ff1744',
            errorHover: '#ff4569',
            errorActive: '#d50032',
            topHeaderBg: '#0a0e17',
        },
    },

    backgrounds: {
        content: {
            base: {
                image: '/backgrounds/lightmode-cyberpunk-bg.png',
                opacity: 0.85,
                fit: 'cover',
            },
        },
        sidebar: {
            image: '/backgrounds/cyberpunk.png',
            opacity: 0.35,
            fit: 'cover',
        },
        dark: {
            content: {
                base: {
                    image: '/backgrounds/cyberpunk.png',
                    opacity: 0.29,
                    repeat: 'repeat',
                    size: '733px',
                    fit: undefined,
                },
            },
            sidebar: {
                image: '/backgrounds/cybersb2.png',
                opacity: 0.5,
                repeat: 'repeat',
                size: '733px',
                fit: undefined,
            },
        },
    },

    fonts: {
        sans: '"IBM Plex Sans", "Inter", ui-sans-serif, system-ui, sans-serif',
        heading:
            '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace',
        baseSize: '15px',
        baseWeight: '400',
    },

    overrides: {
        formField: {
            ui: {
                base: 'flex flex-col',
                label: 'text-xs font-medium uppercase tracking-wider px-1 text-[var(--md-on-surface)]/60 -mb-0.5!',
                help: 'mt-[4px] text-xs text-[var(--md-primary)] px-1!',
            },
        },
        input: {
            ui: {
                root: 'font-[IBM_Plex_Sans]!',
                variants: {
                    variant: {
                        outline:
                            'text-highlighted bg-default ring-0 focus-visible:ring-1 focus-visible:ring-[color:var(--md-primary)]',
                    },
                    size: {
                        sm: { base: 'h-[32px] text-[13px]!' },
                        md: { base: 'h-[40px] text-[14px]!' },
                        lg: { base: 'h-[48px] text-[16px]!' },
                    },
                },
            },
        },
        selectmenu: {
            ui: {
                base: 'text-[14px] leading-[20px]',
                value: 'text-[14px]',
                placeholder: 'text-[14px]',
                label: 'text-[14px]',
                item: 'text-[14px]',
                itemLabel: 'text-[14px]',
                content: 'text-[14px]',
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
        '#top-header .theme-btn': {
            style: {
                minHeight: '24px',
                minWidth: '24px',
            },
        },
    },
});
