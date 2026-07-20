import type {
    BundledV1ArtifactIdentity,
    PackageV2ArtifactIdentity,
    PluginArtifactIdentity,
    PluginDescriptorIdentity,
    ResolvedServerRoute,
    Sha256,
} from './runtime-descriptor';

export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
    | CanonicalJsonPrimitive
    | readonly CanonicalJsonValue[]
    | { readonly [key: string]: CanonicalJsonValue };

function canonicalize(value: unknown, ancestors: Set<object>): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not allow non-finite numbers');
        return JSON.stringify(value);
    }
    if (typeof value !== 'object') {
        throw new TypeError(`Canonical JSON does not allow ${typeof value} values`);
    }
    if (ancestors.has(value)) throw new TypeError('Canonical JSON does not allow cyclic values');

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.map((entry) => canonicalize(entry, ancestors)).join(',')}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('Canonical JSON only allows plain objects');
        }
        const record = value as Record<string, unknown>;
        const entries = Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`);
        return `{${entries.join(',')}}`;
    } finally {
        ancestors.delete(value);
    }
}

/** Recursively sorts object keys, preserves array order, and rejects lossy JSON values. */
export function canonicalJson(value: CanonicalJsonValue | unknown): string {
    return canonicalize(value, new Set());
}

function bundledArtifactPayload(artifact: BundledV1ArtifactIdentity): CanonicalJsonValue {
    return {
        kind: artifact.kind,
        hostBuildId: artifact.hostBuildId,
        moduleKey: artifact.moduleKey,
        rebuildRequired: artifact.rebuildRequired,
    };
}

function serverRoutePayload(route: ResolvedServerRoute): CanonicalJsonValue {
    return {
        method: route.method,
        path: route.path,
        handler: route.handler,
    };
}

function packageArtifactPayload(artifact: PackageV2ArtifactIdentity): CanonicalJsonValue {
    return {
        kind: artifact.kind,
        packageDigest: artifact.packageDigest,
        ...(artifact.clientEntry === undefined ? {} : { clientEntry: artifact.clientEntry }),
        serverRoutes: artifact.serverRoutes.map(serverRoutePayload),
    };
}

function artifactPayload(artifact: PluginArtifactIdentity): CanonicalJsonValue {
    return artifact.kind === 'bundled-v1'
        ? bundledArtifactPayload(artifact)
        : packageArtifactPayload(artifact);
}

/**
 * Selects every executable/policy identity field and drops unrelated or injected fields.
 * This exact projection is shared by server construction and client verification.
 */
export function descriptorIdentityPayload(identity: PluginDescriptorIdentity): CanonicalJsonValue {
    return {
        id: identity.id,
        version: identity.version,
        manifestVersion: identity.manifestVersion,
        pluginApiVersion: identity.pluginApiVersion,
        source: identity.source,
        trust: identity.trust,
        workspaceId: identity.workspaceId,
        policyRevision: identity.policyRevision,
        grantsRevision: identity.grantsRevision,
        resolvedDependencyKeys: [...identity.resolvedDependencyKeys],
        artifact: artifactPayload(identity.artifact),
    };
}

export async function createDescriptorKey(identity: PluginDescriptorIdentity): Promise<Sha256> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
    const source = canonicalJson(descriptorIdentityPayload(identity));
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(source));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256-${hex}`;
}
