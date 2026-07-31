import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CORE_APP_COMPONENT_DEFAULTS,
    createThemeComponentMap,
    invalidateThemeComponentCache,
} from '../theme-components-registry';
import { APP_THEME_COMPONENT_KEYS } from '../types';

describe('theme-components-registry', () => {
    beforeEach(() => {
        invalidateThemeComponentCache('blank');
        invalidateThemeComponentCache('retro');
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns default components when no custom config is provided', () => {
        const componentMap = createThemeComponentMap('blank');

        expect(componentMap).not.toBe(CORE_APP_COMPONENT_DEFAULTS);

        for (const key of APP_THEME_COMPONENT_KEYS) {
            expect(componentMap[key]).toBe(CORE_APP_COMPONENT_DEFAULTS[key]);
        }
    });

    it('returns an async override for a valid theme component path', () => {
        const componentMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });

        expect(componentMap['chat-input']).not.toBe(
            CORE_APP_COMPONENT_DEFAULTS['chat-input']
        );
        expect(componentMap.sidebar).toBe(CORE_APP_COMPONENT_DEFAULTS.sidebar);
        expect(componentMap['chat-message']).toBe(
            CORE_APP_COMPONENT_DEFAULTS['chat-message']
        );
    });

    it('warns and falls back to the default component for an invalid path', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const componentMap = createThemeComponentMap('blank', {
            'chat-message': './components/DoesNotExist.vue',
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(componentMap['chat-message']).toBe(
            CORE_APP_COMPONENT_DEFAULTS['chat-message']
        );
    });

    it('reuses the same async wrapper when the theme and key are unchanged', () => {
        const firstMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });
        const secondMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });

        expect(secondMap['chat-input']).toBe(firstMap['chat-input']);
    });

    it('invalidates only the requested theme cache entries', () => {
        const firstMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });

        invalidateThemeComponentCache('retro');

        const secondMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });

        expect(secondMap['chat-input']).toBe(firstMap['chat-input']);

        invalidateThemeComponentCache('blank');

        const thirdMap = createThemeComponentMap('blank', {
            'chat-input': './components/ChatInput.vue',
        });

        expect(thirdMap['chat-input']).not.toBe(firstMap['chat-input']);
    });
});
