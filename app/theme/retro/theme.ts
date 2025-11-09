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

export default defineTheme({
    name: 'retro',
    displayName: 'Retro (Default)',
    description:
        'Classic retro aesthetic with pixel-perfect styling and nostalgic vibes',
    isDefault: true,
    stylesheets: ['~/theme/retro/styles.css'],

    // Material Design 3 color palette for retro theme
    // These will generate CSS variables for both light and dark modes
    colors: {
        // Primary colors
        primary: '#4ecdc4',
        onPrimary: '#ffffff',
        primaryContainer: '#b2f5ea',
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
        surface: '#fefbff',
        onSurface: '#1a1c1e',
        surfaceVariant: '#dfe3eb',
        onSurfaceVariant: '#43474e',
        inverseSurface: '#2f3033',
        inverseOnSurface: '#f1f0f4',

        // Outline
        outline: '#73777f',

        // Semantic colors
        success: '#51cf66',
        warning: '#ffa94d',
        error: '#ff6b6b',

        // Dark mode overrides
        dark: {
            primary: '#4ecdc4',
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

            surface: '#1a1c1e',
            onSurface: '#e2e2e6',
            surfaceVariant: '#43474e',
            onSurfaceVariant: '#c3c7cf',
            inverseSurface: '#e2e2e6',
            inverseOnSurface: '#2f3033',

            outline: '#8d9199',

            success: '#51cf66',
            warning: '#ffa94d',
            error: '#ffb3b3',
        },
    },

    backgrounds: {
        content: {
            base: {
                image: '/bg-repeat.v2.webp',
                opacity: 0.08,
                repeat: 'repeat',
                size: '150px',
            },
            overlay: {
                image: '/bg-repeat-2.v2.webp',
                opacity: 0.125,
                repeat: 'repeat',
                size: '380px',
            },
        },
        sidebar: {
            image: '/sidebar-repeater.v2.webp',
            opacity: 0.1,
            repeat: 'repeat',
            size: '240px',
        },
        headerGradient: {
            image: '/gradient-x.webp',
            repeat: 'repeat',
            size: 'auto 100%',
        },
        bottomNavGradient: {
            image: '/gradient-x.webp',
            repeat: 'repeat',
            size: 'auto 100%',
        },
    },

    // Component overrides using the new selector syntax
    // These provide default styling for all retro-themed components
    overrides: {
        // Global button styling
        button: {
            class: 'retro-btn',
            variant: 'solid',
            size: 'md',
        },

        // Theme Settings: copy color button in palette/background sections
        'button#dashboard.theme.copy-color': {
            variant: 'ghost',
            size: 'sm',
        },

        // Shell/PageShell specific buttons
        'button#shell.sidebar-toggle': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.new-pane': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.theme-toggle': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.pane-toggle': {
            class: 'retro-btn',
            size: 'xs',
        },

        'button#shell.pane-close': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
            color: 'error',
        },

        'button#shell.header-action': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        // Sidebar specific buttons
        'button#sidebar.toggle': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#sidebar.new-chat': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#sidebar.new-document': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        'button#sidebar.new-project': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        'button#sidebar.search-clear': {
            class: 'retro-btn',
            variant: 'subtle',
            size: 'xs',
        },

        'button#sidebar.filter': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'md',
        },

        // Sidebar thread item actions
        'button#sidebar.thread-rename': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.thread-add-to-project': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.thread-delete': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        'button#sidebar.thread-extra-action': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        // Sidebar project actions
        'button#sidebar.project-rename': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.project-delete': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        // Sidebar document item actions
        'button#sidebar.document-rename': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.document-add-to-project': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.document-delete': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        'button#sidebar.document-extra-action': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        // Sidebar project entry actions
        'button#sidebar.project-entry-rename': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.project-entry-remove': {
            class: 'retro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        // Sidebar collapsed navigation
        'button#sidebar.collapsed-search': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'md',
        },

        'button#sidebar.collapsed-dashboard': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'md',
        },

        // Sidebar search input
        'input#sidebar.search': {
            variant: 'outline',
            size: 'md',
            ui: {
                root: 'shadow-none! border-0! bg-transparent! rounded-[3px]',
            },
        },
        'button#sidebar.footer-action': {
            class: 'retro-btn pointer-events-auto',
            variant: 'ghost',
            size: 'xs',
        },

        'button#chat.send': {
            class: 'retro-btn text-white! dark:text-black!',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#chat.stop': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'error',
        },

        'button#chat.attach': {
            class: 'retro-btn text-black dark:text-white flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#chat.settings': {
            class: 'retro-btn text-black dark:text-white flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#chat.composer-action': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'sm',
        },

        'div#chat.input-container': {
            // Container styling can be customized here
            class: '',
        },

        'div#chat.editor': {
            // Editor wrapper styling can be customized here
            class: '',
        },

        'button#chat.model-select': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        // Model select menu (USelectMenu component)
        'selectmenu#chat.model-select': {
            class: 'h-[32px] retro-shadow border-2 border-(--md-inverse-surface) rounded-[3px] text-sm px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px]',
            ui: {
                content:
                    'border-2 border-(--md-inverse-surface) rounded-[3px] w-[320px]',
                input: 'border-0 rounded-none!',
                arrow: 'h-[18px] w-[18px]',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
            searchInput: {
                icon: 'pixelarticons:search',
                ui: {
                    base: 'border-0 border-b-1 rounded-none!',
                    leadingIcon: 'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
                },
            },
        },

        // Message action buttons (all buttons in message context)
        'button.message': {
            class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#message.copy': {
            class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#message.retry': {
            class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#message.branch': {
            class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#message.edit': {
            class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
            variant: 'solid',
            size: 'sm',
            color: 'info',
        },

        'button#message.save-edit': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'success',
        },

        'button#message.cancel-edit': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'error',
        },

        'button#message.attachment-thumb': {
            // Attachment thumbnail button styling
            class: '',
        },

        'button#message.reasoning-toggle': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'sm',
        },

        'button#message.collapse-attachments': {
            class: 'text-xs underline',
        },

        'div#message.user-container': {
            // User message container styling
            class: '',
        },

        'div#message.assistant-container': {
            // Assistant message container styling
            class: '',
        },

        // Modal buttons (System Prompts Modal)
        'button.modal': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
        },

        'button#modal.new-prompt': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#modal.clear-active': {
            class: 'retro-btn',
            variant: 'outline',
            size: 'sm',
            color: 'neutral',
        },

        'button#modal.select-prompt': {
            class: 'retro-btn',
            size: 'sm',
        },

        // Settings switches (all switches in settings context)
        'switch.settings': {
            color: 'primary',
            class: 'w-full',
        },

        'switch#settings.web-search': {
            color: 'primary',
            class: 'w-full',
        },

        'switch#settings.thinking': {
            color: 'primary',
            class: 'w-full',
        },

        // Tool switches (dynamic - will match any tool)
        'switch#settings.tool-*': {
            color: 'primary',
            class: 'w-full',
        },

        // Settings buttons
        'button.settings': {
            variant: 'ghost',
            class: 'justify-between shadow-none! px-2! text-(--md-inverse-surface) border-x-0! border-t-0! border-b-1! last:border-b-0! rounded-none! w-full',
            ui: {
                trailingIcon: 'w-[20px] h-[20px] shrink-0',
            },
        },

        'button#settings.system-prompts': {
            variant: 'ghost',
            block: true,
            trailing: true,
            trailingIcon: 'pixelarticons:script-text',
            class: 'flex justify-between w-full items-center py-1 px-2 border-b',
        },

        'button#settings.model-catalog': {
            variant: 'ghost',
            block: true,
            trailing: true,
            trailingIcon: 'pixelarticons:android',
            class: 'flex justify-between w-full items-center py-1 px-2 rounded-[3px]',
        },

        // Dashboard buttons
        'button.dashboard': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'md',
        },

        'button#dashboard.export': {
            class: 'retro-btn',
            variant: 'light',
            size: 'md',
        },

        'button#dashboard.import': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'md',
            color: 'primary',
        },

        // AI Page buttons
        'button#dashboard.ai.save-prompt': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.model-mode': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.model-item': {
            class: 'retro-btn',
        },

        'button#dashboard.ai.clear-model': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.reset': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'textarea#dashboard.ai.master-prompt': {
            class: 'w-full',
            ui: {
                textarea: 'retro-input',
            },
        },

        // Theme Page buttons
        'button#dashboard.theme.mode': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.preset': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.remove-layer': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.repeat': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.gradient': {
            class: 'retro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.reset-all': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
        },

        // Workspace Backup buttons
        'button#dashboard.workspace.export': {
            class: 'retro-btn',
            variant: 'light',
        },

        'button#dashboard.workspace.browse': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.workspace.clear-file': {
            class: 'retro-btn',
            variant: 'basic',
            size: 'sm',
            color: 'error',
        },

        'button#dashboard.workspace.import-mode': {
            class: '',
            variant: 'ghost',
            color: 'primary',
        },

        'button#dashboard.workspace.import': {
            class: 'retro-btn',
            variant: 'light',
            color: 'primary',
        },

        // Dashboard navigation buttons
        'button#dashboard.back': {
            class: '',
            variant: 'subtle',
            color: 'primary',
            size: 'sm',
        },

        'button#dashboard.landing-page': {
            class: 'border-2 border-[var(--md-inverse-surface)] retro-shadow hover:border-[var(--md-primary)] hover:shadow-[2px_2px_0_var(--md-primary)] transition-all',
        },

        'button#dashboard.plugin-icon': {
            class: '',
        },

        // AI page input
        'input#dashboard.ai.model-search': {
            class: '',
            type: 'text',
        },

        // Document toolbar buttons
        'button#document.toolbar': {
            variant: 'ghost',
            size: 'sm',
            activeClass:
                'bg-primary/60 hover:bg-primary-60 text-(--md-on-surface) ring-2 ring-primary/30 shadow-md',

            ui: {
                base: 'border-0! shadow-none! rounded-[3px] p-1! text-(--md-on-surface)! hover:bg-(--md-surface-variant)/50',
            },
        },

        'button#document.search': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        'button#document.retry': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'md',
            color: 'primary',
        },

        'button#document.search-retry': {
            class: 'retro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        // Document inputs
        'input#document.title': {
            variant: 'outline',
            size: 'md',
            ui: {
                root: 'shadow-none! border-0! bg-transparent! rounded-[3px] px-2',
            },
        },

        // Document search result cards
        'card#document.search-result': {
            class: 'cursor-pointer hover:border-[var(--md-primary)] transition-colors',
        },

        // Global input styling
        input: {
            variant: 'outline',
            size: 'md',
        },

        // Sidebar inputs
        'input.sidebar': {
            size: 'md',
        },

        // Chat context inputs
        'input.chat': {
            size: 'sm',
        },

        // Dashboard inputs
        'input.dashboard': {
            size: 'sm',
        },

        // Textarea styling
        textarea: {},

        // Chip/toggle buttons
        'button[data-chip]': {
            class: 'retro-chip',
        },

        // Copy buttons (used in theme palette)
        'button[data-copy]': {
            class: 'retro-btn-copy',
        },
    },

    // CSS Selectors for direct DOM targeting
    // These target elements that can't easily be integrated with the component override system
    cssSelectors: {
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
