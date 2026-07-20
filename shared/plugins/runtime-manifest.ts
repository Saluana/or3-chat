import type {
    BundledV1PluginDescriptor,
    PluginLifecycleCoverage,
} from './runtime-descriptor';

/** Fields consumed by the pre-V2 workspace loader. Keep these additive and stable. */
export interface LegacyPluginRuntimeManifestEntry {
    clientEntry?: string;
    hasServerRoutes: boolean;
    loadAllowed: boolean;
    loadDeniedReason?: string;
    /** Additive ownership detail; overall V1 coverage stays conservative. */
    mediatedLifecycleCoverage?: Extract<PluginLifecycleCoverage, 'managed-v1-api'>;
}

interface PluginRuntimeManifestEntryBase extends LegacyPluginRuntimeManifestEntry {
    lifecycleCoverage: PluginLifecycleCoverage;
}

export type PluginRuntimeManifestEntry = PluginRuntimeManifestEntryBase &
    (
        | {
              descriptorStatus: 'ready';
              descriptor: BundledV1PluginDescriptor;
              rebuildRequiredReason?: never;
          }
        | {
              descriptorStatus: 'rebuild-required';
              descriptor?: never;
              rebuildRequiredReason: 'not-in-host-build' | 'entrypoint-mismatch';
          }
    );

export interface PluginRuntimeManifestResponse {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installedPluginIds: string[];
    runtime: Record<string, PluginRuntimeManifestEntry>;
    revision: string;
}
