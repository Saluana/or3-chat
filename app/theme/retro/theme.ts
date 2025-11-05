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
    description: 'Classic retro aesthetic with pixel-perfect styling and nostalgic vibes',

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
        'button': {
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

        // Chat context buttons
        'button.chat': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'sm',
        },

        // Sidebar buttons
        'button.sidebar': {
            class: 'retro-btn',
            variant: 'ghost',
            size: 'sm',
        },

        // Dashboard buttons
        'button.dashboard': {
            class: 'retro-btn',
            variant: 'soft',
            size: 'md',
        },

        // Global input styling
        'input': {
            class: 'retro-input',
            variant: 'outline',
            size: 'md',
        },

        // Chat context inputs
        'input.chat': {
            class: 'retro-input',
            size: 'sm',
        },

        // Textarea styling
        'textarea': {
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
