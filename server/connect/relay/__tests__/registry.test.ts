import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectRelay } from '../types';

const runtimeConfig = vi.hoisted(() => ({
    connect: {
        enabled: true,
        relayProvider: 'cloudflare',
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

async function loadRegistry() {
    return import('../registry');
}

function createRelay(id: string): ConnectRelay {
    return { id } as unknown as ConnectRelay;
}

describe('Connect relay registry', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.connect.enabled = true;
        runtimeConfig.connect.relayProvider = 'cloudflare';
    });

    it('resolves the explicitly selected relay', async () => {
        const registry = await loadRegistry();
        registry.registerConnectRelay({
            id: 'cloudflare',
            create: () => createRelay('cloudflare'),
        });

        expect(registry.getActiveConnectRelay()).toEqual(
            createRelay('cloudflare')
        );
        expect(registry.listConnectRelayIds()).toEqual(['cloudflare']);
    });

    it('fails closed for an unregistered relay', async () => {
        const registry = await loadRegistry();
        registry.registerConnectRelay({
            id: 'cloudflare',
            create: () => createRelay('cloudflare'),
        });
        runtimeConfig.connect.relayProvider = 'custom';

        expect(registry.getActiveConnectRelay()).toBeNull();
    });
});
