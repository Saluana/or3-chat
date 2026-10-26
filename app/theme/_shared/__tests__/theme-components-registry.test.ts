import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CORE_APP_COMPONENT_DEFAULTS,
    createThemeComponentMap,
} from '../theme-components-registry';
import { APP_THEME_COMPONENT_KEYS } from '../types';

describe('theme-components-registry', () => {
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
});
