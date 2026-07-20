/**
 * Blank Theme
 *
 * ChatGPT-inspired clean minimal theme.
 */

import { defineTheme } from '../_shared/define-theme';
import { sidebarOverrides, sidebarCssSelectors } from './styles/sidebar';
import { chatOverrides, chatCssSelectors } from './styles/chat';
import { dashboardOverrides, dashboardStyles } from './styles/dashboard';
import { documentsOverrides, documentsStyles } from './styles/documents';

export default defineTheme({
    name: 'blank',
    displayName: 'Blank theme',
    description: 'ChatGPT-inspired clean minimal theme',
    isDefault: false,

    borderWidth: '0px',
    borderRadius: '10px',
    stylesheets: ['~/theme/blank/styles.css'],
    customComponents: {
        'chat-input': './components/ChatInput.vue',
    },
    componentContractVersion: 1,
    colors: {
        // Primary: near-black like ChatGPT
        primary: '#0d0d0d',
        primaryTint: '#333333',
        primaryShade: '#000000',
        onPrimary: '#ffffff',
        primaryContainer: '#f0f0f0',
        onPrimaryContainer: '#0d0d0d',
        primaryBorder: '#e5e5e5',
        primaryHover: '#1a1a1a',
        primaryActive: '#000000',

        // Secondary: muted gray
        secondary: '#8f8f8f',
        onSecondary: '#ffffff',
        secondaryContainer: '#f0f0f0',
        onSecondaryContainer: '#333333',

        // Tertiary
        tertiary: '#0d0d0d',
        onTertiary: '#ffffff',
        tertiaryContainer: '#e8e8e8',
        onTertiaryContainer: '#1a1a1a',

        // Surface: white base, light gray variants
        surface: '#ffffff',
        surfaceHover: '#f5f5f5',
        surfaceActive: '#ececec',
        onSurface: '#0d0d0d',
        surfaceVariant: '#f9f9f9',
        onSurfaceVariant: '#666666',
        inverseSurface: '#0d0d0d',
        inverseOnSurface: '#ffffff',

        // Outline & borders
        outline: '#d9d9d9',
        borderColor: '#e5e5e5',

        // Semantic
        success: '#10a37f',
        warning: '#f59e0b',
        error: '#ef4444',
        errorHover: '#dc2626',
        errorActive: '#b91c1c',
        info: '#f7f7f8',
        infoHover: '#ececed',
        infoActive: '#e3e3e4',
        onInfo: '#0d0d0d',

        dark: {
            primary: '#ffffff',
            primaryTint: '#e0e0e0',
            primaryShade: '#cccccc',
            onPrimary: '#0d0d0d',
            primaryContainer: '#2f2f2f',
            onPrimaryContainer: '#e0e0e0',
            primaryBorder: '#424242',
            primaryHover: '#e0e0e0',
            primaryActive: '#cccccc',

            secondary: '#9e9e9e',
            onSecondary: '#0d0d0d',
            secondaryContainer: '#424242',
            onSecondaryContainer: '#e0e0e0',

            tertiary: '#ffffff',
            onTertiary: '#0d0d0d',
            tertiaryContainer: '#424242',
            onTertiaryContainer: '#e0e0e0',

            surface: '#212121',
            surfaceHover: '#2f2f2f',
            surfaceActive: '#383838',
            onSurface: '#ececec',
            surfaceVariant: '#171717',
            onSurfaceVariant: '#b0b0b0',
            inverseSurface: '#ececec',
            inverseOnSurface: '#212121',

            outline: '#555555',
            borderColor: '#424242',

            info: '#2f2f2f',
            infoHover: '#383838',
            infoActive: '#424242',
            onInfo: '#e0e0e0',
            success: '#10a37f',
            warning: '#f59e0b',
            error: '#ef4444',
        },
    },

    backgrounds: {
        content: {
            base: { color: 'var(--md-surface)' },
        },
        sidebar: { color: 'var(--md-surface-variant)' },
    },

    fonts: {
        sans: 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        heading:
            'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        baseSize: '16px',
        baseWeight: '400',
    },

    overrides: {
        formField: {
            ui: {
                base: 'flex flex-col',
                label: 'text-xs font-medium px-1 text-[var(--md-on-surface)]/70 -mb-0.5!',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        input: {
            ui: {
                root: '',
                variants: {
                    variant: {
                        outline:
                            'text-highlighted bg-default ring-0 border-[color:var(--md-border-color)] focus-visible:ring-1 focus-visible:ring-[color:var(--md-on-surface)]/20',
                    },
                    size: {
                        sm: { base: 'h-[32px] text-[13px]!' },
                        md: { base: 'h-[36px] text-[14px]!' },
                        lg: { base: 'h-[44px] text-[16px]!' },
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
        '#top-nav .theme-btn': {
            style: {
                border: 'none !important',
            },
        },
        '#top-header .theme-btn': {
            style: {
                border: 'none !important',
                minHeight: '36px',
                minWidth: '36px',
            },
        },
        '#top-nav .theme-btn .iconify': {
            style: {
                width: '20px',
                height: '20px',
            },
        },
    },
});
