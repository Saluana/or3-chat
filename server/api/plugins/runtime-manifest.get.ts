import { createHash } from 'node:crypto';
import { defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../auth/session';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { checkPluginAccess } from '../../utils/plugins/access/require-plugin-access';

export interface PluginRuntimeManifestResponse {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installedPluginIds: string[];
    runtime: Record<
        string,
        {
            clientEntry?: string;
            hasServerRoutes: boolean;
            /** Server-authoritative decision: client may import/register this plugin. */
            loadAllowed: boolean;
            loadDeniedReason?: string;
        }
    >;
    revision: string;
}

function buildRevision(payload: {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installed: Array<{
        id: string;
        version: string;
        clientEntry?: string;
        hasServerRoutes: boolean;
        loadAllowed: boolean;
    }>;
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
    const configuredEnabled = Array.from(
        new Set(enabledConfigured.filter((id) => installedSet.has(id)))
    ).sort((a, b) => a.localeCompare(b));

    const runtime: PluginRuntimeManifestResponse['runtime'] = {};
    const enabledPluginIds: string[] = [];

    for (const plugin of installedPlugins) {
        const configured = configuredEnabled.includes(plugin.id);
        let loadAllowed = false;
        let loadDeniedReason: string | undefined = configured
            ? undefined
            : 'plugin-disabled';

        if (configured) {
            const access = await checkPluginAccess(event, {
                pluginId: plugin.id,
                action: 'runtime.load',
            });
            loadAllowed = access.decision.allowed;
            if (!loadAllowed) {
                loadDeniedReason = access.decision.reasons[0] ?? 'forbidden';
            }
        }

        runtime[plugin.id] = {
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
            loadAllowed,
            loadDeniedReason,
        };

        if (loadAllowed) {
            enabledPluginIds.push(plugin.id);
        }
    }

    const revision = buildRevision({
        workspaceId,
        enabledPluginIds,
        installed: installedPlugins.map((plugin) => ({
            id: plugin.id,
            version: plugin.version,
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
            loadAllowed: runtime[plugin.id]?.loadAllowed ?? false,
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
