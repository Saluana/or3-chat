import { defineEventHandler, setResponseHeader } from 'h3';
import { requireAdminApiContext } from '../../admin/api';
import { useRuntimeConfig } from '#imports';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import { PluginPackageRouteCatalog } from '../../admin/plugins/package-route-catalog';
import { PluginAcquisitionOperationStore } from '../../utils/plugins/acquisition/operation-store';
import { acquisitionConfig } from '../../utils/plugins/acquisition/config';
import { RegistryStateStore } from '../../utils/plugins/acquisition/registry-state';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../admin/plugins/v2-host-capabilities';

/**
 * A redacted support report an operator can paste into a conversation.
 *
 * What it contains: versions, mode, capability declaration, marketplace
 * configuration state, per-plugin package digests/pointers/startup status,
 * acquisition operation ids and failure codes, and advisory sequence position.
 *
 * What it deliberately never contains: plugin settings values, connection
 * secrets or names, chat messages or documents, authorization headers or
 * cookies, token or signed URLs, and payment payloads. Digests are identities,
 * not secrets, and operation ids are needed to look an operation up.
 */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, { ownerOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const config = useRuntimeConfig();
    const workspaceId = context.session?.workspace?.id ?? '';
    const settingsStore = getWorkspaceSettingsStore(event);
    const marketplace = acquisitionConfig();
    const catalog = new PluginPackageRouteCatalog();
    const registryState = new RegistryStateStore();
    const [installed, enabled, selected, state] = await Promise.all([
        listInstalledExtensions(),
        workspaceId ? getEnabledPlugins(settingsStore, workspaceId) : Promise.resolve([]),
        catalog.listSelected(),
        registryState.read().catch(() => null),
    ]);

    let operations: readonly Record<string, unknown>[] = [];
    try {
        operations = (await new PluginAcquisitionOperationStore().list()).map((operation) => ({
            operationId: operation.operationId,
            pluginId: operation.pluginId,
            version: operation.version,
            stage: operation.stage,
            status: operation.status,
            attempts: operation.attempts,
            retryable: operation.failure?.retryable ?? false,
            failureCode: operation.failure?.code ?? null,
        }));
    } catch {
        operations = [];
    }

    return {
        reportVersion: 1,
        generatedAt: new Date().toISOString(),
        host: {
            appVersion:
                typeof (config.public as { appVersion?: unknown }).appVersion === 'string'
                    ? (config.public as { appVersion: string }).appVersion
                    : 'unknown',
            pluginApiVersion: OR3_PLUGIN_V2_HOST_CAPABILITIES.pluginApiVersion,
            mode: config.public?.ssrAuthEnabled === true ? 'cloud' : 'local',
            ssrAuthEnabled: config.public?.ssrAuthEnabled === true,
            pluginRuntimeLoaderEnabled:
                (config.public?.admin as { pluginRuntimeLoaderEnabled?: boolean } | undefined)
                    ?.pluginRuntimeLoaderEnabled !== false,
            v2Host: {
                trustModes: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedTrustModes],
                grants: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedGrants],
                features: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedFeatures],
            },
        },
        marketplace: {
            configured: marketplace.registryOrigin.length > 0 && marketplace.releaseKeys.length > 0,
            installEnabled: marketplace.installEnabled,
            origin: marketplace.registryOrigin,
            trustedKeys: marketplace.releaseKeys.length,
            acceptedAdvisorySequence: state?.acceptedAdvisorySequence ?? null,
            supportedProfiles: [...marketplace.supportedProfiles],
        },
        workspace: {
            workspaceId,
            enabledPlugins: [...enabled].sort(),
            installedPackages: selected.map((entry) =>
                entry.status === 'ready'
                    ? {
                          pluginId: entry.pluginId,
                          status: 'ready',
                          packageDigest: entry.packageDigest,
                          trust: entry.manifest.trust,
                          clientEntry: entry.manifest.runtime.client?.entry ?? null,
                          serverRoutes: entry.routes.length,
                      }
                    : {
                          pluginId: entry.pluginId,
                          status: entry.status,
                          blockCode: entry.status === 'blocked' ? entry.blockCode : null,
                      }
            ),
        },
        installedExtensions: installed
            .filter((extension) => extension.kind === 'plugin')
            .map((extension) => ({ id: extension.id, version: extension.version })),
        operations,
        redaction: {
            note: 'Settings values, connection secrets, message content, credentials and signed URLs are never included.',
            omitted: [
                'plugin settings values',
                'connection names and secrets',
                'chat and document content',
                'authorization headers and cookies',
                'token and signed download URLs',
            ],
        },
    };
});
