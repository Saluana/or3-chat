import type { H3Event } from 'h3';
import type { PluginGateDecision } from '../../../shared/plugins/access-policy';
import type { ModuleV2RuntimeDecision } from '../../../shared/plugins/module-v2-runtime-policy';
import type { PluginRuntimeManifestBlockCode } from '../../../shared/plugins/runtime-manifest';
import { resolvePluginV2DependencyGraph } from '../../../shared/plugins/v2-dependency-graph';
import { verifyPluginV2Compatibility } from '../../../shared/plugins/v2-compatibility';
import { checkPluginAccess } from '../../utils/plugins/access/require-plugin-access';
import type { WorkspaceSettingsStore } from '../stores/types';
import { getPluginGrantReview } from './workspace-plugin-store';
import type { SelectedPackageRouteCatalog } from './package-route-catalog';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from './v2-host-capabilities';

export type ReadySelectedPackageRouteCatalog = Extract<
    SelectedPackageRouteCatalog,
    { status: 'ready' }
>;

export interface SelectedPackageRuntimeEligibility {
    readonly catalog: ReadySelectedPackageRouteCatalog;
    readonly status: 'ready' | 'blocked';
    readonly blockCode?: PluginRuntimeManifestBlockCode;
    readonly access: PluginGateDecision;
    readonly grantsRevision: string;
    readonly resolvedDependencyIds: readonly string[];
}

export interface EvaluateSelectedPackageRuntimeEligibilityInput {
    readonly event: H3Event;
    readonly workspaceId: string;
    readonly settingsStore: WorkspaceSettingsStore;
    readonly selectedPackages: readonly ReadySelectedPackageRouteCatalog[];
    readonly packageRuntimeDecision: ModuleV2RuntimeDecision;
}

type BaseEligibility = {
    readonly catalog: ReadySelectedPackageRouteCatalog;
    readonly access: PluginGateDecision;
    readonly grantsRevision: string;
    readonly blockCode?: PluginRuntimeManifestBlockCode;
    readonly dependencies: readonly string[];
    readonly optionalDependencies: readonly string[];
};

function compatibilityBlockCode(input: {
    readonly reasons: readonly { code: string }[];
}): PluginRuntimeManifestBlockCode {
    return input.reasons.some((reason) => reason.code.includes('dependency'))
        ? 'package-dependency-blocked'
        : 'package-trust-unsupported';
}

/**
 * Evaluates the selected immutable package set for one request/workspace.
 * Package descriptors, route dispatch, and asset reads must use this same
 * gate so a blocked package cannot remain executable through a side route.
 */
export async function evaluateSelectedPackageRuntimeEligibility(
    input: EvaluateSelectedPackageRuntimeEligibilityInput
): Promise<readonly SelectedPackageRuntimeEligibility[]> {
    const dependencyGraph = resolvePluginV2DependencyGraph(
        input.selectedPackages.map((catalog) => ({
            id: catalog.pluginId,
            version: catalog.manifest.version,
            dependencies: catalog.manifest.dependencies,
        }))
    );
    const availableDependencies = input.selectedPackages.map((catalog) => ({
        id: catalog.pluginId,
        version: catalog.manifest.version,
        features: [
            ...catalog.manifest.features.required,
            ...catalog.manifest.features.optional,
        ],
    }));

    const evaluated = await Promise.all(
        input.selectedPackages.map(async (catalog) => {
            const [access, review] = await Promise.all([
                checkPluginAccess(input.event, {
                    pluginId: catalog.pluginId,
                    action: 'runtime.load',
                    extension: { access: catalog.manifest.access ?? null },
                }),
                getPluginGrantReview(
                    input.settingsStore,
                    input.workspaceId,
                    catalog.pluginId,
                    catalog.manifest.requestedGrants
                ),
            ]);
            const dependencyResolution = dependencyGraph.resolutions[catalog.pluginId];
            let blockCode: PluginRuntimeManifestBlockCode | undefined;
            if (!input.packageRuntimeDecision.allowed) {
                blockCode = input.packageRuntimeDecision.code;
            } else if (!access.decision.allowed) {
                blockCode = 'package-policy-denied';
            } else if (!dependencyResolution || dependencyGraph.blocked[catalog.pluginId]) {
                blockCode = 'package-dependency-blocked';
            } else if (review.status !== 'current') {
                blockCode = 'package-grants-unreviewed';
            } else {
                const compatibility = verifyPluginV2Compatibility({
                    manifest: catalog.manifest,
                    host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
                    dependencies: availableDependencies.filter(
                        (dependency) => dependency.id !== catalog.pluginId
                    ),
                });
                if (compatibility.status === 'blocked') {
                    blockCode = compatibilityBlockCode(compatibility);
                } else if (catalog.manifest.runtime.client) {
                    // The production host currently supports server-only V2
                    // packages. No client package is executable or asset-readable
                    // until the separate client ABI release lands.
                    blockCode = 'trusted-host-ui-abi-unproven';
                }
            }
            return {
                catalog,
                access: access.decision,
                grantsRevision: review.revision,
                blockCode,
                dependencies: dependencyResolution?.required ?? [],
                optionalDependencies: dependencyResolution?.optionalAvailable ?? [],
            } satisfies BaseEligibility;
        })
    );

    const baseById = new Map(evaluated.map((entry) => [entry.catalog.pluginId, entry]));
    const resolved = new Map<string, boolean>();
    const resolving = new Set<string>();
    const runtimeBlocks = new Map<string, PluginRuntimeManifestBlockCode>();

    const isReady = (pluginId: string): boolean => {
        const cached = resolved.get(pluginId);
        if (cached !== undefined) return cached;
        const entry = baseById.get(pluginId);
        if (!entry || entry.blockCode) {
            runtimeBlocks.set(pluginId, entry?.blockCode ?? 'package-dependency-blocked');
            resolved.set(pluginId, false);
            return false;
        }
        if (resolving.has(pluginId)) {
            runtimeBlocks.set(pluginId, 'package-dependency-blocked');
            resolved.set(pluginId, false);
            return false;
        }
        resolving.add(pluginId);
        const requiredReady = entry.dependencies.every(isReady);
        resolving.delete(pluginId);
        if (!requiredReady) {
            runtimeBlocks.set(pluginId, 'package-dependency-blocked');
            resolved.set(pluginId, false);
            return false;
        }
        resolved.set(pluginId, true);
        return true;
    };

    return Object.freeze(
        evaluated.map((entry) => {
            const ready = isReady(entry.catalog.pluginId);
            const blockCode = ready
                ? undefined
                : runtimeBlocks.get(entry.catalog.pluginId) ?? entry.blockCode ?? 'package-dependency-blocked';
            const resolvedDependencyIds = ready
                ? Object.freeze([
                      ...entry.dependencies,
                      ...entry.optionalDependencies.filter(isReady),
                  ])
                : Object.freeze([]);
            return Object.freeze({
                catalog: entry.catalog,
                status: ready ? 'ready' : 'blocked',
                ...(blockCode ? { blockCode } : {}),
                access: entry.access,
                grantsRevision: entry.grantsRevision,
                resolvedDependencyIds,
            });
        })
    );
}
