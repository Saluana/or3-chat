import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

describe('useUserApiKey', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('skips kv hydration when kv table is unavailable', async () => {
        const table = vi.fn();
        const stateRef = ref({ openrouterKey: 'seed' as string | null });

        vi.doMock('~/db/client', () => ({
            getDb: () => ({
                tables: [{ name: 'messages' }],
                table,
            }),
        }));
        vi.doMock('~/state/global', () => ({
            state: stateRef,
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await mod.hydrateUserApiKeyFromKv();

        expect(table).not.toHaveBeenCalled();
        expect(stateRef.value.openrouterKey).toBe('seed');
    });

    it('hydrates key from kv safely', async () => {
        const first = vi.fn().mockResolvedValue({
            id: 'kv-openrouter',
            name: 'openrouter_api_key',
            value: 'or-key-123',
        });
        const equals = vi.fn().mockReturnValue({ first });
        const where = vi.fn().mockReturnValue({ equals });
        const table = vi.fn().mockReturnValue({ where });
        const stateRef = ref({ openrouterKey: null as string | null });

        vi.doMock('~/db/client', () => ({
            getDb: () => ({
                tables: [{ name: 'kv' }],
                table,
            }),
        }));
        vi.doMock('~/state/global', () => ({
            state: stateRef,
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await mod.hydrateUserApiKeyFromKv();

        expect(stateRef.value.openrouterKey).toBe('or-key-123');
        expect(table).toHaveBeenCalledTimes(1);
        expect(where).toHaveBeenCalledWith('name');
        expect(equals).toHaveBeenCalledWith('openrouter_api_key');
        expect(first).toHaveBeenCalledTimes(1);
    });

    it('validates OpenRouter key format', async () => {
        vi.doMock('~/db/client', () => ({ getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: vi.fn() } }));
        vi.doMock('~/state/global', () => ({
            state: ref({ openrouterKey: null }),
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        expect(mod.isValidOpenRouterKeyFormat('sk-or-v1-abcdefghij')).toBe(
            true
        );
        expect(mod.isValidOpenRouterKeyFormat('sk-or-short')).toBe(false);
        expect(mod.isValidOpenRouterKeyFormat('not-a-key')).toBe(false);
    });

    it('persistUserApiKey writes kv and updates state', async () => {
        const kvSet = vi.fn().mockResolvedValue(undefined);
        const stateRef = ref({ openrouterKey: null as string | null });

        vi.doMock('~/db/client', () => ({ getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: kvSet } }));
        vi.doMock('~/state/global', () => ({ state: stateRef }));

        const mod = await import('~/core/auth/useUserApiKey');
        const key = 'sk-or-v1-abcdefghijklmnop';
        await mod.persistUserApiKey(key);

        expect(kvSet).toHaveBeenCalledWith('openrouter_api_key', key);
        expect(stateRef.value.openrouterKey).toBe(key);
    });

    it('persistUserApiKey rejects invalid keys without writing', async () => {
        const kvSet = vi.fn();
        vi.doMock('~/db/client', () => ({ getDb: () => ({ tables: [] }) }));
        vi.doMock('~/db', () => ({ kv: { set: kvSet } }));
        vi.doMock('~/state/global', () => ({
            state: ref({ openrouterKey: null }),
        }));

        const mod = await import('~/core/auth/useUserApiKey');
        await expect(mod.persistUserApiKey('bad-key')).rejects.toThrow(
            /sk-or-/
        );
        expect(kvSet).not.toHaveBeenCalled();
    });
});

