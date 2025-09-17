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

    it('sanitizes invalid input and fills defaults', () => {
        const dirty: any = {
            version: 999,
            masterSystemPrompt: 123,
            defaultModelMode: 'weird',
            fixedModelId: 42,
            temperature: 9,
            maxOutputTokens: -5,
            jsonMode: 'yes',
            structuredOutput: { enabled: '1', schemaName: '', strict: 'no' },
            streaming: 'on',
            toolPolicy: 'nope',
            toolChoiceDefault: 'none',
            parallelToolCalls: 'x',
            provider: {
                allowFallbacks: 'y',
                requireParameters: 'n',
                dataCollection: 'deny',
                zdr: 1,
            },
        };
        const s = sanitizeAiSettings(dirty);
        expect(s.version).toBe(1);
        expect(typeof s.masterSystemPrompt).toBe('string');
        expect(s.defaultModelMode).toBe('lastSelected');
        expect(s.fixedModelId).toBeNull();
        expect(s.temperature).toBeLessThanOrEqual(2);
        expect(s.maxOutputTokens).toBeNull();
        expect(typeof s.jsonMode).toBe('boolean');
        expect(typeof s.streaming).toBe('boolean');
        expect(['allow', 'disallow', 'ask']).toContain(s.toolPolicy);
        expect(['auto', 'none']).toContain(s.toolChoiceDefault);
        expect(typeof s.parallelToolCalls).toBe('boolean');
        expect(s.structuredOutput.strict).toBeTypeOf('boolean');
        expect(s.provider.dataCollection).toBe('deny');
    });

    it('migrates missing keys to defaults', () => {
        const partial = { temperature: 0 } as Partial<AiSettingsV1>;
        const s = sanitizeAiSettings(partial);
        for (const k of Object.keys(DEFAULT_AI_SETTINGS) as Array<
            keyof AiSettingsV1
        >) {
            expect(s[k]).not.toBeUndefined();
        }
    });

    it('persists and loads settings', () => {
        const { set, load } = useAiSettings();
        set({ temperature: 1.2, jsonMode: true });
        const loaded = load();
        expect(loaded.temperature).toBe(1.2);
        expect(loaded.jsonMode).toBe(true);
        const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)!;
        const parsed = JSON.parse(raw);
        expect(parsed.temperature).toBe(1.2);
    });

    it('handles bad JSON in storage gracefully', () => {
        localStorage.setItem(AI_SETTINGS_STORAGE_KEY, '{bad-json');
        const { load } = useAiSettings();
        const after = load();
        // Should return defaults or last good state, not throw
        expect(after.version).toBe(1);
    });
});
