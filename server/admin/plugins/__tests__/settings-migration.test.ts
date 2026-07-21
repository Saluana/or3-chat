import { describe, expect, it } from 'vitest';
import type { WorkspaceSettingsStore } from '../../stores/types';
import { PluginSettingsMigrationService } from '../settings-migration';
import { getPluginSettings } from '../workspace-plugin-store';

function memoryStore(): WorkspaceSettingsStore {
    const values = new Map<string, string>();
    return {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
    };
}

describe('PluginSettingsMigrationService', () => {
    it('migrates settings and records the target state version', async () => {
        const store = memoryStore();
        await store.set('ws-1', 'plugins.settings.alpha', JSON.stringify({ count: 1 }));
        await store.set('ws-1', 'plugins.stateVersion.alpha', '1');
        const service = new PluginSettingsMigrationService(store, () => 42);

        const result = await service.runMigration({
            workspaceId: 'ws-1',
            pluginId: 'alpha',
            migration: {
                fromVersion: 1,
                toVersion: 2,
                direction: 'upgrade',
                migrate: (settings) => ({
                    ...settings,
                    count: Number(settings.count) + 1,
                }),
            },
        });

        expect(result.status).toBe('migrated');
        expect(await getPluginSettings(store, 'ws-1', 'alpha')).toEqual({ count: 2 });
        expect(await service.getStateVersion('ws-1', 'alpha')).toBe(2);
    });

    it('restores the exact prior settings snapshot after a forced migration failure', async () => {
        const store = memoryStore();
        await store.set(
            'ws-1',
            'plugins.settings.alpha',
            JSON.stringify({ theme: 'retro', nested: { ok: true } })
        );
        await store.set('ws-1', 'plugins.stateVersion.alpha', '3');
        const service = new PluginSettingsMigrationService(store);

        const result = await service.runMigration({
            workspaceId: 'ws-1',
            pluginId: 'alpha',
            migration: {
                fromVersion: 3,
                toVersion: 4,
                direction: 'upgrade',
                migrate: (settings) => ({ ...settings, theme: 'broken' }),
            },
            faultAfterMigrate: async () => {
                throw new Error('forced-migration-failure');
            },
        });

        expect(result).toMatchObject({
            status: 'restored',
            error: 'forced-migration-failure',
            snapshot: {
                stateVersion: 3,
                settings: { theme: 'retro', nested: { ok: true } },
            },
        });
        expect(await getPluginSettings(store, 'ws-1', 'alpha')).toEqual({
            theme: 'retro',
            nested: { ok: true },
        });
        expect(await service.getStateVersion('ws-1', 'alpha')).toBe(3);
    });
});
