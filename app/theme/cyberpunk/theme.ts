/**
 * Cyberpunk Theme for Or3 Chat
 *
 * Neon-drenched, dark-surface aesthetic inspired by cyberpunk game UIs.
 * Electric cyan primary, hot red secondary, neon yellow tertiary.
 * Angular borders, subtle glow effects, monospace-accented typography.
 *
 * Scoped to [data-theme="cyberpunk"] to prevent style leakage.
 */

import { defineTheme } from '~/theme/_shared/define-theme';
import { sidebarOverrides, sidebarCssSelectors } from './styles/sidebar';
import { chatOverrides, chatCssSelectors } from './styles/chat';
import { dashboardOverrides, dashboardStyles } from './styles/dashboard';
import { documentsOverrides, documentsStyles } from './styles/documents';
import { paletteOverrides, paletteCssSelectors } from './styles/palette';

const lightModeBackground = new URL(
    './assets/lightmode-cyberpunk-bg.png',
    import.meta.url
).href;
const cyberpunkBackground = new URL('./assets/cyberpunk.png', import.meta.url)
    .href;
const cyberpunkSidebarBackground = new URL(
    './assets/cybersb2.png',
    import.meta.url
).href;

export default defineTheme({
    name: 'cyberpunk',
    displayName: 'Cyberpunk',
    description:
        'Neon-drenched dark theme with electric cyan, hot red accents, and angular UI inspired by cyberpunk game interfaces',
    isDefault: false,
    stylesheets: ['./styles.css'],
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
                image: lightModeBackground,
                opacity: 0.85,
                fit: 'cover',
            },
        },
        sidebar: {
            image: cyberpunkBackground,
            opacity: 0.35,
            fit: 'cover',
        },
        dark: {
            content: {
                base: {
                    image: cyberpunkBackground,
                    opacity: 0.29,
                    fit: 'cover',
                },
            },
            sidebar: {
                image: cyberpunkSidebarBackground,
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
        ...paletteOverrides,
    },

    cssSelectors: {
        ...sidebarCssSelectors,
        ...chatCssSelectors,
        ...dashboardStyles,
        ...documentsStyles,
        ...paletteCssSelectors,
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
    ui: {
        tooltip: {
            slots: {
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]! ring-0 rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[var(--md-on-surface)] shadow-lg h-[36px] px-3 text-sm',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-[var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] mb-2 theme-shadow bg-[var(--md-inverse-surface)]/5 backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[36px] text-[14px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/60 backdrop-blur-sm dark:bg-black/80',
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] ring-0 fixed divide-y divide-default flex flex-col focus:outline-none',
                body: 'border-y-[length:var(--md-border-width)] border-y-[color:var(--md-border-color)] p-4',
                header: 'relative border-none bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[44px] w-full justify-between flex items-center text-[var(--md-on-primary)]!',
                title: 'text-[var(--md-on-primary)] font-semibold text-base! font-mono uppercase tracking-wider',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center',
            },
        },
        button: {
            slots: {
                base: [
                    'transition-colors duration-150',
                    'cursor-pointer text-start border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
                ],
                label: 'truncate tracking-wide',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] dark:bg-[var(--md-on-background)] dark:text-black dark:hover:bg-[var(--md-on-background)]/90 backdrop-blur-sm',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-[var(--md-border-width)] shadow-none! drop-shadow-none! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-[color:var(--md-border-color)] text-[var(--md-on-surface)]',
                    popover:
                        'flex items-center! hover:bg-[var(--md-primary)]/5 active:bg-[var(--md-primary)]/10 justify-start!',
                    ghost: 'font-base border-none shadow-none! [--tw-shadow:none] items-center justify-center',
                    outline:
                        'border-[color:var(--md-border-color)] border-[length:var(--md-border-width)] ring-0! hover:shadow hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
                },
                color: {
                    info: 'bg-info hover:bg-[var(--md-info-hover)] active:bg-[var(--md-info-active)]',
                    primary: 'text-[color:var(--md-on-primary)]',
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] text-tertiary-foreground hover:backdrop-blur-sm hover:bg-[var(--md-inverse-primary)]/80',
                    'on-surface':
                        'bg-[var(--md-surface)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                    error: 'text-[var(--md-on-error)] hover:bg-[var(--md-error-hover)] active:bg-[var(--md-error-active)]',
                    neutral: 'bg-[var(--md-surface-container-lowest)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                },
                size: {
                    xs: { base: 'h-[24px] px-[8px]! text-[12px]' },
                    sm: {
                        base: 'h-[32px] px-[12px]! text-[13px]',
                        leadingIcon: 'shrink-0 h-4 w-4',
                        trailingIcon: 'shrink-0 h-4 w-4',
                    },
                    md: { base: 'h-[36px] px-[14px]! text-[14px]' },
                    lg: { base: 'h-[48px] px-[20px]! text-[18px]' },
                    'sb-square': {
                        base: 'h-[36px] w-[36px] text-[18px]',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[36px]',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    square: {
                        true: 'px-0! aspect-square!',
                        false: '',
                    },
                },
                buttonGroup: {
                    horizontal:
                        'first:rounded-l-[var(--md-border-radius)]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[var(--md-border-radius)]!',
                    vertical:
                        'first:rounded-t-[var(--md-border-radius)]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[var(--md-border-radius)]!',
                },
            },
            compoundVariants: [
                {
                    color: 'neutral',
                    variant: 'soft',
                    class: 'bg-[var(--md-surface-variant)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                },
            ],
        },
        input: {
            slots: {
                base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:outline-none! focus-visible:outline-none! focus:ring-1 focus:ring-[color:var(--md-primary)]',
            },
            variants: {
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[13px]' },
                    md: { base: 'h-[36px] px-[14px]! text-[14px]' },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col',
                label: 'text-xs font-medium uppercase tracking-wider -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-primary)] px-1!',
            },
        },
        buttonGroup: {
            base: 'relative',
            variants: {
                orientation: {
                    horizontal: 'inline-flex -space-x-px',
                    vertical: 'flex flex-col -space-y-px',
                },
            },
        },
        toast: {
            slots: {
                root: 'border-[length:var(--md-border-width)] rounded-[var(--md-border-radius)]',
                close: 'inline-flex items-center justify-center leading-none h-[28px] w-[28px] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-[var(--md-surface)] ring-0 rounded-[var(--md-border-radius)] border-[color:var(--md-border-color)] border-[length:var(--md-border-width)] p-0.5',
            },
        },
        switch: {
            slots: {
                root: 'relative flex items-start',
                base: [
                    'inline-flex items-center shrink-0 rounded-full border-2 border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=unchecked]:bg-accented',
                    'transition-[background] duration-200',
                ],
                container: 'flex items-center',
                thumb: 'group pointer-events-none rounded-full bg-default shadow-lg ring-0 transition-transform duration-200 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:rtl:-translate-x-0 flex items-center justify-center',
                icon: [
                    'absolute shrink-0 group-data-[state=unchecked]:text-dimmed opacity-0 size-10/12',
                    'transition-[color,opacity] duration-200',
                ],
                wrapper: 'ms-2',
                label: 'block font-medium text-default',
                description: 'text-muted',
            },
            variants: {
                size: {
                    xs: {
                        base: 'w-7',
                        container: 'h-4',
                        thumb: 'size-3 data-[state=checked]:translate-x-3 data-[state=checked]:rtl:-translate-x-3',
                        wrapper: 'text-xs',
                    },
                    sm: {
                        base: 'w-8',
                        container: 'h-4',
                        thumb: 'size-3.5 data-[state=checked]:translate-x-3.5 data-[state=checked]:rtl:-translate-x-3.5',
                        wrapper: 'text-xs',
                    },
                    md: {
                        base: 'w-9',
                        container: 'h-5',
                        thumb: 'size-4 data-[state=checked]:translate-x-4 data-[state=checked]:rtl:-translate-x-4',
                        wrapper: 'text-sm',
                    },
                },
            },
        },
        textarea: {
            slots: {
                base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:outline-none! focus-visible:outline-none! focus:ring-1 focus:ring-[color:var(--md-primary)]',
            },
        },
        selectMenu: {
            slots: {
                base: 'rounded-[var(--md-border-radius)] border-[var(--md-border-width)] border-[color:var(--md-border-color)]',
                content:
                    'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)]',
                input: 'border-0 rounded-none! focus:outline-none! focus-visible:outline-none!',
                arrow: 'h-[16px] w-[16px]',
                itemTrailingIcon: 'shrink-0 w-[16px] h-[16px] text-dimmed',
            },
        },
    },
});
