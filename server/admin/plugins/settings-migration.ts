import type { WorkspaceSettingsStore } from '../stores/types';

/** Reads the host-managed state version for package compatibility preflight. */
export class PluginSettingsMigrationService {
    constructor(private readonly store: WorkspaceSettingsStore) {}

    async getStateVersion(workspaceId: string, pluginId: string): Promise<number | null> {
        const raw = await this.store.get(workspaceId, `plugins.stateVersion.${pluginId}`);
        if (raw == null || raw === '') return null;
        const value = Number(raw);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

}
