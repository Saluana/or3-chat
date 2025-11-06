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

    // Component overrides using the new selector syntax
    // These provide default styling for all retro-themed components
    overrides: {
        // Global button styling
        button: {
            class: 'retro-btn',
            variant: 'solid',
            size: 'md',
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

        // Document toolbar buttons
        'button#document.toolbar': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'sm',
        },

        'button#document.search': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        // Global input styling
        input: {
            class: 'retro-input',
            variant: 'outline',
            size: 'md',
        },

        // Sidebar inputs
        'input.sidebar': {
            class: 'retro-input',
            size: 'md',
        },

        // Chat context inputs
        'input.chat': {
            class: 'retro-input',
            size: 'sm',
        },

        // Dashboard inputs
        'input.dashboard': {
            class: 'retro-input',
            size: 'sm',
        },

        // Textarea styling
        textarea: {
            class: 'retro-input',
        },

        // Chip/toggle buttons
        'button[data-chip]': {
            class: 'retro-chip',
        },

        // Copy buttons (used in theme palette)
        'button[data-copy]': {
            class: 'retro-btn-copy',
        },
    },
});
