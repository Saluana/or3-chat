import { createHash } from 'node:crypto';
import { defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../auth/session';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';

export interface PluginRuntimeManifestResponse {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installedPluginIds: string[];
    runtime: Record<
        string,
        {
            clientEntry?: string;
            hasServerRoutes: boolean;
        }
    >;
    revision: string;
}

function buildRevision(payload: {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installed: Array<{ id: string; version: string; clientEntry?: string; hasServerRoutes: boolean }>;
}): string {
    const raw = JSON.stringify(payload);
    return createHash('sha1').update(raw).digest('hex');
}

function emptyManifest(): PluginRuntimeManifestResponse {
    return {
        workspaceId: null,
        enabledPluginIds: [],
        installedPluginIds: [],
        runtime: {},
        revision: createHash('sha1').update('empty').digest('hex'),
    };
}

export default defineEventHandler(async (event): Promise<PluginRuntimeManifestResponse> => {
    if (!isSsrAuthEnabled(event)) {
        return emptyManifest();
    }

    const runtimeConfig = useRuntimeConfig();
    const runtimeLoaderEnabled =
        (runtimeConfig.admin as { pluginRuntimeLoaderEnabled?: boolean } | undefined)
            ?.pluginRuntimeLoaderEnabled !== false;
    if (!runtimeLoaderEnabled) {
        return emptyManifest();
    }

    const session = await resolveSessionContext(event);
    const workspaceId = session.workspace?.id ?? null;
    if (!workspaceId) {
        return emptyManifest();
    }

    const [installedExtensions, enabledConfigured] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(getWorkspaceSettingsStore(event), workspaceId),
    ]);

    const installedPlugins = installedExtensions
        .filter((entry) => entry.kind === 'plugin')
        .sort((a, b) => a.id.localeCompare(b.id));

    const installedPluginIds = installedPlugins.map((plugin) => plugin.id);
    const installedSet = new Set(installedPluginIds);
    const enabledPluginIds = Array.from(
        new Set(enabledConfigured.filter((id) => installedSet.has(id)))
    ).sort((a, b) => a.localeCompare(b));

    const runtime: PluginRuntimeManifestResponse['runtime'] = {};
    for (const plugin of installedPlugins) {
        runtime[plugin.id] = {
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
        };
    }

    const revision = buildRevision({
        workspaceId,
        enabledPluginIds,
        installed: installedPlugins.map((plugin) => ({
            id: plugin.id,
            version: plugin.version,
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
        })),
    });

    return {
        workspaceId,
        enabledPluginIds,
        installedPluginIds,
        runtime,
        revision,
    };
});
