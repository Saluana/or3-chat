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
import { canonicalJson, createDescriptorKey } from '../../../shared/plugins/descriptor-key';
import { resolveBundledPluginArtifact } from '../../../shared/plugins/bundled-plugin-catalog';
import {
    mergePluginGatePolicy,
    type PluginGatePolicyNormalized,
} from '../../../shared/plugins/access-policy';
import type {
    BundledV1PluginDescriptor,
    PluginDescriptorIdentity,
    Sha256,
} from '../../../shared/plugins/runtime-descriptor';
import type { PluginRuntimeManifestResponse } from '../../../shared/plugins/runtime-manifest';
import { isNonCorePluginDiscoveryDisabled } from '../../../shared/plugins/safe-mode';

export type { PluginRuntimeManifestResponse } from '../../../shared/plugins/runtime-manifest';

function contentRevision(kind: 'policy' | 'legacy-v1-grants', value: unknown): Sha256 {
    const source = canonicalJson({ kind, value });
    return `sha256-${createHash('sha256').update(source).digest('hex')}`;
}

function policyRevision(policy: PluginGatePolicyNormalized): Sha256 {
    return contentRevision('policy', {
        authRequired: policy.authRequired,
        mode: policy.mode,
        requiredEntitlements: [...policy.requiredEntitlements].sort(),
        requiredWorkspaceRoles: [...policy.requiredWorkspaceRoles].sort(),
    });
}

function grantsRevision(capabilities: readonly string[]): Sha256 {
    return contentRevision('legacy-v1-grants', {
        // V1 runs as trusted host code. Capabilities are declarations, not an
        // enforceable grant boundary, so preserve that truth in the identity.
        enforcement: 'legacy-unrestricted-host',
        declaredCapabilities: Array.from(new Set(capabilities)).sort(),
    });
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

    for (const plugin of installedPlugins) {
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
            if (!loadAllowed) loadDeniedReason = access.decision.reasons[0] ?? 'forbidden';
        } else {
            // Disabled V1 plugins were not previously passed through entitlement
            // resolution. Preserve that behavior while still reporting their
            // effective policy when the settings backend is available.
            try {
                const settings = await getPluginSettings(settingsStore, workspaceId, plugin.id);
                effectivePolicy = mergePluginGatePolicy(
                    plugin.access,
                    readPluginAccessPolicy(settings)
                );
            } catch {
                // The plugin stays disabled; manifest-default policy remains an
                // honest conservative identity without making a new dependency
                // capable of breaking the legacy response.
            }
        }

        const base = {
            clientEntry: plugin.runtime?.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
            loadAllowed,
            loadDeniedReason,
            lifecycleCoverage: 'legacy-global-possible' as const,
        };
        const artifactResolution = resolveBundledPluginArtifact(
            bundledPluginCatalog,
            plugin.id,
            plugin.runtime?.client?.entry
        );
        if (artifactResolution.status === 'bundled') {
            const identity: PluginDescriptorIdentity = {
                id: plugin.id,
                version: plugin.version,
                manifestVersion: 1,
                pluginApiVersion: '1',
                source: 'extension',
                trust: 'trusted-host',
                workspaceId,
                policyRevision: policyRevision(effectivePolicy),
                grantsRevision: grantsRevision(plugin.capabilities),
                resolvedDependencyKeys: [],
                artifact: artifactResolution.artifact,
            };
            const descriptor: BundledV1PluginDescriptor = {
                ...identity,
                descriptorKey: await createDescriptorKey(identity),
            };
            runtime[plugin.id] = {
                ...base,
                descriptorStatus: 'ready',
                descriptor,
            };
        } else {
            runtime[plugin.id] = {
                ...base,
                descriptorStatus: 'rebuild-required',
                rebuildRequiredReason: artifactResolution.reason,
            };
        }

        if (loadAllowed) {
            enabledPluginIds.push(plugin.id);
        }
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
