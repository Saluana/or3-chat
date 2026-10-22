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
import { paletteOverrides, paletteCssSelectors } from './styles/palette';
import { shellOverrides } from './styles/shell';

// Every text field family shares one horizontal inset (12px); the leading and
// trailing icon slots move with it so icons and text keep the same edges.
const fieldInset = { base: 'px-3', leading: 'ps-3', trailing: 'pe-3' };
const fieldSizes = { sm: fieldInset, md: fieldInset };

export default defineTheme({
    name: 'blank',
    displayName: 'Blank theme',
    description: 'ChatGPT-inspired clean minimal theme',
    isDefault: false,

    borderWidthSubtle: '0px',
    borderWidth: '1px',
    borderWidthStrong: '0px',
    // Concentric tiers: controls (8) sit inside surfaces (14) with a 6px inset.
    borderRadiusSmall: '8px',
    borderRadius: '10px',
    borderRadiusLarge: '14px',
    density: {
        controlHeightSmall: '32px',
        controlHeightMedium: '36px',
        controlHeightLarge: '44px',
        spaceControl: '8px',
        spaceSection: '16px',
    },
    focus: {
        ringColor: 'var(--md-primary)',
        ringOffset: '2px',
    },
    motion: {
        durationFast: '120ms',
        durationMedium: '200ms',
        durationSlow: '300ms',
        // Fast start, soft landing: feedback reads as immediate, never abrupt.
        easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
    },
    elevation: {
        low: '0 1px 3px rgb(0 0 0 / 0.05)',
        medium: '0 2px 8px rgb(0 0 0 / 0.08)',
        high: '0 20px 64px rgb(15 23 42 / 0.16)',
    },
    stylesheets: ['~/theme/blank/styles.css'],
    customComponents: {
        'chat-input': './components/ChatInput.vue',
    },
    componentContractVersion: 1,
    chatEmptyState: {
        heading: false,
        description: false,
        hero: { src: '/bird-on-cloud.webp', width: 1536, height: 1024 },
        accent: false,
        background: { image: '/blank-chat-background.webp', fit: 'cover', repeat: 'no-repeat' },
        layout: 'cards',
        dark: {
            hero: { src: '/bird-on-cloud-dark.webp', width: 1536, height: 1024 },
            background: { image: '/blank-chat-bg-dark.webp', fit: 'cover', repeat: 'no-repeat', color: '#212121', opacity: 0.45 },
        },
    },
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

        // Neutral container ladder (replaces the blue-tinted global Material
        // ladder at the same lightness, so cards and table headers stay gray).
        surfaceContainerLowest: '#ffffff',
        surfaceContainerLow: '#f3f3f3',
        surfaceContainer: '#ededed',
        surfaceContainerHigh: '#e8e8e8',
        surfaceContainerHighest: '#e2e2e2',

        // Outline & borders
        outline: '#d9d9d9',
        outlineVariant: '#c6c6c6',
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

            // Neutral charcoal ladder so raised prompts/cards match the
            // sidebar and content surfaces (not the global navy-black).
            surfaceContainerLowest: '#1c1c1c',
            surfaceContainerLow: '#2a2a2a',
            surfaceContainer: '#2f2f2f',
            surfaceContainerHigh: '#333333',
            surfaceContainerHighest: '#383838',

            outline: '#555555',
            outlineVariant: '#474747',
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
        sidebar: { color: 'var(--md-surface)' },
    },

    fonts: {
        sans: 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        heading:
            'ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
        mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        baseSize: '16px',
        baseWeight: '400',
    },

    overrides: {
        input: {
            ui: {
                root: '',
                variants: {
                    variant: {
                        outline:
                            'text-highlighted bg-default ring-0 border-[color:var(--md-border-color)] focus-visible:ring-1 focus-visible:ring-[color:var(--md-on-surface)]/20',
                    },
                    size: {
                        sm: { base: 'h-[32px] text-[14px]! max-md:min-h-[40px]! max-md:text-[16px]!' },
                        md: { base: 'h-[36px] text-[14px]! max-md:min-h-[40px]! max-md:text-[16px]!' },
                        lg: { base: 'h-[44px] text-[16px]!' },
                    },
                },
            },
        },
        selectmenu: {
            ui: {
                base: 'text-[14px] leading-[20px] max-md:min-h-[40px]! max-md:text-[16px]!',
                value: 'text-[14px] max-md:text-[16px]!',
                placeholder: 'text-[14px] max-md:text-[16px]!',
                label: 'text-[14px] max-md:text-[16px]!',
                item: 'text-[14px] max-md:min-h-[40px]! max-md:text-[16px]!',
                itemLabel: 'text-[14px] max-md:text-[16px]!',
                content: 'text-[14px] max-md:text-[16px]!',
            },
        },

        ...chatOverrides,
        ...sidebarOverrides,
        ...dashboardOverrides,
        ...documentsOverrides,
        ...paletteOverrides,
        ...shellOverrides,
    },
    cssSelectors: {
        ...sidebarCssSelectors,
        ...chatCssSelectors,
        ...dashboardStyles,
        ...documentsStyles,
        ...paletteCssSelectors,
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
    },
    ui: {
        tooltip: {
            slots: {
                content:
                    'border-0 ring-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-on-surface)] text-[var(--md-surface)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] h-auto min-h-[28px] px-2.5 py-1.5 text-[12px] leading-4 font-medium',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] mb-2 bg-[var(--md-surface-hover)] text-[var(--md-on-surface)]',
                link: 'h-[var(--app-control-height-medium,36px)] text-[14px]! hover:bg-[var(--md-surface-active)] max-md:min-h-[40px]! max-md:text-[16px]!',
            },
        },
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/30 backdrop-blur-[1px]',
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-large,var(--md-border-radius))] ring-0 fixed divide-y-0 flex flex-col focus:outline-none shadow-[var(--app-elevation-high,0_12px_28px_rgba(0,0,0,0.12))] overflow-hidden bg-[var(--md-surface)]',
                body: 'px-6 py-6',
                header: 'relative flex shrink-0 items-center justify-between gap-4 px-6 py-5 border-b-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)]',
                title: 'text-[var(--md-on-surface)] font-semibold text-[20px]! leading-7',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center leading-none size-[44px] p-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent! hover:bg-[var(--md-surface-hover)]! text-[var(--md-on-surface-variant)]!',
            },
        },
        button: {
            slots: {
                base: [
                    'transition-[color,background-color,border-color,box-shadow,transform,scale] duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)]',
                    'cursor-pointer text-start rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
                    // Press feedback; `scale` composes with any positioning transform.
                    'motion-safe:active:not-disabled:not-aria-disabled:scale-[0.98]',
                ],
                label: 'truncate',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] border-0 hover:bg-[var(--md-surface-hover)]',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-0 shadow-none! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] text-[var(--md-on-surface)]',
                    popover:
                        'flex items-center! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] justify-start! border-0',
                    ghost: 'font-base border-0',
                    outline:
                        'border-[length:var(--md-border-width)] border-[color:rgba(0,0,0,0.15)] dark:border-[color:rgba(255,255,255,0.15)] ring-0! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
                },
                color: {
                    primary: 'text-[color:var(--md-on-primary)]',
                    'inverse-primary':
                        'bg-[var(--md-inverse-primary)] hover:bg-[var(--md-inverse-primary)]/80',
                    'on-surface':
                        'bg-[var(--md-surface)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                    error: 'text-[var(--md-on-error)] hover:bg-[var(--md-error-hover)] active:bg-[var(--md-error-active)]',
                },
                size: {
                    xs: { base: 'h-[24px] px-[8px]! text-[12px] max-md:min-h-[40px]! max-md:px-[14px]! max-md:text-[16px]!' },
                    sm: {
                        base: 'h-[var(--app-control-height-small,32px)] px-[12px]! text-[14px] max-md:min-h-[40px]! max-md:px-[14px]! max-md:text-[16px]!',
                        leadingIcon: 'shrink-0 h-4 w-4',
                        trailingIcon: 'shrink-0 h-4 w-4',
                    },
                    md: { base: 'h-[var(--app-control-height-medium,36px)] px-[14px]! text-[14px] max-md:min-h-[40px]! max-md:px-[16px]! max-md:text-[16px]!' },
                    lg: { base: 'h-[var(--app-control-height-large,44px)] px-[20px]! text-[16px]' },
                    'sb-square': {
                        base: 'h-[var(--app-control-height-medium,36px)] w-[var(--app-control-height-medium,36px)] text-[18px] max-md:min-h-[40px]! max-md:min-w-[40px]!',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[var(--app-control-height-medium,36px)] max-md:min-h-[40px]! max-md:text-[16px]!',
                        trailingIcon: 'shrink-0 h-5 w-5',
                        leadingIcon: 'shrink-0 h-5 w-5',
                    },
                },
                square: {
                    true: 'px-0! aspect-square! justify-center text-center',
                    false: '',
                },
                fieldGroup: {
                    horizontal:
                        'first:rounded-l-[var(--md-border-radius-small,var(--md-border-radius))]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[var(--md-border-radius-small,var(--md-border-radius))]!',
                    vertical:
                        'first:rounded-t-[var(--md-border-radius-small,var(--md-border-radius))]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[var(--md-border-radius-small,var(--md-border-radius))]!',
                },
            },
        },
        input: {
            slots: {
                base: 'border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent hover:border-[rgba(0,0,0,0.25)] ring-0! focus:outline-none! focus-visible:outline-none! focus:ring-0 focus:border-[rgba(0,0,0,0.3)] dark:border-[rgba(255,255,255,0.15)] dark:hover:border-[rgba(255,255,255,0.25)] dark:focus:border-[rgba(255,255,255,0.3)] dark:bg-transparent max-lg:text-[16px]!',
            },
            variants: {
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[var(--app-control-height-small,32px)] px-3! text-[14px] max-md:min-h-[40px]! max-md:text-[16px]!', leading: 'ps-3', trailing: 'pe-3' },
                    md: { base: 'h-[var(--app-control-height-medium,36px)] px-3! text-[14px] max-md:min-h-[40px]! max-md:text-[16px]!', leading: 'ps-3', trailing: 'pe-3' },
                },
            },
        },
        select: {
            slots: {
                base: 'min-h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] bg-transparent text-[var(--md-on-surface)] ring-0! focus:outline-none! focus-visible:outline-none! hover:border-[rgba(0,0,0,0.25)] focus:ring-1 focus:ring-[var(--md-primary)] dark:border-[rgba(255,255,255,0.15)] dark:hover:border-[rgba(255,255,255,0.25)] max-lg:text-[16px]! max-md:min-h-[40px]!',
                content: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] bg-[var(--md-surface)] text-[var(--md-on-surface)] ring-0! shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] dark:border-[rgba(255,255,255,0.08)]',
                item: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] data-highlighted:before:bg-[var(--md-surface-hover)] max-md:min-h-[40px]! max-md:text-[16px]!',
            },
            variants: { size: fieldSizes },
        },
        tabs: {
            slots: {
                trigger: 'text-[var(--md-on-surface-variant)] data-[state=active]:text-[var(--md-on-surface)] max-md:min-h-[40px]! max-md:text-[16px]!',
            },
            variants: {
                variant: {
                    pill: {
                        list: 'rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)]',
                        indicator: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] shadow-sm',
                        trigger: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
                    },
                    link: {
                        list: 'rounded-none bg-transparent',
                        indicator: 'rounded-full shadow-none',
                        trigger: 'rounded-none',
                    },
                },
            },
        },
        card: {
            slots: {
                root: 'rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] bg-[var(--md-surface-container-low)] ring-0! shadow-[var(--app-elevation-low,0_1px_3px_rgba(0,0,0,0.05))] dark:border-[rgba(255,255,255,0.08)]',
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col',
                label: 'text-[14px] leading-5 font-medium text-[var(--md-on-surface)] -mb-1 px-0 max-md:text-[16px]!',
                help: 'mt-1 text-[12px] leading-4 text-[var(--md-on-surface-variant)] px-0! max-md:text-[13px]!',
            },
        },
        fieldGroup: {
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
                root: 'border-0 rounded-[var(--md-border-radius-large,var(--md-border-radius))] shadow-lg',
                close: 'inline-flex items-center justify-center leading-none h-[var(--app-control-height-small,32px)] w-[var(--app-control-height-small,32px)] p-0 rounded-full max-md:min-h-[40px]! max-md:min-w-[40px]!',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-[var(--md-surface)] ring-0 rounded-[var(--md-border-radius-large,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))] p-1.5',
            },
        },
        switch: {
            slots: {
                root: 'relative flex items-start max-md:min-h-[40px] max-md:items-center',
                base: [
                    'inline-flex items-center shrink-0 rounded-full border-2 border-transparent focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)] data-[state=unchecked]:bg-accented',
                    'transition-[background] duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)]',
                ],
                container: 'flex items-center',
                thumb: 'group pointer-events-none rounded-full bg-default shadow-[var(--app-elevation-low,0_1px_3px_rgba(0,0,0,0.05))] ring-0 transition-transform duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] data-[state=unchecked]:translate-x-0 data-[state=unchecked]:rtl:-translate-x-0 flex items-center justify-center',
                icon: [
                    'absolute shrink-0 group-data-[state=unchecked]:text-dimmed opacity-0 size-10/12',
                    'transition-[color,opacity] duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)]',
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
                base: 'border-[length:var(--md-border-width)] border-[rgba(0,0,0,0.15)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent ring-0! focus:outline-none! focus-visible:outline-none! focus:ring-0 focus:border-[rgba(0,0,0,0.3)] dark:border-[rgba(255,255,255,0.15)] dark:focus:border-[rgba(255,255,255,0.3)] dark:bg-transparent max-lg:text-[16px]!',
            },
            variants: { size: { sm: { base: 'px-3 py-2' }, md: { base: 'px-3 py-2' } } },
        },
        selectMenu: {
            slots: {
                base: 'min-h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0 max-lg:text-[16px]! max-md:min-h-[40px]!',
                content:
                    'ring-0! border-[length:var(--md-border-width)]! border-[color:color-mix(in_srgb,var(--md-border-color)_45%,transparent)]! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] shadow-[var(--app-elevation-medium,0_2px_8px_rgba(0,0,0,0.08))]',
                // SelectMenu applies this slot to UInput's wrapper, not its input.
                input: 'border-0 rounded-none! focus:outline-none! focus-visible:outline-none! max-lg:text-[16px]! [&_input]:rounded-none! [&_input]:border-0! [&_input]:bg-transparent! [&_input]:shadow-none! [&_input]:ring-0!',
                arrow: 'h-[18px] w-[18px]',
                item: 'max-md:min-h-[40px]! max-md:text-[16px]!',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
            variants: { size: fieldSizes },
        },
    },
});
