import { createHash } from 'node:crypto';
import { defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { bundledPluginCatalog } from '#or3-bundled-plugin-catalog';
import { resolveSessionContext } from '../../auth/session';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import {
    getEnabledPlugins,
    getPluginSettings,
    readPluginAccessPolicy,
} from '../../admin/plugins/workspace-plugin-store';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { checkPluginAccess } from '../../utils/plugins/access/require-plugin-access';
import { createDescriptorKey } from '../../../shared/plugins/descriptor-key';
import { resolveBundledPluginArtifact } from '../../../shared/plugins/bundled-plugin-catalog';
import { mergePluginGatePolicy } from '../../../shared/plugins/access-policy';
import type {
    BundledV1PluginDescriptor,
    PluginDescriptorIdentity,
} from '../../../shared/plugins/runtime-descriptor';
import type { PluginRuntimeManifestResponse } from '../../../shared/plugins/runtime-manifest';
import { isNonCorePluginDiscoveryDisabled } from '../../../shared/plugins/safe-mode';
import { LEGACY_LIFECYCLE_COVERAGE } from '../../../shared/plugins/legacy-plugin-scope';
import {
    createLegacyV1GrantsRevision,
    createPluginPolicyRevision,
} from '../../admin/plugins/plugin-revisions';

export type { PluginRuntimeManifestResponse } from '../../../shared/plugins/runtime-manifest';

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
    runtime: PluginRuntimeManifestResponse['runtime'];
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
    if (
        isNonCorePluginDiscoveryDisabled(
            runtimeConfig.admin as { disableNonCorePlugins?: boolean } | undefined
        )
    ) {
        return emptyManifest();
    }
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

    const settingsStore = getWorkspaceSettingsStore(event);
    const [installedExtensions, enabledConfigured] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId),
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

    const resolvedPlugins = await Promise.all(
        installedPlugins.map(async (plugin) => {
            const configured = configuredEnabled.includes(plugin.id);
            let loadAllowed = false;
            let loadDeniedReason: string | undefined = configured
                ? undefined
                : 'plugin-disabled';
            let effectivePolicy = mergePluginGatePolicy(plugin.access, null);

            if (configured) {
                const access = await checkPluginAccess(event, {
                    pluginId: plugin.id,
                    action: 'runtime.load',
                });
                loadAllowed = access.decision.allowed;
                effectivePolicy = access.decision.effectivePolicy;
                if (!loadAllowed) {
                    loadDeniedReason =
                        access.decision.reasons[0] ?? 'forbidden';
                }
            } else {
                try {
                    const settings = await getPluginSettings(
                        settingsStore,
                        workspaceId,
                        plugin.id
                    );
                    effectivePolicy = mergePluginGatePolicy(
                        plugin.access,
                        readPluginAccessPolicy(settings)
                    );
                } catch {
                    // Disabled plugins retain their conservative manifest policy.
                }
            }

            const base = {
                clientEntry: plugin.runtime?.client?.entry,
                hasServerRoutes: Boolean(
                    plugin.runtime?.server?.routes?.length
                ),
                loadAllowed,
                loadDeniedReason,
                mediatedLifecycleCoverage:
                    LEGACY_LIFECYCLE_COVERAGE.mediated,
                lifecycleCoverage: LEGACY_LIFECYCLE_COVERAGE.overall,
            };
            const artifactResolution = resolveBundledPluginArtifact(
                bundledPluginCatalog,
                plugin.id,
                plugin.runtime?.client?.entry
            );

            if (artifactResolution.status !== 'bundled') {
                return {
                    id: plugin.id,
                    loadAllowed,
                    entry: {
                        ...base,
                        descriptorStatus: 'rebuild-required' as const,
                        rebuildRequiredReason: artifactResolution.reason,
                    },
                };
            }

            const identity: PluginDescriptorIdentity = {
                id: plugin.id,
                version: plugin.version,
                manifestVersion: 1,
                pluginApiVersion: '1',
                source: 'extension',
                trust: 'trusted-host',
                workspaceId,
                policyRevision: createPluginPolicyRevision(effectivePolicy),
                grantsRevision: createLegacyV1GrantsRevision(
                    plugin.capabilities
                ),
                resolvedDependencyKeys: [],
                artifact: artifactResolution.artifact,
            };
            const descriptor: BundledV1PluginDescriptor = {
                ...identity,
                descriptorKey: await createDescriptorKey(identity),
            };
            return {
                id: plugin.id,
                loadAllowed,
                entry: {
                    ...base,
                    descriptorStatus: 'ready' as const,
                    descriptor,
                },
            };
        })
    );

    // Promise.all preserves input order, so the response and revision remain
    // deterministic while provider lookups and descriptor hashing run in parallel.
    for (const resolved of resolvedPlugins) {
        runtime[resolved.id] = resolved.entry;
        if (resolved.loadAllowed) enabledPluginIds.push(resolved.id);
    }

    const revision = buildRevision({
        workspaceId,
        enabledPluginIds,
        // Preserve every input from the opaque V1 revision while adding the
        // descriptor contract below. In particular, version changes must still
        // invalidate a rebuild-required plugin that has no descriptor yet.
        installed: installedPlugins.map((plugin) => ({
            id: plugin.id,
            version: plugin.version,
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
            loadAllowed: runtime[plugin.id]?.loadAllowed ?? false,
        })),
        runtime,
    });

    return {
        workspaceId,
        enabledPluginIds,
        installedPluginIds,
        runtime,
        revision,
    };
});
