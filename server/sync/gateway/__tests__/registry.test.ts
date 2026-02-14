import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeConfig = vi.hoisted(() => ({
    public: {
        sync: {
            provider: 'convex',
        },
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

async function loadRegistry() {
    return import('../registry');
}

describe('sync gateway registry', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.public.sync.provider = 'convex';
    });

    it('register/get/list behavior', async () => {
        const reg = await loadRegistry();

        reg.registerSyncGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex' } as any),
        });

        expect(reg.getSyncGatewayAdapter('convex')).toEqual({ id: 'convex' });
        expect(reg.listSyncGatewayAdapterIds()).toEqual(['convex']);
    });

    it('reuses cached instance for same adapter id', async () => {
        const reg = await loadRegistry();
        let createCount = 0;

        reg.registerSyncGatewayAdapter({
            id: 'convex',
            create: () => {
                createCount++;
                return { id: 'convex', created: createCount } as any;
            },
        });

        const a = reg.getSyncGatewayAdapter('convex');
        const b = reg.getSyncGatewayAdapter('convex');

        expect(a).toBe(b);
        expect(createCount).toBe(1);
    });

    it('resets cached instance on re-register', async () => {
        const reg = await loadRegistry();
        let createCount = 0;

        reg.registerSyncGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex', v: ++createCount } as any),
        });
        const first = reg.getSyncGatewayAdapter('convex');

        reg.registerSyncGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex', v: ++createCount } as any),
        });
        const second = reg.getSyncGatewayAdapter('convex');

        expect(first).not.toBe(second);
        expect((second as any).v).toBeGreaterThan((first as any).v);
    });

    it('selects active adapter from runtime config', async () => {
        const reg = await loadRegistry();
        reg.registerSyncGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex' } as any),
        });

        expect(reg.getActiveSyncGatewayAdapter()).toEqual({ id: 'convex' });
    });

    it('returns null for missing provider or unregistered adapter', async () => {
        const reg = await loadRegistry();

        runtimeConfig.public.sync.provider = 'missing';
        expect(reg.getActiveSyncGatewayAdapter()).toBeNull();

        runtimeConfig.public.sync.provider = '' as any;
        expect(reg.getActiveSyncGatewayAdapter()).toBeNull();
    });
});
