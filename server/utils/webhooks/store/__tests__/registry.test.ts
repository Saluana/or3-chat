import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookStore } from '../types';

const runtimeConfig = vi.hoisted(() => ({
    public: {
        sync: {
            provider: 'sqlite',
        },
    },
    sync: {
        provider: 'sqlite',
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

async function loadRegistry() {
    return import('../registry');
}

function createStore(id: string): WebhookStore {
    return {
        id,
    } as unknown as WebhookStore;
}

describe('webhook store registry', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.public.sync.provider = 'sqlite';
        runtimeConfig.sync.provider = 'sqlite';
    });

    it('registers, resolves, and lists stores', async () => {
        const registry = await loadRegistry();

        registry.registerWebhookStore({
            id: 'sqlite',
            create: () => createStore('sqlite'),
        });

        expect(registry.getWebhookStore('sqlite')).toEqual(createStore('sqlite'));
        expect(registry.listWebhookStoreIds()).toEqual(['sqlite']);
    });

    it('caches store instances by id', async () => {
        const registry = await loadRegistry();
        let createCount = 0;

        registry.registerWebhookStore({
            id: 'sqlite',
            create: () => {
                createCount++;
                return createStore(`sqlite-${createCount}`);
            },
        });

        const first = registry.getWebhookStore('sqlite');
        const second = registry.getWebhookStore('sqlite');

        expect(first).toBe(second);
        expect(createCount).toBe(1);
    });

    it('clears cached instances when re-registering', async () => {
        const registry = await loadRegistry();
        let createCount = 0;

        registry.registerWebhookStore({
            id: 'sqlite',
            create: () => createStore(`sqlite-${++createCount}`),
        });
        const first = registry.getWebhookStore('sqlite');

        registry.registerWebhookStore({
            id: 'sqlite',
            create: () => createStore(`sqlite-${++createCount}`),
        });
        const second = registry.getWebhookStore('sqlite');

        expect(first).not.toBe(second);
        expect(second).toEqual(createStore('sqlite-2'));
    });

    it('resolves the active store from runtime config', async () => {
        const registry = await loadRegistry();

        registry.registerWebhookStore({
            id: 'sqlite',
            create: () => createStore('sqlite'),
        });

        expect(registry.getActiveWebhookStore()).toEqual(createStore('sqlite'));
    });

    it('returns null when the active provider is missing or unregistered', async () => {
        const registry = await loadRegistry();

        runtimeConfig.sync.provider = 'missing';
        expect(registry.getActiveWebhookStore()).toBeNull();

        runtimeConfig.sync.provider = '' as never;
        runtimeConfig.public.sync.provider = '' as never;
        expect(registry.getActiveWebhookStore()).toBeNull();
    });
});
