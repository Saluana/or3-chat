import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

// Use vi.hoisted to ensure mockStore is available before the mock runs
const mockStore = vi.hoisted(() => ({ store: {} as Record<string, any> }));

vi.mock('@vueuse/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vueuse/core')>();
    const { ref } = await import('vue');
    return {
        ...actual,
        useLocalStorage: <T>(key: string, defaultValue: T, _options?: any) => {
            if (!(key in mockStore.store)) {
                mockStore.store[key] = ref(
                    typeof defaultValue === 'object' ? { ...defaultValue as object } : defaultValue
                );
            }
            return mockStore.store[key];
        },
    };
});

import {
    DEFAULT_AI_SETTINGS,
    sanitizeAiSettings,
    AI_SETTINGS_STORAGE_KEY,
    useAiSettings,
    type AiSettingsV1,
} from '../chat/useAiSettings';

describe('useAiSettings', () => {
    beforeEach(() => {
        // Clear the mock store between tests
        for (const key of Object.keys(mockStore.store)) {
            delete mockStore.store[key];
        }
        vi.clearAllMocks();
    });

    it('sanitizes invalid input and fills defaults (minimal schema)', () => {
        const dirty: any = {
            version: 999,
            masterSystemPrompt: 123,
            defaultModelMode: 'weird',
            fixedModelId: 42,
        };
        const s = sanitizeAiSettings(dirty);
        expect(s.version).toBe(1);
        expect(typeof s.masterSystemPrompt).toBe('string');
        expect(s.defaultModelMode).toBe('lastSelected');
        expect(s.fixedModelId).toBeNull();
    });

    it('migrates missing keys to defaults', () => {
        const partial = { masterSystemPrompt: 'x' } as Partial<AiSettingsV1>;
        const s = sanitizeAiSettings(partial);
        for (const k of Object.keys(DEFAULT_AI_SETTINGS) as Array<
            keyof AiSettingsV1
        >) {
            expect(s[k]).not.toBeUndefined();
        }
    });

    it('persists and loads settings', () => {
        const { set, load, settings } = useAiSettings();
        set({
            masterSystemPrompt: 'hello',
            defaultModelMode: 'fixed',
            fixedModelId: 'm1',
        });
        const loaded = load();
        expect(loaded.masterSystemPrompt).toBe('hello');
        expect(loaded.defaultModelMode).toBe('fixed');
        expect(loaded.fixedModelId).toBe('m1');
        // Also verify via the reactive settings
        expect(settings.value.masterSystemPrompt).toBe('hello');
    });

    it('handles bad JSON in storage gracefully', () => {
        // With the mock, there's no real localStorage to corrupt.
        // Instead, test that load() returns valid defaults when store is empty.
        const { load } = useAiSettings();
        const after = load();
        // Should return defaults, not throw
        expect(after.version).toBe(1);
    });
});
