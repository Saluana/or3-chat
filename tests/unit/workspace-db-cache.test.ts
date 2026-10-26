import { describe, it, expect, vi, afterEach } from 'vitest';
import Dexie from 'dexie';
import {
    evictWorkspaceDb,
    getWorkspaceDb,
    getWorkspaceDbCacheStats,
    setActiveWorkspaceDb,
} from '~/db/client';
import * as cursorManager from '~/core/sync/cursor-manager';
import * as hookBridge from '~/core/sync/hook-bridge';
import { createSubscriptionManager, getSubscriptionManager } from '~/core/sync/subscription-manager';
import type { SyncProvider } from '~~/shared/sync/types';

describe('Workspace DB Cache LRU', () => {
    afterEach(async () => {
        const { keys } = getWorkspaceDbCacheStats();
        setActiveWorkspaceDb(null);
        for (const key of keys) {
            evictWorkspaceDb(key);
        }
        await Promise.all(
            keys.map((key) => Dexie.delete(`or3-db-${key}`))
        );
        vi.restoreAllMocks();
    });

    it('should retain the previous workspace on switch and cleanup sync singletons', () => {
        const cleanupCursorSpy = vi.spyOn(cursorManager, 'cleanupCursorManager');
        const cleanupHookSpy = vi.spyOn(hookBridge, 'cleanupHookBridge');
        const provider: SyncProvider = {
            id: 'workspace-cleanup', mode: 'gateway',
            subscribe: vi.fn(), pull: vi.fn(), push: vi.fn(),
            updateCursor: vi.fn(), dispose: vi.fn(),
        };
        const previous = setActiveWorkspaceDb('ws-a');
        const scope = { workspaceId: 'ws-a' };
        const manager = createSubscriptionManager(previous, provider, scope);
        const stop = vi.spyOn(manager, 'stop');
        const nextScope = { workspaceId: 'ws-b' };
        const next = createSubscriptionManager(getWorkspaceDb('ws-b'), provider, nextScope);
        setActiveWorkspaceDb('ws-b');

        expect(cleanupCursorSpy).toHaveBeenCalledWith('or3-db-ws-a');
        expect(cleanupHookSpy).toHaveBeenCalledWith('or3-db-ws-a');
        // Assert the lifecycle, not the module from which cleanup is imported.
        expect(stop).toHaveBeenCalledOnce();
        expect(getSubscriptionManager(scope)).toBeNull();
        expect(getSubscriptionManager(nextScope)).toBe(next);

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

    it('closes an evicted active DB when the workspace changes before re-pin', async () => {
        const workspaceId = `ws-active-switch-${crypto.randomUUID()}`;
        const active = setActiveWorkspaceDb(workspaceId);
        await active.open();

        evictWorkspaceDb(workspaceId);
        setActiveWorkspaceDb(null);
        await Promise.resolve();

        expect(active.isOpen()).toBe(false);
        await Dexie.delete(active.name);
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
