import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSettingsStore } from '../../stores/types';
import {
    bootstrapDefaultEnabledPlugins,
    getEnabledPlugins,
    getPluginAccessPolicy,
    getPluginSettings,
    setPluginAccessPolicy,
    setPluginEnabled,
    setPluginSettings,
} from '../workspace-plugin-store';

function createStore() {
    const map = new Map<string, string>();
    const store: WorkspaceSettingsStore = {
        get: vi.fn(async (workspaceId, key) => {
            return map.get(`${workspaceId}:${key}`) ?? null;
        }),
        set: vi.fn(async (workspaceId, key, value) => {
            map.set(`${workspaceId}:${key}`, value);
        }),
    };
    return { map, store };
}

describe('workspace plugin store', () => {
    it('returns empty enabled list when unset', async () => {
        const { store } = createStore();
        const enabled = await getEnabledPlugins(store, 'ws-1');
        expect(enabled).toEqual([]);
    });

    it('adds and removes enabled plugins', async () => {
        const { store } = createStore();
        const added = await setPluginEnabled(store, 'ws-1', 'plugin.a', true);
        expect(added).toEqual(['plugin.a']);
        expect(store.set).toHaveBeenCalledWith(
            'ws-1',
            'plugins.enabled',
            JSON.stringify(['plugin.a'])
        );

        const removed = await setPluginEnabled(store, 'ws-1', 'plugin.a', false);
        expect(removed).toEqual([]);
    });

    it('stores and loads plugin settings', async () => {
        const { store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', { enabled: true, count: 2 });

        const settings = await getPluginSettings(store, 'ws-1', 'plugin.a');
        expect(settings).toEqual({ enabled: true, count: 2 });
    });

    it('merges settings updates without dropping unknown keys', async () => {
        const { store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', {
            enabled: true,
            nested: { keep: 1 },
        });
        await setPluginSettings(store, 'ws-1', 'plugin.a', {
            access: { authRequired: true },
        });

        const settings = await getPluginSettings(store, 'ws-1', 'plugin.a');
        expect(settings).toEqual({
            enabled: true,
            nested: { keep: 1 },
            access: { authRequired: true },
        });
    });

    it('stores and resolves access policy', async () => {
        const { store } = createStore();
        await setPluginAccessPolicy(store, 'ws-1', 'plugin.a', {
            authRequired: true,
            requiredEntitlements: ['paid'],
        });

        await expect(getPluginAccessPolicy(store, 'ws-1', 'plugin.a')).resolves.toEqual({
            authRequired: true,
            requiredEntitlements: ['paid'],
            requiredWorkspaceRoles: [],
            mode: 'all',
        });
    });

    it('rejects invalid access policy payloads', async () => {
        const { store } = createStore();
        await expect(
            setPluginAccessPolicy(store, 'ws-1', 'plugin.a', {
                authRequired: true,
                requiredWorkspaceRoles: ['owner', 'invalid'] as unknown as Array<
                    'owner' | 'editor' | 'viewer'
                >,
            })
        ).rejects.toThrow('Invalid access policy');
    });

    it('rejects invalid plugin settings payloads', async () => {
        const { store } = createStore();
        await expect(
            setPluginSettings(store, 'ws-1', 'plugin.a', null as unknown as Record<string, unknown>)
        ).rejects.toThrow('Invalid settings');
    });

    it('returns defaults when stored JSON is invalid', async () => {
        const { store, map } = createStore();
        map.set('ws-1:plugins.enabled', '{bad');
        map.set('ws-1:plugins.settings.plugin.a', '{bad');

        await expect(getEnabledPlugins(store, 'ws-1')).resolves.toEqual([]);
        await expect(getPluginSettings(store, 'ws-1', 'plugin.a')).resolves.toEqual({});
    });

    it('bootstraps default enabled plugins only when key is unset', async () => {
        const { store } = createStore();
        const seeded = await bootstrapDefaultEnabledPlugins(store, 'ws-1', [
            'plugin.a',
            'plugin.a',
            '',
            'plugin.b',
        ]);
        expect(seeded).toEqual(['plugin.a', 'plugin.b']);

        const unchanged = await bootstrapDefaultEnabledPlugins(store, 'ws-1', ['plugin.c']);
        expect(unchanged).toEqual(['plugin.a', 'plugin.b']);
    });
});
