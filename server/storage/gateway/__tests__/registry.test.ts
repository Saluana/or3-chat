import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeConfig = vi.hoisted(() => ({
    public: {
        storage: {
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

describe('storage gateway registry', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.public.storage.provider = 'convex';
    });

    it('register/get/list behavior', async () => {
        const reg = await loadRegistry();
        reg.registerStorageGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex' } as any),
        });

        expect(reg.getStorageGatewayAdapter('convex')).toEqual({ id: 'convex' });
        expect(reg.listStorageGatewayAdapterIds()).toEqual(['convex']);
    });

    it('create() is called on every get (non-cached behavior)', async () => {
        const reg = await loadRegistry();
        let createCount = 0;

        reg.registerStorageGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex', c: ++createCount } as any),
        });

        const a = reg.getStorageGatewayAdapter('convex');
        const b = reg.getStorageGatewayAdapter('convex');

        expect(a).not.toBe(b);
        expect(createCount).toBe(2);
    });

    it('selects active adapter from runtime config', async () => {
        const reg = await loadRegistry();
        reg.registerStorageGatewayAdapter({
            id: 'convex',
            create: () => ({ id: 'convex' } as any),
        });

        expect(reg.getActiveStorageGatewayAdapter()).toEqual({ id: 'convex' });
    });

    it('returns null when provider is missing/unregistered', async () => {
        const reg = await loadRegistry();

        runtimeConfig.public.storage.provider = 'missing';
        expect(reg.getActiveStorageGatewayAdapter()).toBeNull();

        runtimeConfig.public.storage.provider = '' as any;
        expect(reg.getActiveStorageGatewayAdapter()).toBeNull();
    });
});
