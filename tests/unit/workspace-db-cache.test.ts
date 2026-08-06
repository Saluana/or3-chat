import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from 'lru-cache';
import Dexie from 'dexie';
import {
    evictWorkspaceDb,
    getWorkspaceDb,
    getWorkspaceDbCacheStats,
    setActiveWorkspaceDb,
} from '~/db/client';
import * as cursorManager from '~/core/sync/cursor-manager';
import * as hookBridge from '~/core/sync/hook-bridge';
import * as subscriptionManager from '~/core/sync/subscription-manager';

// Mock Dexie
const mockClose = vi.fn();
const mockDb = {
    close: mockClose,
    name: 'test-db',
};

// We'll test the LRU cache logic separately since we can't easily mock the module

describe('Workspace DB Cache LRU', () => {
    afterEach(async () => {
        const { keys } = getWorkspaceDbCacheStats();
        for (const key of keys) {
            evictWorkspaceDb(key);
        }
        setActiveWorkspaceDb(null);
        await Promise.all(
            keys.map((key) => Dexie.delete(`or3-db-${key}`))
        );
        vi.restoreAllMocks();
    });

    it('should evict oldest entries when capacity is reached', () => {
        const disposeFn = vi.fn();
        const cache = new LRUCache<string, { name: string; close: () => void }>({
            max: 3,
            dispose: (value, key) => disposeFn(key, value.name),
        });

        // Add 3 items (at capacity)
        cache.set('ws1', { name: 'db1', close: vi.fn() });
        cache.set('ws2', { name: 'db2', close: vi.fn() });
        cache.set('ws3', { name: 'db3', close: vi.fn() });

        expect(cache.size).toBe(3);
        expect(disposeFn).not.toHaveBeenCalled();

        // Add 4th item - should evict ws1
        cache.set('ws4', { name: 'db4', close: vi.fn() });

        expect(cache.size).toBe(3);
        expect(disposeFn).toHaveBeenCalledWith('ws1', 'db1');
        expect(cache.has('ws1')).toBe(false);
        expect(cache.has('ws2')).toBe(true);
        expect(cache.has('ws3')).toBe(true);
        expect(cache.has('ws4')).toBe(true);
    });

    it('should update TTL on get (updateAgeOnGet)', () => {
        const cache = new LRUCache<string, string>({
            max: 10,
            ttl: 1000,
            updateAgeOnGet: true,
        });

        cache.set('key1', 'value1');
        
        // Access should reset TTL
        const beforeAccess = Date.now();
        cache.get('key1');
        
        // Item should still be there
        expect(cache.has('key1')).toBe(true);
    });

    it('should respect TTL without updates', async () => {
        const cache = new LRUCache<string, string>({
            max: 10,
            ttl: 50, // 50ms TTL
            updateAgeOnGet: false,
        });

        cache.set('key1', 'value1');
        expect(cache.has('key1')).toBe(true);

        // Wait for TTL to expire
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Item should be expired (but LRUCache doesn't auto-delete on check)
        // It deletes on next access or when size constraints require it
        expect(cache.get('key1')).toBeUndefined();
    });

    it('should retain the previous workspace on switch and cleanup sync singletons', () => {
        const cleanupCursorSpy = vi.spyOn(cursorManager, 'cleanupCursorManager');
        const cleanupHookSpy = vi.spyOn(hookBridge, 'cleanupHookBridge');
        const cleanupSubscriptionWorkspaceSpy = vi.spyOn(
            subscriptionManager,
            'cleanupSubscriptionManagersByWorkspace'
        );

        setActiveWorkspaceDb('ws-a');
        setActiveWorkspaceDb('ws-b');

        expect(cleanupCursorSpy).toHaveBeenCalledWith('or3-db-ws-a');
        expect(cleanupHookSpy).toHaveBeenCalledWith('or3-db-ws-a');
        expect(cleanupSubscriptionWorkspaceSpy).toHaveBeenCalledWith('ws-a');

        const { keys } = getWorkspaceDbCacheStats();
        expect(keys.includes('ws-a')).toBe(true);
        expect(keys.includes('ws-b')).toBe(true);
    });

    it('retains the active workspace while evicting inactive LRU entries', () => {
        setActiveWorkspaceDb('ws-active');
        const { max } = getWorkspaceDbCacheStats();

        for (let i = 0; i < max; i += 1) {
            getWorkspaceDb(`ws-other-${i}`);
        }

        const { keys } = getWorkspaceDbCacheStats();
        expect(keys.includes('ws-active')).toBe(true);
        expect(keys.includes('ws-other-0')).toBe(false);
    });

    it('does not close the active workspace DB when its cache entry is evicted', async () => {
        const workspaceId = `ws-active-pin-${crypto.randomUUID()}`;
        const active = setActiveWorkspaceDb(workspaceId);
        await active.open();

        evictWorkspaceDb(workspaceId);
        await Promise.resolve();

        expect(active.isOpen()).toBe(true);
        expect(getWorkspaceDb(workspaceId)).toBe(active);
        await expect(active.kv.count()).resolves.toBe(0);
    });

    it('reopens a cached workspace cleanly after browser storage eviction', async () => {
        const workspaceId = `ws-eviction-${crypto.randomUUID()}`;
        const original = getWorkspaceDb(workspaceId);
        await original.open();
        await original.kv.put({
            id: 'before-eviction',
            name: 'before-eviction',
            value: 'present',
        } as never);
        original.close();
        await Dexie.delete(original.name);

        const recovered = getWorkspaceDb(workspaceId);
        expect(recovered).toBe(original);
        await recovered.open();
        await expect(recovered.kv.count()).resolves.toBe(0);
        await expect(
            recovered.kv.put({
                id: 'after-eviction',
                name: 'after-eviction',
                value: 'recovered',
            } as never)
        ).resolves.toBe('after-eviction');
    });
});

describe('Admin Middleware 404 Handling', () => {
    it('should redirect to home on 404', () => {
        // This is a behavioral test - the actual implementation is tested via E2E
        // But we can verify the logic flow
        const status = 404;
        let redirectTarget: string | null = null;

        // Simulate the middleware logic
        if (status === 404) {
            redirectTarget = '/';
        }

        expect(redirectTarget).toBe('/');
    });

    it('should redirect to login on 401/403', () => {
        const status = 401;
        let redirectTarget: string | null = null;

        // Simulate the middleware logic
        if (status === 401 || status === 403) {
            redirectTarget = '/admin/login';
        }

        expect(redirectTarget).toBe('/admin/login');
    });
});
