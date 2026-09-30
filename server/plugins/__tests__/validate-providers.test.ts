import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => state.config }));

describe('provider startup validation', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubGlobal('defineNitroPlugin', (callback: unknown) => callback);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('requires an auth workspace store independently of sync and validates effective selections', async () => {
        const config = {
            auth: { enabled: true, provider: 'fixture-auth' },
            sync: { enabled: false, provider: 'fixture-store' },
            storage: { enabled: false },
        };
        state.config = config;
        const { registerAuthProvider } = await import('../../auth/registry');
        const { registerAuthWorkspaceStore } =
            await import('../../auth/store/registry');
        registerAuthProvider({
            id: 'fixture-auth',
            create: () => {
                throw new Error('validation must not create a provider');
            },
        });
        const { default: validate } = await import('../99.validate-providers');
        const run = validate as unknown as () => void;
        expect(run).toThrow(/AuthWorkspaceStore.*fixture-store/);
        registerAuthWorkspaceStore({
            id: 'fixture-store',
            create: () => {
                throw new Error('validation must not open a database');
            },
        });
        expect(run).not.toThrow();
        config.sync.provider = 'runtime-override';
        expect(run).toThrow(/AuthWorkspaceStore.*runtime-override/);
    });
});
