import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUserThemeOverrides } from '../useUserThemeOverrides';
import type {
    UserFontChoice,
    UserThemeOverrides,
} from '../user-overrides-types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

// Mock global objects
const setupBrowserMocks = () => {
    Object.defineProperty(global, 'window', {
        value: {},
        writable: true,
    });
    Object.defineProperty(global, 'localStorage', {
        value: localStorageMock,
        writable: true,
    });
    Object.defineProperty(global, 'document', {
        value: {
            documentElement: {
                className: '',
                style: {
                    setProperty: vi.fn(),
                    removeProperty: vi.fn(),
                    getPropertyValue: vi.fn(() => ''),
                },
            },
        },
        writable: true,
    });
    // Mock MutationObserver
  global.MutationObserver = vi.fn().mockImplementation(function () {
    return {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
  });
};

describe('useUserThemeOverrides', () => {
    beforeEach(() => {
        // Force delete the singleton completely
        const g: any = globalThis;
        g.__or3UserThemeOverrides?.stopWatch?.();
        g.__or3UserThemeOverrides?.observer?.disconnect?.();
        if (g.__or3UserThemeOverrides?.persistTimer) {
            clearTimeout(g.__or3UserThemeOverrides.persistTimer);
        }
        delete g.__or3UserThemeOverrides;

        setupBrowserMocks();
        localStorageMock.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('initializes with empty overrides when no data exists', () => {
        const { overrides } = useUserThemeOverrides();
        expect(overrides.value).toBeDefined();
        expect(overrides.value.colors?.enabled).toBeFalsy();
        expect(overrides.value.backgrounds?.enabled).toBeFalsy();
    });

    // Note: This test may fail when run with others due to singleton state sharing
    // Run in isolation: bunx vitest run app/core/theme/__tests__/user-overrides.test.ts -t "overrides load"
    it('overrides load from localStorage on init', () => {
        // Completely reset for this test
        delete (globalThis as any).__or3UserThemeOverrides;
        localStorageMock.clear();

        const testData: UserThemeOverrides = {
            colors: { enabled: true, primary: '#00ff00' },
            backgrounds: { enabled: false },
            typography: { baseFontPx: 22 },
            ui: {},
        };

        localStorageMock.setItem(
            'or3:user-theme-overrides:light',
            JSON.stringify(testData)
        );

        const { overrides } = useUserThemeOverrides();
        expect(overrides.value.colors?.primary).toBe('#00ff00');
        expect(overrides.value.typography?.baseFontPx).toBe(22);
    });

    it('set() merges partial updates correctly', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({ colors: { enabled: true, primary: '#ff0000' } });

        expect(overrides.value.colors?.enabled).toBe(true);
        expect(overrides.value.colors?.primary).toBe('#ff0000');
    });

    it('set() persists to localStorage through one debounced write', async () => {
        vi.useFakeTimers();
        const { set, activeMode } = useUserThemeOverrides();

        set({ typography: { baseFontPx: 18 } });
        await vi.advanceTimersByTimeAsync(60);

        const key = `or3:user-theme-overrides:${activeMode.value}`;
        const stored = localStorageMock.getItem(key);
        expect(stored).toBeTruthy();

        const parsed = JSON.parse(stored!);
        expect(parsed.typography?.baseFontPx).toBe(18);
        vi.useRealTimers();
    });

    it('switchMode() toggles between light/dark', () => {
        const { switchMode, activeMode } = useUserThemeOverrides();

        expect(activeMode.value).toBe('light');
        switchMode('dark');
        expect(activeMode.value).toBe('dark');
        switchMode('light');
        expect(activeMode.value).toBe('light');
    });

    it('separate light/dark profiles maintained', () => {
        const { set, switchMode, overrides } = useUserThemeOverrides();

        // Set light mode data
        set({ colors: { enabled: true, primary: '#light' } });
        expect(overrides.value.colors?.primary).toBe('#light');

        // Switch to dark and set different data
        switchMode('dark');
        set({ colors: { enabled: true, primary: '#dark' } });
        expect(overrides.value.colors?.primary).toBe('#dark');

        // Switch back to light and verify data preserved
        switchMode('light');
        expect(overrides.value.colors?.primary).toBe('#light');
    });

    it('keeps tiered shape overrides separate per color mode', () => {
        const { set, switchMode, overrides } = useUserThemeOverrides();

        set({
            shape: {
                enabled: true,
                borderWidthSubtlePx: 0.5,
                borderRadiusLargePx: 20,
            },
        });

        switchMode('dark');
        set({
            shape: {
                enabled: true,
                borderWidthStrongPx: 4,
                borderRadiusSmallPx: 2,
            },
        });
        expect(overrides.value.shape?.borderWidthStrongPx).toBe(4);
        expect(overrides.value.shape?.borderWidthSubtlePx).toBeUndefined();

        switchMode('light');
        expect(overrides.value.shape?.borderWidthSubtlePx).toBe(0.5);
        expect(overrides.value.shape?.borderRadiusLargePx).toBe(20);
        expect(overrides.value.shape?.borderWidthStrongPx).toBeUndefined();
    });

    it('reset() clears only active mode', () => {
        const { set, reset, switchMode, overrides } = useUserThemeOverrides();

        // Set data in both modes
        set({ colors: { primary: '#light' } });
        switchMode('dark');
        set({ colors: { primary: '#dark' } });

        // Reset dark mode
        reset();
        expect(overrides.value.colors?.primary).toBeUndefined();

        // Verify light mode still has data
        switchMode('light');
        expect(overrides.value.colors?.primary).toBe('#light');
    });

    it('resetAll() clears both modes', () => {
        const { set, resetAll, switchMode, light, dark } =
            useUserThemeOverrides();

        // Set data in both modes
        set({ colors: { primary: '#light' } });
        switchMode('dark');
        set({ colors: { primary: '#dark' } });

        // Reset all
        resetAll();

        // Verify both cleared - use the refs directly
        expect(dark.value?.colors?.primary).toBeUndefined();
        switchMode('light');
        expect(light.value?.colors?.primary).toBeUndefined();
    });

    it('deep merge preserves unmodified sections', () => {
        const { set, overrides } = useUserThemeOverrides();

        // Set initial data
        set({
            colors: { enabled: true, primary: '#red', secondary: '#blue' },
            typography: { baseFontPx: 20 },
        });

        // Update only primary color
        set({ colors: { primary: '#green' } });

        // Verify secondary and typography preserved
        expect(overrides.value.colors?.secondary).toBe('#blue');
        expect(overrides.value.typography?.baseFontPx).toBe(20);
        expect(overrides.value.colors?.primary).toBe('#green');
    });

    it('validates baseFontPx range (14-24)', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({ typography: { baseFontPx: 30 } });
        expect(overrides.value.typography?.baseFontPx).toBe(24); // clamped to max

        set({ typography: { baseFontPx: 10 } });
        expect(overrides.value.typography?.baseFontPx).toBe(14); // clamped to min

        set({ typography: { baseFontPx: 18 } });
        expect(overrides.value.typography?.baseFontPx).toBe(18); // valid value
    });

    it('accepts supported font choices and rejects unknown values', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({
            typography: {
                bodyFont: 'ibm-plex-sans',
                headingFont: 'press-start-2p',
            },
        });
        expect(overrides.value.typography?.bodyFont).toBe('ibm-plex-sans');
        expect(overrides.value.typography?.headingFont).toBe('press-start-2p');

        set({
            typography: {
                bodyFont: 'unknown-font' as UserFontChoice,
            },
        });
        expect(overrides.value.typography?.bodyFont).toBe('ibm-plex-sans');
    });

    it('validates shared shape ranges', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({
            shape: {
                enabled: true,
                borderWidthSubtlePx: 20,
                borderWidthPx: 20,
                borderWidthStrongPx: 20,
                borderRadiusSmallPx: 80,
                borderRadiusPx: 80,
                borderRadiusLargePx: 80,
            },
        });
        expect(overrides.value.shape?.borderWidthSubtlePx).toBe(6);
        expect(overrides.value.shape?.borderWidthPx).toBe(6);
        expect(overrides.value.shape?.borderWidthStrongPx).toBe(6);
        expect(overrides.value.shape?.borderRadiusSmallPx).toBe(32);
        expect(overrides.value.shape?.borderRadiusPx).toBe(32);
        expect(overrides.value.shape?.borderRadiusLargePx).toBe(32);

        set({
            shape: {
                borderWidthSubtlePx: -1,
                borderWidthPx: -1,
                borderWidthStrongPx: -1,
                borderRadiusSmallPx: -4,
                borderRadiusPx: -4,
                borderRadiusLargePx: -4,
            },
        });
        expect(overrides.value.shape?.borderWidthSubtlePx).toBe(0);
        expect(overrides.value.shape?.borderWidthPx).toBe(0);
        expect(overrides.value.shape?.borderWidthStrongPx).toBe(0);
        expect(overrides.value.shape?.borderRadiusSmallPx).toBe(0);
        expect(overrides.value.shape?.borderRadiusPx).toBe(0);
        expect(overrides.value.shape?.borderRadiusLargePx).toBe(0);
    });

    it('accepts documented density and elevation presets and rejects unknown ones', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({
            density: { enabled: true, preset: 'comfortable' },
            elevation: { enabled: true, preset: 'flat' },
        });
        expect(overrides.value.density).toEqual({
            enabled: true,
            preset: 'comfortable',
        });
        expect(overrides.value.elevation).toEqual({
            enabled: true,
            preset: 'flat',
        });

        set({
            density: { preset: 'unknown' as any },
            elevation: { preset: 'raised' as any },
        });
        expect(overrides.value.density?.preset).toBe('comfortable');
        expect(overrides.value.elevation?.preset).toBe('flat');
    });

    it('drops invalid stored appearance preset values at the storage boundary', () => {
        localStorageMock.setItem(
            'or3:user-theme-overrides:light',
            JSON.stringify({
                density: { enabled: true, preset: 'unknown' },
                elevation: { enabled: 'yes', preset: 'raised' },
            })
        );
        delete (globalThis as any).__or3UserThemeOverrides;

        const { overrides } = useUserThemeOverrides();
        expect(overrides.value.density?.preset).toBeUndefined();
        expect(overrides.value.elevation?.preset).toBeUndefined();
        expect(overrides.value.elevation?.enabled).toBeUndefined();
    });

    it('validates opacity range (0-1)', () => {
        const { set, overrides } = useUserThemeOverrides();

        set({ backgrounds: { content: { base: { opacity: 1.5 } } } });
        expect(overrides.value.backgrounds?.content?.base?.opacity).toBe(1);

        set({ backgrounds: { content: { base: { opacity: -0.5 } } } });
        expect(overrides.value.backgrounds?.content?.base?.opacity).toBe(0);

        set({ backgrounds: { content: { base: { opacity: 0.5 } } } });
        expect(overrides.value.backgrounds?.content?.base?.opacity).toBe(0.5);
    });

    it('handles quota exceeded error gracefully', async () => {
        vi.useFakeTimers();
        const add = vi.fn();
        vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        });

        const { set } = useUserThemeOverrides();
        (globalThis as any).__or3UserThemeOverrides.toast = { add };
        set({ colors: { primary: '#test' } });
        await vi.advanceTimersByTimeAsync(60);

        expect(add).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Storage Full',
                color: 'red',
            })
        );
        vi.useRealTimers();
    });

    // Note: This test may fail when run with others due to singleton state sharing
    it('handles corrupted localStorage data', () => {
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        localStorageMock.setItem(
            'or3:user-theme-overrides:light',
            'invalid json {'
        );

        // Reset singleton to force reload
        (globalThis as any).__or3UserThemeOverrides = undefined;

        const { overrides } = useUserThemeOverrides();

        // Should fall back to empty
        expect(overrides.value.colors?.enabled).toBeFalsy();
        expect(consoleWarn).toHaveBeenCalled();

        consoleWarn.mockRestore();
    });
});
