/**
 * Professional Theme - Clean, Modern Aesthetic
 *
 * A sophisticated, minimalist design with contemporary styling:
 * - Subtle, refined color palette
 * - Modern soft shadows and elevation
 * - Clean typography and spacing
 * - Smooth, refined interactions
 *
 * All professional-specific styles are contained within this theme package and loaded
 * conditionally when the professional theme is active.
 */

import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
    name: 'pro',
    displayName: 'Professional (Default)',
    description:
        'Clean, modern professional aesthetic with refined interactions',
    isDefault: true,
    stylesheets: ['~/theme/professional/styles.css'],

    // Professional theme styling defaults
    borderWidth: '1px',
    borderRadius: '8px',

    // Modern color palette - refined and sophisticated
    // These will generate CSS variables for both light and dark modes
    colors: {
        // Primary colors - modern blue
        primary: '#0066cc',
        onPrimary: '#ffffff',
        primaryContainer: '#e6f0ff',
        onPrimaryContainer: '#003d99',

        // Secondary colors - modern slate
        secondary: '#5a6b7c',
        onSecondary: '#ffffff',
        secondaryContainer: '#e8eef5',
        onSecondaryContainer: '#1a2533',

        // Tertiary colors - modern teal accent
        tertiary: '#0d9488',
        onTertiary: '#ffffff',
        tertiaryContainer: '#ccf3ed',
        onTertiaryContainer: '#004d45',

        // Surface colors - light, clean backgrounds
        surface: '#fafbfc',
        onSurface: '#1a1d22',
        surfaceVariant: '#eaeef5',
        onSurfaceVariant: '#474d55',
        inverseSurface: '#2c3139',
        inverseOnSurface: '#f1f5fa',

        // Outline
        outline: '#73777f',

        // Semantic colors
        success: '#059669',
        warning: '#d97706',
        error: '#dc2626',

        // Dark mode overrides - modern dark
        dark: {
            primary: '#60a5fa',
            onPrimary: '#0f172a',
            primaryContainer: '#1e3a8a',
            onPrimaryContainer: '#bfdbfe',

            secondary: '#cbd5e1',
            onSecondary: '#0f172a',
            secondaryContainer: '#334155',
            onSecondaryContainer: '#e2e8f0',

            tertiary: '#2dd4bf',
            onTertiary: '#0f172a',
            tertiaryContainer: '#134e4a',
            onTertiaryContainer: '#ccf3ed',

            surface: '#0f1419',
            onSurface: '#f1f5fa',
            surfaceVariant: '#27292f',
            onSurfaceVariant: '#cad2db',
            inverseSurface: '#f1f5fa',
            inverseOnSurface: '#1a1d22',

            outline: '#92a0ad',

            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444',
        },
    },

    backgrounds: {},

    // Component overrides using the new selector syntax
    // These provide clean, modern styling for professional theme components
    overrides: {
        // Global button styling
        button: {
            class: 'pro-btn',
            variant: 'solid',
            size: 'md',
            ui: {
                base: 'shadow-none!',
            },
        },

        // Theme Settings: copy color button in palette/background sections
        'button#dashboard.theme.copy-color': {
            variant: 'ghost',
            size: 'sm',
        },

        // Shell/PageShell specific buttons
        'button#shell.sidebar-toggle': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.new-pane': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.theme-toggle': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#shell.pane-toggle': {
            class: 'pro-btn',
            size: 'xs',
        },

        'button#shell.pane-close': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
            color: 'error',
        },

        'button#shell.header-action': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        // Sidebar specific buttons
        'button#sidebar.toggle': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'xs',
        },

        'button#sidebar.new-chat': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#sidebar.new-document': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'sm',
        },

        'button#sidebar.new-project': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'sm',
        },
        // UI Glass Button (used in sidebar items)
        'button#ui.glass-button': {
            class: 'w-full bg-[var(--md-inverse-surface)]/10 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]',
            variant: 'ghost',
            size: 'md',
        },
        'button#sidebar.search-clear': {
            class: 'pro-btn',
            variant: 'subtle',
            size: 'xs',
        },

        'button#sidebar.filter': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'md',
        },

        // Sidebar thread item actions
        'button#sidebar.thread-rename': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.thread-add-to-project': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.thread-delete': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        'button#sidebar.thread-extra-action': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        // Sidebar project actions
        'button#sidebar.project-rename': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.project-delete': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        // Sidebar document item actions
        'button#sidebar.document-rename': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.document-add-to-project': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.document-delete': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        'button#sidebar.document-extra-action': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        // Sidebar project entry actions
        'button#sidebar.project-entry-rename': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'neutral',
        },

        'button#sidebar.project-entry-remove': {
            class: 'pro-btn',
            variant: 'popover',
            size: 'sm',
            color: 'error',
        },

        // Sidebar collapsed navigation
        'button#sidebar.collapsed-search': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'md',
        },

        'button#sidebar.collapsed-dashboard': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'md',
        },

        // Sidebar search input
        'input#sidebar.search': {
            variant: 'outline',
            size: 'md',
            ui: {
                root: 'shadow-none! border-0! bg-transparent! rounded-lg',
            },
        },
        'button#sidebar.footer-action': {
            class: ' pointer-events-auto',
            variant: 'ghost',
            size: 'xs',
        },

        'button#chat.send': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#chat.stop': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'error',
        },

        'button#chat.attach': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#chat.settings': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#chat.composer-action': {
            class: 'pro-btn',
            variant: 'ghost',
            size: 'sm',
        },

        'div#chat.input-main-container': {
            // Container styling can be customized here
            class: 'border-1 border(--md-inverse-surface) rounded-lg',
        },

        'div#chat.editor': {
            // Editor wrapper styling can be customized here
            class: '',
        },

        'button#chat.model-select': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'sm',
        },

        // Model select menu (USelectMenu component)
        'selectmenu#chat.model-select': {
            class: 'h-[32px] shadow-sm border border-(--md-outline) rounded-lg text-sm px-3 bg-white dark:bg-slate-900 w-full min-w-[100px] max-w-[320px]',
            ui: {
                content:
                    'border border-(--md-outline) rounded-lg w-[320px] shadow-md',
                input: 'border-0 rounded-none!',
                arrow: 'h-[18px] w-[18px]',
                itemTrailingIcon: 'shrink-0 w-[18px] h-[18px] text-dimmed',
            },
            searchInput: {
                icon: 'pixelarticons:search',
                ui: {
                    base: 'border-0 border-b border-(--md-outline)!',
                    leadingIcon: 'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
                },
            },
        },

        // Message action buttons (all buttons in message context)
        'button.message': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#message.copy': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#message.retry': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#message.branch': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#message.edit': {
            class: 'pro-btn flex items-center justify-center',
            variant: 'soft',
            size: 'sm',
            color: 'secondary',
        },

        'button#message.save-edit': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'success',
        },

        'button#message.cancel-edit': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'error',
        },

        'button#message.attachment-thumb': {
            // Attachment thumbnail button styling
            class: '',
        },

        'button#message.reasoning-toggle': {
            class: 'pro-btn',
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
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
        },

        'button#modal.new-prompt': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        'button#modal.clear-active': {
            class: 'pro-btn',
            variant: 'outline',
            size: 'sm',
            color: 'neutral',
        },

        'button#modal.select-prompt': {
            class: 'pro-btn',
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
            class: 'flex justify-between w-full items-center py-1 px-2 rounded-lg',
        },

        // Dashboard buttons
        'button.dashboard': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'md',
        },

        'button#dashboard.export': {
            class: 'pro-btn',
            variant: 'light',
            size: 'md',
        },

        'button#dashboard.import': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'md',
            color: 'primary',
        },

        // AI Page buttons
        'button#dashboard.ai.save-prompt': {
            class: 'pro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.model-mode': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.model-item': {
            class: 'pro-btn',
        },

        'button#dashboard.ai.clear-model': {
            class: 'pro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.ai.reset': {
            class: 'pro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'textarea#dashboard.ai.master-prompt': {
            class: 'w-full',
            ui: {
                textarea: '',
            },
        },

        // Theme Page buttons
        'button#dashboard.theme.mode': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.preset': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.remove-layer': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.repeat': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.gradient': {
            class: 'pro-chip',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.theme.reset-all': {
            class: 'pro-btn',
            variant: 'basic',
            size: 'sm',
        },

        // Workspace Backup buttons
        'button#dashboard.workspace.export': {
            class: 'pro-btn',
            variant: 'light',
        },

        'button#dashboard.workspace.browse': {
            class: 'pro-btn',
            variant: 'basic',
            size: 'sm',
        },

        'button#dashboard.workspace.clear-file': {
            class: 'pro-btn',
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
            class: 'pro-btn',
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
            class: 'border border-[var(--md-outline)] pro-shadow hover:border-[var(--md-primary)] hover:shadow-md transition-all rounded-lg',
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
                'bg-primary/15 text-(--md-primary) ring-1 ring-primary/30',

            ui: {
                base: 'border-0! shadow-none! rounded-lg p-1! text-(--md-on-surface)! hover:bg-(--md-surface-variant)/40',
            },
        },

        'button#document.search': {
            class: 'pro-btn',
            variant: 'soft',
            size: 'sm',
        },

        'button#document.retry': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'md',
            color: 'primary',
        },

        'button#document.search-retry': {
            class: 'pro-btn',
            variant: 'solid',
            size: 'sm',
            color: 'primary',
        },

        // Document inputs
        'input#document.title': {
            variant: 'outline',
            size: 'md',
            ui: {
                root: 'shadow-none! border-0! bg-transparent! rounded-lg px-2',
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
            class: 'pro-chip',
        },

        // Copy buttons (used in theme palette)
        'button[data-copy]': {
            class: 'pro-copy-btn',
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
        //     class: 'pro-shadow',
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
