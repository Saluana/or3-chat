import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectStore } from '../types';

const runtimeConfig = vi.hoisted(() => ({
    connect: {
        enabled: true,
        provider: 'sqlite',
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

async function loadRegistry() {
    return import('../registry');
}

function createStore(id: string): ConnectStore {
    return { id } as unknown as ConnectStore;
}

describe('Connect store registry', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.connect.enabled = true;
        runtimeConfig.connect.provider = 'sqlite';
    });

    it('resolves and caches the configured provider', async () => {
        const registry = await loadRegistry();
        const create = vi.fn(() => createStore('sqlite'));
        registry.registerConnectStore({ id: 'sqlite', create });

        expect(registry.getActiveConnectStore()).toEqual(createStore('sqlite'));
        expect(registry.getActiveConnectStore()).toEqual(createStore('sqlite'));
        expect(create).toHaveBeenCalledTimes(1);
        expect(registry.listConnectStoreIds()).toEqual(['sqlite']);
    });

    it('stays dormant when Connect is disabled', async () => {
        const registry = await loadRegistry();
        registry.registerConnectStore({
            id: 'sqlite',
            create: () => createStore('sqlite'),
        });
        runtimeConfig.connect.enabled = false;

        expect(registry.getActiveConnectStore()).toBeNull();
    });

    it('does not silently fall back to another provider', async () => {
        const registry = await loadRegistry();
        registry.registerConnectStore({
            id: 'sqlite',
            create: () => createStore('sqlite'),
        });
        runtimeConfig.connect.provider = 'postgres';

        expect(registry.getActiveConnectStore()).toBeNull();
    });
});
