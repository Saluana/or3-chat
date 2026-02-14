/**
 * OR3 Client Adapter Tests
 *
 * Tests that work without full Nuxt environment.
 * For full integration tests with adapters, see integration test suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed } from 'vue';

// Mock createRegistry for tests that need it
vi.mock('~/composables/_registry', () => ({
    createRegistry: vi.fn((name: string) => {
        const items = new Map<string, { id: string }>();
        return {
            register: (item: { id: string }) => {
                items.set(item.id, item);
            },
            unregister: (id: string) => {
                items.delete(id);
            },
            snapshot: () => Array.from(items.values()),
            useItems: () => computed(() => Array.from(items.values())),
            listIds: () => Array.from(items.keys()),
        };
    }),
}));

/**
 * Helper to reset global registries between tests
 */
function resetGlobalRegistries() {
    const g = globalThis as Record<string, unknown>;
    const keysToDelete = Object.keys(g).filter(
        (k) => k.startsWith('__or3') || k.includes('Registry')
    );
    keysToDelete.forEach((k) => delete g[k]);
}

describe('Message Actions Adapter', () => {
    beforeEach(() => {
        resetGlobalRegistries();
        vi.clearAllMocks();
    });

    it('creates an adapter with register method', async () => {
        const { createMessageActionsAdapter } = await import(
            '~/core/or3client/adapters/message-actions'
        );

        const adapter = createMessageActionsAdapter();
        expect(typeof adapter.register).toBe('function');
        expect(typeof adapter.unregister).toBe('function');
        expect(typeof adapter.get).toBe('function');
        expect(typeof adapter.list).toBe('function');
        expect(typeof adapter.useItems).toBe('function');
        expect(typeof adapter.listIds).toBe('function');
    });
});

describe('Editor Toolbar Adapter', () => {
    beforeEach(() => {
        resetGlobalRegistries();
        vi.clearAllMocks();
    });

    it('creates an adapter with required methods', async () => {
        const { createEditorToolbarAdapter } = await import(
            '~/core/or3client/adapters/editor-toolbar'
        );

        const adapter = createEditorToolbarAdapter();
        expect(typeof adapter.register).toBe('function');
        expect(typeof adapter.unregister).toBe('function');
        expect(typeof adapter.get).toBe('function');
        expect(typeof adapter.list).toBe('function');
        expect(typeof adapter.useItems).toBe('function');
        expect(typeof adapter.listIds).toBe('function');
    });
});

describe('Dashboard Plugins Adapter', () => {
    beforeEach(() => {
        resetGlobalRegistries();
        vi.clearAllMocks();
    });

    it('creates an adapter with required methods', async () => {
        const { createDashboardPluginsAdapter } = await import(
            '~/core/or3client/adapters/dashboard-plugins'
        );

        const adapter = createDashboardPluginsAdapter();
        expect(typeof adapter.register).toBe('function');
        expect(typeof adapter.unregister).toBe('function');
        expect(typeof adapter.get).toBe('function');
        expect(typeof adapter.list).toBe('function');
        expect(typeof adapter.useItems).toBe('function');
        expect(typeof adapter.listIds).toBe('function');
    });
});

describe('Chat Input Bridge Adapter', () => {
    beforeEach(() => {
        resetGlobalRegistries();
        vi.clearAllMocks();
    });

    it('exposes register, unregister, send, hasPane methods', async () => {
        const { createChatInputBridgeAdapter } = await import(
            '~/core/or3client/adapters/chat-input-bridge'
        );

        const adapter = createChatInputBridgeAdapter();

        expect(typeof adapter.register).toBe('function');
        expect(typeof adapter.unregister).toBe('function');
        expect(typeof adapter.send).toBe('function');
        expect(typeof adapter.hasPane).toBe('function');
    });
});

describe('Hooks Adapter', () => {
    beforeEach(() => {
        resetGlobalRegistries();
        vi.clearAllMocks();
    });

    it('exposes engine and useEffect methods', async () => {
        const { createHooksAdapter } = await import(
            '~/core/or3client/adapters/hooks'
        );

        const adapter = createHooksAdapter();

        expect(typeof adapter.engine).toBe('function');
        expect(typeof adapter.useEffect).toBe('function');
    });
});
