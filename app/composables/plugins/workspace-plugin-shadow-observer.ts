import type { BundledPluginCatalog } from '~~/shared/plugins/bundled-plugin-catalog';
import {
    createDescriptorResolver,
    type DescriptorResolver,
} from '~~/shared/plugins/descriptor-resolver';
import type { PluginRuntimeManifestEntry } from '~~/shared/plugins/runtime-manifest';
import { getShadowPluginManager, type ShadowPluginManager } from './shadow-plugin-manager';

export interface WorkspacePluginShadowObserver {
    observeStop(pluginId: string): void;
    recordDivergence(input: {
        pluginId: string;
        workspaceId: string;
        runtimeEntry?: PluginRuntimeManifestEntry;
    }): void;
    observeActivation(input: {
        pluginId: string;
        workspaceId: string;
        runtimeEntry?: PluginRuntimeManifestEntry;
        isStillManaged: () => boolean;
    }): void;
}

export interface CreateWorkspacePluginShadowObserverOptions {
    enabled: boolean;
    catalog: BundledPluginCatalog;
    createResolver?: (catalog: BundledPluginCatalog) => DescriptorResolver;
    getManager?: () => ShadowPluginManager;
}

/**
 * Creates the Milestone 1 observer only when selected at process startup.
 * Returning null is the rollback seam: no resolver, manager, token map, or
 * diagnostic callback exists on the authoritative V1 loader path.
 */
export function createWorkspacePluginShadowObserver(
    options: CreateWorkspacePluginShadowObserverOptions
): WorkspacePluginShadowObserver | null {
    if (!options.enabled) return null;

    const descriptorResolver = (options.createResolver ?? createDescriptorResolver)(
        options.catalog
    );
    const shadowManager = (options.getManager ?? getShadowPluginManager)();
    const observationTokens = new Map<string, symbol>();

    return {
        observeStop(pluginId) {
            observationTokens.delete(pluginId);
            shadowManager.observeManagedStop(pluginId);
        },
        recordDivergence({ pluginId, workspaceId, runtimeEntry }) {
            shadowManager.recordDivergence({
                kind:
                    runtimeEntry?.descriptorStatus === 'rebuild-required'
                        ? 'rebuild-required'
                        : 'desired-not-observed',
                desiredPluginId: pluginId,
                desiredSource: 'extension',
                desiredWorkspaceId: workspaceId,
                rebuildRequiredReason:
                    runtimeEntry?.descriptorStatus === 'rebuild-required'
                        ? runtimeEntry.rebuildRequiredReason
                        : undefined,
            });
        },
        observeActivation({ pluginId, workspaceId, runtimeEntry, isStillManaged }) {
            const token = Symbol(pluginId);
            observationTokens.set(pluginId, token);
            void descriptorResolver
                .resolveBundled({ pluginId, workspaceId, runtimeEntry })
                .then((resolution) => {
                    if (observationTokens.get(pluginId) !== token || !isStillManaged()) {
                        return;
                    }
                    if (resolution.status !== 'ready') {
                        shadowManager.recordDivergence({
                            kind:
                                resolution.failure.code === 'rebuild-required'
                                    ? 'rebuild-required'
                                    : resolution.failure.code === 'workspace-id-mismatch'
                                      ? 'workspace-mismatch'
                                      : 'identity-mismatch',
                            desiredPluginId: pluginId,
                            observedPluginId: pluginId,
                            desiredSource: 'extension',
                            observedSource: 'extension',
                            desiredWorkspaceId: workspaceId,
                            observedWorkspaceId: workspaceId,
                            rebuildRequiredReason:
                                runtimeEntry?.descriptorStatus === 'rebuild-required'
                                    ? runtimeEntry.rebuildRequiredReason
                                    : undefined,
                        });
                        return;
                    }
                    shadowManager.observeManagedActivation({
                        descriptor: resolution.descriptor,
                        lifecycleCoverage:
                            runtimeEntry?.lifecycleCoverage ?? 'legacy-global-possible',
                    });
                });
        },
    };
}

