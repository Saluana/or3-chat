/** A host-computed SHA-256 identity, never a plugin-reported version or digest. */
export type Sha256 = `sha256-${string}`;

export type PluginServerRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A package route after its path and handler entrypoint have been validated. */
export interface ResolvedServerRoute {
    readonly method: PluginServerRouteMethod;
    readonly path: string;
    readonly handler: string;
}

/** Executable identity for code captured in the host's production module graph. */
export interface BundledV1ArtifactIdentity {
    readonly kind: 'bundled-v1';
    readonly hostBuildId: string;
    readonly moduleKey: string;
    readonly rebuildRequired: true;

    /** Package-only fields are forbidden even through structurally wider values. */
    readonly packageDigest?: never;
    readonly clientEntry?: never;
    readonly client?: never;
    readonly serverRoutes?: never;
}

/**
 * The digest-addressed client entry a contained sandbox will run. The digest is
 * the host's own hash of the immutable stored bytes, so the browser can verify
 * what it was served instead of trusting the package or the network.
 */
export interface PackageV2ClientEntry {
    readonly entry: string;
    readonly isolation: 'iframe' | 'worker';
    readonly digest: Sha256;
}

/** Executable identity for a verified, digest-addressed runtime package. */
export interface PackageV2ArtifactIdentity {
    readonly kind: 'package-v2';
    readonly packageDigest: Sha256;
    readonly clientEntry?: string;
    readonly client?: PackageV2ClientEntry;
    readonly serverRoutes: readonly ResolvedServerRoute[];

    /** Bundled-only fields must never be used to imply a runtime package identity. */
    readonly hostBuildId?: never;
    readonly moduleKey?: never;
    readonly rebuildRequired?: never;
}

export type PluginArtifactIdentity =
    | BundledV1ArtifactIdentity
    | PackageV2ArtifactIdentity;

export type PluginSource = 'builtin' | 'extension' | 'package';
export type PluginTrustMode = 'trusted-host' | 'isolated-client' | 'isolated-server';
export type PluginLifecycleCoverage =
    | 'managed-v2'
    | 'managed-v1-api'
    | 'legacy-global-possible';

interface PluginDescriptorBase {
    readonly id: string;
    readonly version: string;
    readonly pluginApiVersion: string;
    readonly workspaceId: string;
    readonly policyRevision: string;
    readonly grantsRevision: string;
    readonly resolvedDependencyKeys: readonly string[];
    readonly descriptorKey: Sha256;
}

export interface BundledV1PluginDescriptor extends PluginDescriptorBase {
    readonly manifestVersion: 1;
    readonly source: 'builtin' | 'extension';
    readonly trust: 'trusted-host';
    readonly artifact: BundledV1ArtifactIdentity;
}

export interface PackageV2PluginDescriptor extends PluginDescriptorBase {
    readonly manifestVersion: 2;
    readonly source: 'package';
    readonly trust: PluginTrustMode;
    /** Display name from the reviewed manifest, for host UI labels. */
    readonly name: string;
    readonly description?: string;
    /** Validated package-relative app icon and immutable asset URL metadata. */
    readonly icon?: {
        readonly path: string;
        readonly mediaType: 'image/png' | 'image/webp';
    };
    /** Signed authority digest covered by the workspace review, when known. */
    readonly authoritySha256?: Sha256 | null;
    /**
     * Grants the workspace actually approved for this plugin. The contained
     * client registers a capability only when its grant appears here, so the
     * browser enforces the same authority the server does.
     */
    readonly effectiveGrants: readonly string[];
    readonly artifact: PackageV2ArtifactIdentity;
}

export type PluginDescriptor = BundledV1PluginDescriptor | PackageV2PluginDescriptor;

export type PluginDescriptorIdentity = PluginDescriptor extends infer Descriptor
    ? Descriptor extends PluginDescriptor
        ? Omit<Descriptor, 'descriptorKey'>
        : never
    : never;

/** Narrows the only artifact kind whose bytes can change without rebuilding the host. */
export function isPostBuildReloadableArtifact(
    artifact: PluginArtifactIdentity
): artifact is PackageV2ArtifactIdentity {
    return artifact.kind === 'package-v2';
}
