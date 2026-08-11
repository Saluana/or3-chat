import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyAccessibilityPreferences,
    DEFAULT_THEME_ACCESSIBILITY_PREFERENCES,
    normalizeThemeAccessibilityPreferences,
    useThemeAccessibilityPreferences,
} from '../useThemeAccessibilityPreferences';

describe('theme accessibility preferences', () => {
    let mediaListener: (() => void) | undefined;
    let mediaMatches = false;

    beforeEach(() => {
        delete (globalThis as any).__or3ThemeAccessibilityPreferences;
        localStorage.clear();
        document.documentElement.style.cssText = '';
        delete document.documentElement.dataset.motion;
        delete document.documentElement.dataset.motionResolved;
        mediaListener = undefined;
        mediaMatches = false;
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn(() => ({
                get matches() {
                    return mediaMatches;
                },
                addEventListener: (_event: string, listener: () => void) => {
                    mediaListener = listener;
                },
                removeEventListener: vi.fn(),
            })),
        });
    });

    afterEach(() => {
        delete (globalThis as any).__or3ThemeAccessibilityPreferences;
        vi.restoreAllMocks();
    });

    it('clamps focus width and rejects unknown motion values', () => {
        expect(
            normalizeThemeAccessibilityPreferences({
                focusRingWidthPx: 8,
                motion: 'unexpected',
            })
        ).toEqual({ focusRingWidthPx: 4, motion: 'system' });
        expect(normalizeThemeAccessibilityPreferences({ focusRingWidthPx: 0 })).toEqual(
            { focusRingWidthPx: 1, motion: 'system' }
        );
        expect(normalizeThemeAccessibilityPreferences(null)).toEqual(
            DEFAULT_THEME_ACCESSIBILITY_PREFERENCES
        );
    });

    it('applies the global settings and persists only on a user change', () => {
        const { preferences, set, reset } = useThemeAccessibilityPreferences();
        expect(localStorage.getItem('or3:user-theme-accessibility')).toBeNull();
        expect(preferences.value).toEqual(DEFAULT_THEME_ACCESSIBILITY_PREFERENCES);

        set({ focusRingWidthPx: 4, motion: 'reduced' });
        expect(document.documentElement.style.getPropertyValue('--app-focus-ring-width')).toBe('4px');
        expect(document.documentElement.dataset.motion).toBe('reduced');
        expect(document.documentElement.dataset.motionResolved).toBe('reduced');
        expect(JSON.parse(localStorage.getItem('or3:user-theme-accessibility')!)).toMatchObject({
            version: 1,
            focusRingWidthPx: 4,
            motion: 'reduced',
        });

        reset();
        expect(preferences.value).toEqual(DEFAULT_THEME_ACCESSIBILITY_PREFERENCES);
    });

    it('updates resolved System motion when the OS preference changes', () => {
        useThemeAccessibilityPreferences();
        expect(document.documentElement.dataset.motion).toBe('system');
        expect(document.documentElement.dataset.motionResolved).toBe('normal');

        expect(
            document.documentElement.style.getPropertyValue(
                '--app-motion-duration-fast'
            )
        ).toBe('');

        mediaMatches = true;
        mediaListener?.();
        expect(document.documentElement.dataset.motionResolved).toBe('reduced');
        expect(
            document.documentElement.style.getPropertyValue(
                '--app-motion-duration-fast'
            )
        ).toBe('100ms');
    });

    it('ignores data written by an unknown accessibility schema version', () => {
        localStorage.setItem(
            'or3:user-theme-accessibility',
            JSON.stringify({
                version: 99,
                focusRingWidthPx: 4,
                motion: 'reduced',
            })
        );

        const { preferences } = useThemeAccessibilityPreferences();
        expect(preferences.value).toEqual(
            DEFAULT_THEME_ACCESSIBILITY_PREFERENCES
        );
    });

    it('applies normalized values at the DOM boundary', () => {
        applyAccessibilityPreferences({
            focusRingWidthPx: 99,
            motion: 'system',
        });
        expect(document.documentElement.style.getPropertyValue('--app-focus-ring-width')).toBe('4px');
        expect(document.documentElement.dataset.motion).toBe('system');
    });
});
