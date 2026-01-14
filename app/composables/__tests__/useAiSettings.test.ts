import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock KV storage
const mockKvStore = new Map<string, string>();

vi.mock('~/db/kv', () => ({
    getKvByName: vi.fn(async (name: string) => {
        const value = mockKvStore.get(name);
        return value ? { id: `kv:${name}`, name, value } : undefined;
    }),
    setKvByName: vi.fn(async (name: string, value: string) => {
        mockKvStore.set(name, value);
        return { id: `kv:${name}`, name, value };
    }),
}));

// Mock db for getKvByName fallback
vi.mock('~/db', () => ({
    db: {
        kv: {
            where: () => ({
                equals: () => ({
                    first: async () => undefined,
                }),
            }),
        },
    },
}));

import {
    DEFAULT_AI_SETTINGS,
    sanitizeAiSettings,
    useAiSettings,
    type AiSettingsV1,
} from '../chat/useAiSettings';

describe('useAiSettings', () => {
    beforeEach(() => {
        // Clear the mock store between tests
        mockKvStore.clear();
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

    it('persists and loads settings', async () => {
        const { set, load, settings, ensureLoaded } = useAiSettings();
        await ensureLoaded();
        await set({
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

    it('handles missing KV gracefully', async () => {
        const { load, ensureLoaded } = useAiSettings();
        await ensureLoaded();
        const after = load();
        // Should return defaults, not throw
        expect(after.version).toBe(1);
    });
});
