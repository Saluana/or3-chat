import { createHash } from 'node:crypto';
import { defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { bundledPluginCatalog } from '#or3-bundled-plugin-catalog';
import { resolveSessionContext } from '../../auth/session';
import { listInstalledExtensions } from '../../admin/extensions/extension-manager';
import { getWorkspaceSettingsStore } from '../../admin/stores/registry';
import {
    getEnabledPlugins,
    getPluginGrantReview,
    getPluginSettings,
    readPluginAccessPolicy,
} from '../../admin/plugins/workspace-plugin-store';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { checkPluginAccess } from '../../utils/plugins/access/require-plugin-access';
import { createDescriptorKey } from '~~/shared/plugins/descriptor-key';
import { resolveBundledPluginArtifact } from '../../../shared/plugins/bundled-plugin-catalog';
import { mergePluginGatePolicy } from '../../../shared/plugins/access-policy';
import type {
    BundledV1PluginDescriptor,
    PackageV2PluginDescriptor,
    PluginDescriptorIdentity,
} from '../../../shared/plugins/runtime-descriptor';
import type { PluginRuntimeManifestResponse } from '../../../shared/plugins/runtime-manifest';
import { isNonCorePluginDiscoveryDisabled } from '../../../shared/plugins/safe-mode';
import { LEGACY_LIFECYCLE_COVERAGE } from '../../../shared/plugins/legacy-plugin-scope';
import {
    createLegacyV1GrantsRevision,
    createPluginPolicyRevision,
} from '../../admin/plugins/plugin-revisions';
import { PluginPackageRouteCatalog } from '../../admin/plugins/package-route-catalog';
import { createModuleV2RuntimePolicy } from '../../../shared/plugins/module-v2-runtime-policy';
import { verifyPluginV2Compatibility } from '../../../shared/plugins/v2-compatibility';
import { resolvePluginV2DependencyGraph } from '../../../shared/plugins/v2-dependency-graph';
import type { Or3ExtensionManifestV2 } from '../../admin/extensions/types';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../admin/plugins/v2-host-capabilities';

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

function isLegacyV2Plugin(
    plugin: Awaited<ReturnType<typeof listInstalledExtensions>>[number]
): plugin is Or3ExtensionManifestV2 & { path: string } {
    return (
        plugin.kind === 'plugin' &&
        'manifestVersion' in plugin &&
        (plugin as { manifestVersion?: unknown }).manifestVersion === 2
    );
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
    const packagePolicy = createModuleV2RuntimePolicy({
        enabled:
            (runtimeConfig.admin as { pluginModuleLoaderV2Enabled?: boolean } | undefined)
                ?.pluginModuleLoaderV2Enabled === true,
        ssrHost: true,
        workspaceIds:
            (runtimeConfig.admin as { pluginModuleLoaderV2WorkspaceIds?: string[] } | undefined)
                ?.pluginModuleLoaderV2WorkspaceIds ?? [],
    });
    const packageCatalog = new PluginPackageRouteCatalog();
    const [installedExtensions, enabledConfigured, selectedPackageCatalogs] = await Promise.all([
        listInstalledExtensions(),
        getEnabledPlugins(settingsStore, workspaceId),
        // This is metadata-only pointer/manifest inspection. Policy still
        // runs before any package module can be imported, while operators get
        // a stable blocked reason instead of a mysteriously missing package.
        packageCatalog.listSelected(),
    ]);

    const installedPlugins = installedExtensions
        .filter((entry) => entry.kind === 'plugin')
        .sort((a, b) => a.id.localeCompare(b.id));
    const bundledV1Plugins = installedPlugins.filter((plugin) => !isLegacyV2Plugin(plugin));
    const legacyV2Plugins = installedPlugins.filter(isLegacyV2Plugin);
    const selectedPackages = selectedPackageCatalogs.filter(
        (catalog): catalog is Extract<typeof catalog, { status: 'ready' }> =>
            catalog.status === 'ready'
    );
    const installedPluginIds = Array.from(
        new Set([
            ...installedPlugins.map((plugin) => plugin.id),
            ...selectedPackages.map((catalog) => catalog.pluginId),
        ])
    ).sort((a, b) => a.localeCompare(b));
    const installedSet = new Set(installedPluginIds);
    const configuredEnabled = Array.from(
        new Set(enabledConfigured.filter((id) => installedSet.has(id)))
    ).sort((a, b) => a.localeCompare(b));

    const runtime: PluginRuntimeManifestResponse['runtime'] = {};
    const enabledPluginIds: string[] = [];

    const resolvedPlugins = await Promise.all(
        bundledV1Plugins.map(async (plugin) => {
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

    // A V2 archive accepted by the former ZIP installer is not an executable
    // V1 module. Preserve it on disk and make the recovery action explicit.
    for (const plugin of legacyV2Plugins) {
        runtime[plugin.id] = {
            clientEntry: plugin.runtime.client?.entry,
            hasServerRoutes: Boolean(plugin.runtime.server?.routes.length),
            loadAllowed: false,
            loadDeniedReason: 'legacy-v2-reinstall-required',
            lifecycleCoverage: 'managed-v2',
            descriptorStatus: 'blocked',
            blockCode: 'legacy-v2-reinstall-required',
        };
    }

    const packageRuntimeDecision = packagePolicy(workspaceId);
    const availableDependencies = selectedPackages.map((catalog) => ({
        id: catalog.pluginId,
        version: catalog.manifest.version,
        features: [
            ...catalog.manifest.features.required,
            ...catalog.manifest.features.optional,
        ],
    }));
    const selectedPackageById = new Map(
        selectedPackages.map((catalog) => [catalog.pluginId, catalog] as const)
    );
    // Compatibility verifies host APIs/features. The graph additionally makes
    // the selected package set atomic: cycles and transitive blocked required
    // dependencies cannot leak into a descriptor key.
    const dependencyGraph = resolvePluginV2DependencyGraph(
        selectedPackages.map((catalog) => ({
            id: catalog.pluginId,
            version: catalog.manifest.version,
            dependencies: catalog.manifest.dependencies,
        }))
    );
    const resolvedPackages = await Promise.all(
        selectedPackages.map(async (catalog) => {
            const manifest = catalog.manifest;
            const configured = configuredEnabled.includes(catalog.pluginId);
            let loadAllowed = false;
            let loadDeniedReason: string | undefined = configured
                ? undefined
                : 'plugin-disabled';
            let effectivePolicy = mergePluginGatePolicy(manifest.access, null);

            if (configured) {
                const access = await checkPluginAccess(event, {
                    pluginId: catalog.pluginId,
                    action: 'runtime.load',
                    extension: { access: manifest.access ?? null },
                });
                loadAllowed = access.decision.allowed;
                effectivePolicy = access.decision.effectivePolicy;
                if (!loadAllowed) {
                    loadDeniedReason = access.decision.reasons[0] ?? 'forbidden';
                }
            } else {
                try {
                    const settings = await getPluginSettings(
                        settingsStore,
                        workspaceId,
                        catalog.pluginId
                    );
                    effectivePolicy = mergePluginGatePolicy(
                        manifest.access,
                        readPluginAccessPolicy(settings)
                    );
                } catch {
                    // Disabled packages retain their conservative manifest policy.
                }
            }

            const base = {
                clientEntry: manifest.runtime.client?.entry,
                hasServerRoutes: Boolean(manifest.runtime.server?.routes?.length),
                loadAllowed,
                loadDeniedReason,
                lifecycleCoverage: 'managed-v2' as const,
            };
            if (!packageRuntimeDecision.allowed) {
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        loadAllowed: false,
                        loadDeniedReason: packageRuntimeDecision.code,
                        descriptorStatus: 'blocked' as const,
                        blockCode: packageRuntimeDecision.code,
                    },
                };
            }
            if (!loadAllowed) {
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        descriptorStatus: 'blocked' as const,
                        blockCode: 'package-policy-denied' as const,
                    },
                };
            }

            const dependencyResolution = dependencyGraph.resolutions[catalog.pluginId];
            if (!dependencyResolution || dependencyGraph.blocked[catalog.pluginId]) {
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        loadAllowed: false,
                        loadDeniedReason: 'package-dependency-blocked',
                        descriptorStatus: 'blocked' as const,
                        blockCode: 'package-dependency-blocked' as const,
                    },
                };
            }

            const review = await getPluginGrantReview(
                settingsStore,
                workspaceId,
                catalog.pluginId,
                manifest.requestedGrants
            );
            if (review.status !== 'current') {
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        loadAllowed: false,
                        loadDeniedReason: 'package-grants-unreviewed',
                        descriptorStatus: 'blocked' as const,
                        blockCode: 'package-grants-unreviewed' as const,
                    },
                };
            }
            const compatibility = verifyPluginV2Compatibility({
                manifest,
                host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
                dependencies: availableDependencies.filter(
                    (dependency) => dependency.id !== catalog.pluginId
                ),
            });
            if (compatibility.status === 'blocked') {
                const dependencyBlocked = compatibility.reasons.some((reason) =>
                    reason.code.includes('dependency')
                );
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        loadAllowed: false,
                        loadDeniedReason: dependencyBlocked
                            ? 'package-dependency-blocked'
                            : 'package-trust-unsupported',
                        descriptorStatus: 'blocked' as const,
                        blockCode: dependencyBlocked
                            ? ('package-dependency-blocked' as const)
                            : ('package-trust-unsupported' as const),
                    },
                };
            }
            // The production host-ABI gate remains intentionally closed. A
            // server-only V2 package can be selected now; client UI waits for
            // the dedicated ESM/Vue/SDK/CSP qualification release.
            if (manifest.runtime.client) {
                return {
                    id: catalog.pluginId,
                    loadAllowed: false,
                    entry: {
                        ...base,
                        loadAllowed: false,
                        loadDeniedReason: 'trusted-host-ui-abi-unproven',
                        descriptorStatus: 'blocked' as const,
                        blockCode: 'trusted-host-ui-abi-unproven' as const,
                    },
                };
            }

            const identity: PluginDescriptorIdentity = {
                id: catalog.pluginId,
                version: manifest.version,
                manifestVersion: 2,
                pluginApiVersion: OR3_PLUGIN_V2_HOST_CAPABILITIES.pluginApiVersion,
                source: 'package',
                trust: manifest.trust,
                workspaceId,
                policyRevision: createPluginPolicyRevision(effectivePolicy),
                grantsRevision: review.revision,
                // Package digests are immutable content identities. Including
                // every resolved direct dependency makes a dependent descriptor
                // change whenever a selected dependency is promoted.
                resolvedDependencyKeys: [
                    ...dependencyResolution.required,
                    ...dependencyResolution.optionalAvailable,
                ].map((dependencyId) => selectedPackageById.get(dependencyId)!.packageDigest),
                artifact: {
                    kind: 'package-v2',
                    packageDigest: catalog.packageDigest,
                    serverRoutes: manifest.runtime.server?.routes.map((route) => ({
                        method: route.method,
                        path: route.path,
                        handler: route.handler,
                    })) ?? [],
                },
            };
            const descriptor: PackageV2PluginDescriptor = {
                ...identity,
                descriptorKey: await createDescriptorKey(identity),
            };
            return {
                id: catalog.pluginId,
                loadAllowed: true,
                entry: {
                    ...base,
                    descriptorStatus: 'ready' as const,
                    descriptor,
                },
            };
        })
    );
    for (const resolved of resolvedPackages) {
        runtime[resolved.id] = resolved.entry;
        if (resolved.loadAllowed) enabledPluginIds.push(resolved.id);
    }
    enabledPluginIds.sort((left, right) => left.localeCompare(right));

    const revision = buildRevision({
        workspaceId,
        enabledPluginIds,
        // Preserve every input from the opaque V1 revision while adding the
        // descriptor contract below. In particular, version changes must still
        // invalidate a rebuild-required plugin that has no descriptor yet.
        installed: [
            ...installedPlugins.map((plugin) => ({
                id: plugin.id,
                version: plugin.version,
                clientEntry: plugin.runtime?.client?.entry,
                hasServerRoutes: Boolean(plugin.runtime?.server?.routes?.length),
                loadAllowed: runtime[plugin.id]?.loadAllowed ?? false,
            })),
            ...selectedPackages
                .filter((catalog) => !installedPlugins.some((plugin) => plugin.id === catalog.pluginId))
                .map((catalog) => ({
                    id: catalog.pluginId,
                    version: catalog.manifest.version,
                    clientEntry: catalog.manifest.runtime.client?.entry,
                    hasServerRoutes: Boolean(catalog.manifest.runtime.server?.routes.length),
                    loadAllowed: runtime[catalog.pluginId]?.loadAllowed ?? false,
                })),
        ],
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
