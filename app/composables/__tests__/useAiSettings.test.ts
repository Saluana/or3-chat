import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    DEFAULT_AI_SETTINGS,
    sanitizeAiSettings,
    AI_SETTINGS_STORAGE_KEY,
    useAiSettings,
    type AiSettingsV1,
} from '../useAiSettings';

function mockLocalStorage() {
    const store: Record<string, string> = {};
    const ls = {
        getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
        setItem: vi.fn((k: string, v: string) => {
            store[k] = v;
        }),
        removeItem: vi.fn((k: string) => {
            delete store[k];
        }),
        clear: vi.fn(() => {
            for (const k of Object.keys(store)) delete store[k];
        }),
    } as any;
    // @ts-ignore
    globalThis.localStorage = ls;
    // @ts-ignore
    globalThis.window = { localStorage: ls } as any;
    // @ts-ignore
    globalThis.document = {} as any;
    return ls;
}

describe('useAiSettings', () => {
    beforeEach(() => {
        mockLocalStorage();
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
        const { set, load } = useAiSettings();
        set({
            masterSystemPrompt: 'hello',
            defaultModelMode: 'fixed',
            fixedModelId: 'm1',
        });
        const loaded = load();
        expect(loaded.masterSystemPrompt).toBe('hello');
        expect(loaded.defaultModelMode).toBe('fixed');
        expect(loaded.fixedModelId).toBe('m1');
        const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)!;
        const parsed = JSON.parse(raw);
        expect(parsed.masterSystemPrompt).toBe('hello');
    });

    it('handles bad JSON in storage gracefully', () => {
        localStorage.setItem(AI_SETTINGS_STORAGE_KEY, '{bad-json');
        const { load } = useAiSettings();
        const after = load();
        // Should return defaults or last good state, not throw
        expect(after.version).toBe(1);
    });
});
