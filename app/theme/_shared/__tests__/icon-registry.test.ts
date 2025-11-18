import { describe, it, expect, beforeEach } from 'vitest';
import { IconRegistry } from '../icon-registry';
import { DEFAULT_ICONS } from '~/config/icon-tokens';

describe('IconRegistry', () => {
    let registry: IconRegistry;

    beforeEach(() => {
        registry = new IconRegistry(DEFAULT_ICONS);
    });

    it('resolves default icons correctly', () => {
        const icon = registry.resolve('ui.trash');
        expect(icon).toBe(DEFAULT_ICONS['ui.trash']);
    });

    it('resolves theme overrides correctly', () => {
        registry.registerTheme('custom-theme', {
            'ui.trash': 'custom:trash-icon',
        });
        registry.setActiveTheme('custom-theme');

        const icon = registry.resolve('ui.trash');
        expect(icon).toBe('custom:trash-icon');
    });

    it('falls back to default if theme override is missing', () => {
        registry.registerTheme('custom-theme', {
            'ui.edit': 'custom:edit-icon',
        });
        registry.setActiveTheme('custom-theme');

        // 'ui.trash' is not in the custom theme, should fallback
        const icon = registry.resolve('ui.trash');
        expect(icon).toBe(DEFAULT_ICONS['ui.trash']);
    });

    it('allows resolving for a specific theme ignoring active theme', () => {
        registry.registerTheme('theme-a', { 'ui.trash': 'theme-a:trash' });
        registry.registerTheme('theme-b', { 'ui.trash': 'theme-b:trash' });
        registry.setActiveTheme('theme-a');

        const iconA = registry.resolve('ui.trash');
        const iconB = registry.resolve('ui.trash', 'theme-b');

        expect(iconA).toBe('theme-a:trash');
        expect(iconB).toBe('theme-b:trash');
    });

    it('returns fallback icon for unknown tokens', () => {
        // @ts-ignore - Testing invalid token
        const icon = registry.resolve('invalid.token');
        expect(icon).toBe('pixelarticons:alert');
    });

    it('is reactive when a theme is registered after initial resolution', () => {
        const { computed } = require('vue');
        registry.setActiveTheme('late-theme');

        const icon = computed(() => registry.resolve('ui.trash'));

        // Initially falls back to default because 'late-theme' is not registered
        expect(icon.value).toBe(DEFAULT_ICONS['ui.trash']);

        // Register the theme
        registry.registerTheme('late-theme', {
            'ui.trash': 'late:trash-icon',
        });

        // Should update
        expect(icon.value).toBe('late:trash-icon');
    });

    it('hydrates state correctly', () => {
        const state = {
            themes: {
                'hydrated-theme': { 'ui.trash': 'hydrated:trash' },
            },
            activeTheme: 'hydrated-theme',
        };

        registry.hydrate(state);

        expect(registry.resolve('ui.trash')).toBe('hydrated:trash');
    });
});
