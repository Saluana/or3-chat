import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import { bootstrapDefaultEnabledPlugins } from '../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../admin/stores/registry';

export function getDefaultEnabledPluginIds(event?: H3Event): string[] {
    const config = useRuntimeConfig(event);
    const rawDefaultEnabled = (
        (config.plugins as { defaultEnabled?: unknown } | undefined)?.defaultEnabled
    );

    if (!Array.isArray(rawDefaultEnabled)) {
        return [];
    }

    return rawDefaultEnabled.filter(
        (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
    );
}

export async function provisionWorkspaceDefaults(
    event: H3Event,
    workspaceId: string
): Promise<void> {
    const defaultEnabledPluginIds = getDefaultEnabledPluginIds(event);
    if (defaultEnabledPluginIds.length === 0) {
        return;
    }

    const settingsStore = getWorkspaceSettingsStore(event);
    await bootstrapDefaultEnabledPlugins(
        settingsStore,
        workspaceId,
        defaultEnabledPluginIds
    );
}