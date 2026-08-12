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
import { paletteOverrides, paletteCssSelectors } from './styles/palette';
import { shellOverrides } from './styles/shell';

export default defineTheme({
    name: 'retro',
    displayName: 'Retro theme',
    description:
        'Classic retro aesthetic with pixel-perfect styling and nostalgic vibes',
    isDefault: false,
    stylesheets: ['~/theme/retro/styles.css'],
    borderWidthSubtle: '1px',
    borderWidth: '2px',
    borderWidthStrong: '2px',
    borderRadius: '3px',
    density: {
        controlHeightSmall: '32px',
        controlHeightMedium: '40px',
        controlHeightLarge: '56px',
        spaceControl: '8px',
        spaceSection: '16px',
    },
    focus: {
        ringColor: 'var(--md-primary)',
        ringOffset: '2px',
    },
    motion: {
        durationFast: '150ms',
        durationMedium: '200ms',
        durationSlow: '300ms',
        easingStandard: 'ease',
    },
    elevation: {
        low: '2px 2px 0 0 var(--md-surface-variant)',
        medium: '3px 3px 0 0 var(--md-border-color)',
        high: '4px 4px 0 0 var(--md-border-color)',
    },
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
        surfaceContainerLowest: '#F8FAFC',
        onSurface: '#022344',
        surfaceVariant: '#e5e7eb',
        onSurfaceVariant: '#43474e',
        inverseSurface: '#2f3033',
        inverseOnSurface: '#f1f0f4',

        // Outline & borders
        outline: '#73777f',
        borderColor: '#032640',

        // Semantic colors
        success: '#51cf66',
        // Dark enough to remain readable as text on white warning surfaces.
        warning: '#9A4D00',
        error: '#ff6b6b',
        onError: '#FFFFFF',
        errorHover: '#ff8787',
        errorActive: '#fa5252',
        info: '#E8F1F8',
        infoHover: '#DCEAF4',
        infoActive: '#C6DDEE',
        onInfo: '#000000',
        topHeaderBg: '#F1F3F5',

        // Dark mode overrides
        dark: {
            // Lifted vs surface (#1A1E23) so primary-as-text stays readable
            // (headings, active tabs, inspector eyebrows).
            primary: '#5BA3D4',
            primaryTint: '#8EC4E8',
            primaryShade: '#2C638B',
            onPrimary: '#FFFFFF',
            primaryContainer: '#1E3A52',
            onPrimaryContainer: '#D7ECF8',
            primaryBorder: '#577a94',
            primaryHover: '#6AADDA',
            primaryActive: '#4A8FBC',

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
            surfaceContainerLowest: '#111417',
            onSurface: '#e2e2e6',
            surfaceVariant: '#223344',
            // Lifted for dense panels / modals (quick-action subcopy, notes).
            onSurfaceVariant: '#D0D5DD',
            inverseSurface: '#e2e2e6',
            inverseOnSurface: '#2f3033',

            outline: '#8d9199',
            borderColor: '#577a94',

            info: '#111417',
            infoHover: '#1A1F23',
            infoActive: '#0C0E10',
            onInfo: '#DDE3E8',
            success: '#51cf66',
            warning: '#FFB86A',
            error: '#FF8A8A',
            onError: '#1A1E23',
            errorHover: '#FFA3A3',
            errorActive: '#FF6B6B',
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
        dark: {
            content: {
                base: {
                    opacity: 0.02,
                },
                overlay: {
                    opacity: 0.03,
                },
            },
            sidebar: {
                opacity: 0.04,
            },
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
        ...paletteOverrides,
        ...shellOverrides,
    },
    // CSS Selectors for direct DOM targeting
    // These target elements that can't easily be integrated with the component override system
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
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]! ring-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface)] text-[var(--md-on-surface)] shadow-lg h-[var(--app-control-height-medium,40px)] px-3 text-md',
            },
        },
        tree: {
            slots: {
                root: '',
                item: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] mb-2 theme-shadow bg-[var(--md-inverse-surface)]/5  backdrop-blur-sm text-[var(--md-on-surface)]',
                link: 'h-[var(--app-control-height-medium,40px)] text-[17px]! hover:bg-black/5 dark:hover:bg-white/5',
            },
        },
        // Global modal overrides
        modal: {
            slots: {
                overlay:
                    'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
                content:
                    'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-large,var(--md-border-radius))] ring-0 fixed divide-y divide-default flex flex-col focus:outline-none ',
                body: 'border-y-[length:var(--md-border-width-subtle,var(--md-border-width))] border-y-[color:var(--md-border-color)]  p-4',
                header: 'relative border-none bg-primary px-2! sm:px-3! py-0 sm:p-0 min-h-[50px] w-full justify-between flex items-center gap-2 text-[var(--md-on-primary)]!',
                // Press Start wraps poorly at modal widths; keep the readable retro face and clip overflow.
                title: 'text-[var(--md-on-primary)] font-vt323 font-semibold text-base! leading-tight min-w-0 flex-1 truncate',
                description: 'hidden',
                close: 'relative! top-auto! end-auto! flex items-center justify-center shrink-0',
            },
        },
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--app-motion-duration-fast,150ms)] ease-[var(--app-motion-easing-standard,ease)]',
                    'cursor-pointer text-start border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] theme-shadow retro-press',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                variant: {
                    light: 'theme-btn flex items-center justify-center bg-[var(--md-surface)] dark:bg-[var(--md-on-background)] dark:text-black dark:hover:bg-[var(--md-on-background)]/90 backdrop-blur-sm',
                    subtle: 'border-none! shadow-none! bg-transparent! ring-0!',
                    basic: 'border-[length:var(--md-border-width)] shadow-none! drop-shadow-none!  hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-[color:var(--md-border-color)] text-[var(--md-on-surface)]',
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
                // Override size variant so padding wins over defaults
                size: {
                    xs: { base: 'h-[24px] px-[8px]! text-[12px]' },
                    sm: {
                        base: 'h-[var(--app-control-height-small,32px)] px-[12px]! text-[15px]',
                        leadingIcon: 'shrink-0 h-5 w-5',
                        trailingIcon: 'shrink-0 h-5 w-5',
                    },
                    md: { base: 'h-[var(--app-control-height-medium,40px)] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[var(--app-control-height-large,56px)] px-[24px]! text-[24px]' },
                    'sb-square': {
                        base: 'h-[var(--app-control-height-medium,40px)] w-[var(--app-control-height-medium,40px)] text-[20px]',
                        trailingIcon: 'shrink-0 h-6 w-6',
                        leadingIcon: 'shrink-0 h-6 w-6',
                    },
                    'sb-base': {
                        base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] border-0! shadow-none! text-[var(--md-on-surface)] h-[var(--app-control-height-medium,40px)]',
                        trailingIcon: 'shrink-0 h-6 w-6',
                        leadingIcon: 'shrink-0 h-6 w-6',
                    },
                },
                square: {
                    true: 'px-0! aspect-square! justify-center text-center',
                    false: '',
                },
                fieldGroup: {
                    horizontal:
                        'first:rounded-l-[var(--md-border-radius)]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[var(--md-border-radius)]!',
                    vertical:
                        'first:rounded-t-[var(--md-border-radius)]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[var(--md-border-radius)]!',
                },
            },
            compoundVariants: [
                // Override neutral + soft variant to use theme colors instead of accented
                {
                    color: 'neutral',
                    variant: 'soft',
                    class: 'bg-[var(--md-surface-container-lowest)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
                },
                // Ghost/soft error must use the error hue itself — on-error is for filled faces.
                {
                    color: 'error',
                    variant: 'ghost',
                    class: 'text-[var(--md-error)]! hover:bg-[var(--md-error)]/15 active:bg-[var(--md-error)]/25',
                },
                {
                    color: 'error',
                    variant: 'soft',
                    class: 'bg-[var(--md-error)]/18 text-[var(--md-error)]! hover:bg-[var(--md-error)]/28',
                },
            ],
        },
        // Global input overrides
        input: {
            slots: {
                base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! max-lg:text-[16px]!',
            },
            variants: {
                variant: {
                    outline:
                        'text-highlighted bg-default ring-0 retro-shadow',
                },
                // When using leading/trailing icons, bump padding so text/placeholder doesn't overlap the icon
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[var(--app-control-height-small,32px)] text-[12px]!' },
                    md: { base: 'h-[var(--app-control-height-medium,40px)] text-[14px]!' },
                    lg: { base: 'h-[var(--app-control-height-large,48px)] text-[16px]!' },
                },
            },
        },
        select: {
            slots: {
                base: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)] ring-0! focus:outline-none! focus-visible:outline-none! retro-shadow max-lg:text-[16px]!',
                content: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)] ring-0! theme-shadow',
                item: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] data-highlighted:before:bg-[var(--md-surface-hover)]',
            },
        },
        tabs: {
            slots: {
                trigger: 'text-[var(--md-on-surface-variant)] data-[state=active]:text-[var(--md-on-surface)]',
            },
            variants: {
                variant: {
                    pill: {
                        list: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface-container-low)]',
                        indicator: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] theme-shadow',
                        trigger: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
                    },
                    link: {
                        list: 'rounded-none bg-transparent',
                        indicator: 'rounded-none shadow-none',
                        trigger: 'rounded-none border-0! shadow-none!',
                    },
                },
            },
        },
        card: {
            slots: {
                root: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface-container-low)] ring-0! theme-shadow',
            },
        },
        checkbox: {
            slots: {
                root: 'relative flex items-center',
                base: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] ring-0! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
            },
            variants: {
                size: {
                    xs: {
                        base: 'size-[20px]',
                        container: 'h-[22px]',
                    },
                    sm: {
                        base: 'size-[24px]',
                        container: 'h-[26px]',
                    },
                    md: {
                        base: 'size-[28px]',
                        container: 'h-[30px]',
                    },
                    lg: {
                        base: 'size-[32px]',
                        container: 'h-[34px]',
                    },
                    xl: {
                        base: 'size-[36px]',
                        container: 'h-[38px]',
                    },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col ',
                label: 'text-sm font-medium -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        fieldGroup: {
            base: 'relative border-none',
            variants: {
                orientation: {
                    horizontal: 'inline-flex -space-x-px',
                    vertical: 'flex flex-col -space-y-px',
                },
            },
        },
        // Make the toast close button md-sized by default
        toast: {
            slots: {
                root: 'border-[length:var(--md-border-width)] rounded-[var(--md-border-radius)]',
                // Match our md button height (40px) and enforce perfect centering
                close: 'inline-flex items-center justify-center leading-none h-[var(--app-control-height-small,32px)] w-[var(--app-control-height-small,32px)] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-white ring-0 dark:bg-black rounded-[var(--md-border-radius)] border-[color:var(--md-border-color)] border-[length:var(--md-border-width)] p-0.5',
            },
        } /*
        tooltip: {
            slots: {
                content: 'border-[var(--md-border-width)] text-[18px]',
            },
        },*/,
        switch: {
            // Retro styled switch theme (square, hard borders, pixel shadow)
            slots: {
                root: 'relative flex items-start',
                base: [
                    'inline-flex items-center shrink-0 rounded-full border-2 border-transparent focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)] data-[state=unchecked]:bg-accented',
                    'transition-[background] duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)]',
                ],
                container: 'flex items-center',
                thumb: 'group pointer-events-none rounded-full bg-default shadow-lg ring-0 transition-transform duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] data-[state=unchecked]:translate-x-0 data-[state=unchecked]:rtl:-translate-x-0 flex items-center justify-center',
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
                base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! max-lg:text-[16px]!',
            },
        },
        selectMenu: {
            slots: {
                base: 'rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] max-lg:text-[16px]!',
                content:
                    'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)]',
                input: 'border-0 rounded-none! focus:outline-none! focus-visible:outline-none! retro-shadow-none max-lg:text-[16px]!',
                arrow: 'h-[18px] w-[18px]',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
        },
    },
});
