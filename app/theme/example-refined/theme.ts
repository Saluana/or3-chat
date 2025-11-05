/**
 * Example Theme - Nature
 * 
 * This is an example theme showcasing the refined theme system DSL.
 * It demonstrates all major features including color palettes, overrides,
 * and dark mode support.
 */

import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
    name: 'nature',
    displayName: 'Nature',
    description: 'Organic green theme with natural tones inspired by forests and meadows',
    
    colors: {
        // Primary colors - Forest green
        primary: '#3f8452',
        onPrimary: '#ffffff',
        primaryContainer: '#c1f0cf',
        onPrimaryContainer: '#00210e',
        
        // Secondary colors - Earth tones
        secondary: '#5a7b62',
        onSecondary: '#ffffff',
        secondaryContainer: '#dce7e0',
        onSecondaryContainer: '#18291f',
        
        // Tertiary colors - Sky blue
        tertiary: '#4a7c83',
        onTertiary: '#ffffff',
        tertiaryContainer: '#cde8ef',
        onTertiaryContainer: '#051f24',
        
        // Error colors - Autumn red
        error: '#b5473c',
        onError: '#ffffff',
        errorContainer: '#ffdad4',
        onErrorContainer: '#410001',
        
        // Surface colors - Light cream
        surface: '#f5faf5',
        onSurface: '#181d18',
        surfaceVariant: '#dde5db',
        onSurfaceVariant: '#414941',
        inverseSurface: '#2d322d',
        inverseOnSurface: '#eff1ed',
        
        // Outline
        outline: '#717970',
        outlineVariant: '#c1c9bf',
        
        // App-specific
        success: '#4a9763',
        warning: '#c8931d',
        info: '#4a7c83',
        
        // Dark mode overrides
        dark: {
            primary: '#8dd29a',
            onPrimary: '#00391a',
            primaryContainer: '#1f5030',
            onPrimaryContainer: '#a9e8b7',
            
            secondary: '#b0ccb8',
            onSecondary: '#1c3426',
            secondaryContainer: '#334b3c',
            onSecondaryContainer: '#cce8d3',
            
            surface: '#0c130d',
            onSurface: '#e0e3df',
            surfaceVariant: '#414941',
            onSurfaceVariant: '#c1c9bf',
            inverseSurface: '#e0e3df',
            inverseOnSurface: '#2d322d',
            
            outline: '#8b938a',
            outlineVariant: '#414941',
        },
    },
    
    overrides: {
        // Global button overrides
        button: {
            variant: 'solid',
            size: 'md',
        },
        
        // Context-specific overrides
        'button.chat': {
            variant: 'ghost',
            size: 'sm',
            class: 'rounded-lg',
        },
        
        'button.sidebar': {
            variant: 'soft',
            size: 'sm',
        },
        
        // Identifier-specific overrides
        'button#chat.send': {
            variant: 'solid',
            color: 'primary',
            class: 'shadow-md hover:shadow-lg transition-shadow',
        },
        
        'button#sidebar.new-thread': {
            variant: 'solid',
            color: 'primary',
        },
        
        // State-based overrides
        'button:hover': {
            class: 'scale-105',
        },
        
        // HTML attribute targeting
        'button[type="submit"]': {
            variant: 'solid',
            color: 'primary',
        },
        
        // Input overrides
        input: {
            variant: 'outline',
            size: 'md',
        },
        
        'input.chat': {
            size: 'lg',
            class: 'rounded-xl',
        },
        
        // Modal overrides
        'modal.settings': {
            ui: {
                width: 'sm:max-w-2xl',
            },
        },
    },
    
    // Nuxt UI config extensions
    ui: {
        primary: 'green',
        gray: 'neutral',
    },
});
