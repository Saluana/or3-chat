import type {
    PluginDescriptor,
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

export type PluginRuntimeManifestBlockCode =
    | 'legacy-v2-reinstall-required'
    | 'module-loader-disabled'
    | 'module-loader-static-host'
    | 'module-loader-outside-canary'
    | 'package-pointer-unavailable'
    | 'package-manifest-invalid'
    | 'package-policy-denied'
    | 'package-grants-unreviewed'
    | 'package-dependency-blocked'
    | 'package-trust-unsupported'
    | 'trusted-host-ui-abi-unproven';

export type PluginRuntimeManifestEntry = PluginRuntimeManifestEntryBase &
    (
        | {
              descriptorStatus: 'ready';
              descriptor: PluginDescriptor;
              rebuildRequiredReason?: never;
              blockCode?: never;
          }
        | {
              descriptorStatus: 'rebuild-required';
              descriptor?: never;
              rebuildRequiredReason: 'not-in-host-build' | 'entrypoint-mismatch';
              blockCode?: never;
          }
        | {
              descriptorStatus: 'blocked';
              descriptor?: never;
              rebuildRequiredReason?: never;
              blockCode: PluginRuntimeManifestBlockCode;
          }
    );

export interface PluginRuntimeManifestResponse {
    workspaceId: string | null;
    enabledPluginIds: string[];
    installedPluginIds: string[];
    runtime: Record<string, PluginRuntimeManifestEntry>;
    revision: string;
}
