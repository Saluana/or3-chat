import type { WorkspaceSettingsStore } from '../stores/types';
import { getPluginSettings, setPluginSettings } from './workspace-plugin-store';

export type PluginSettingsSnapshot = {
    readonly schemaVersion: 1;
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly stateVersion: number;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly capturedAt: number;
};

export type PluginSettingsMigration = {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly direction: 'upgrade' | 'downgrade';
    migrate(
        settings: Readonly<Record<string, unknown>>
    ): Record<string, unknown> | Promise<Record<string, unknown>>;
};

export type RunPluginSettingsMigrationResult =
    | {
          readonly status: 'migrated';
          readonly fromVersion: number;
          readonly toVersion: number;
          readonly snapshot: PluginSettingsSnapshot;
      }
    | {
          readonly status: 'restored';
          readonly fromVersion: number;
          readonly toVersion: number;
          readonly snapshot: PluginSettingsSnapshot;
          readonly error: string;
      };

function cloneSettings(settings: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return structuredClone(settings) as Record<string, unknown>;
}

/**
 * Host-managed settings migration with snapshot restore on failure.
 * The active package pointer must not change until this succeeds.
 */
export class PluginSettingsMigrationService {
    constructor(
        private readonly store: WorkspaceSettingsStore,
        private readonly now: () => number = Date.now
    ) {}

    async snapshot(
        workspaceId: string,
        pluginId: string,
        stateVersion: number
    ): Promise<PluginSettingsSnapshot> {
        const settings = await getPluginSettings(this.store, workspaceId, pluginId);
        return Object.freeze({
            schemaVersion: 1,
            workspaceId,
            pluginId,
            stateVersion,
            settings: Object.freeze(cloneSettings(settings)),
            capturedAt: this.now(),
        });
    }

    async restore(snapshot: PluginSettingsSnapshot): Promise<void> {
        await this.store.set(
            snapshot.workspaceId,
            `plugins.settings.${snapshot.pluginId}`,
            JSON.stringify(snapshot.settings)
        );
        await this.store.set(
            snapshot.workspaceId,
            `plugins.stateVersion.${snapshot.pluginId}`,
            String(snapshot.stateVersion)
        );
    }

    async getStateVersion(workspaceId: string, pluginId: string): Promise<number | null> {
        const raw = await this.store.get(workspaceId, `plugins.stateVersion.${pluginId}`);
        if (raw == null || raw === '') return null;
        const value = Number(raw);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    async setStateVersion(
        workspaceId: string,
        pluginId: string,
        stateVersion: number
    ): Promise<void> {
        if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
            throw new Error('Invalid plugin state version');
        }
        await this.store.set(
            workspaceId,
            `plugins.stateVersion.${pluginId}`,
            String(stateVersion)
        );
    }

    async runMigration(input: {
        readonly workspaceId: string;
        readonly pluginId: string;
        readonly migration: PluginSettingsMigration;
        readonly faultAfterMigrate?: () => void | Promise<void>;
    }): Promise<RunPluginSettingsMigrationResult> {
        const currentVersion =
            (await this.getStateVersion(input.workspaceId, input.pluginId)) ??
            input.migration.fromVersion;
        if (currentVersion !== input.migration.fromVersion) {
            throw new Error(
                `Settings migration expected version ${input.migration.fromVersion}, found ${currentVersion}`
            );
        }
        const snapshot = await this.snapshot(
            input.workspaceId,
            input.pluginId,
            currentVersion
        );
        try {
            const nextSettings = await input.migration.migrate(snapshot.settings);
            await setPluginSettings(
                this.store,
                input.workspaceId,
                input.pluginId,
                nextSettings
            );
            await this.setStateVersion(
                input.workspaceId,
                input.pluginId,
                input.migration.toVersion
            );
            await input.faultAfterMigrate?.();
            return Object.freeze({
                status: 'migrated',
                fromVersion: input.migration.fromVersion,
                toVersion: input.migration.toVersion,
                snapshot,
            });
        } catch (error) {
            await this.restore(snapshot);
            return Object.freeze({
                status: 'restored',
                fromVersion: input.migration.fromVersion,
                toVersion: input.migration.toVersion,
                snapshot,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
