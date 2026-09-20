import { createHash } from 'node:crypto';
import type { Or3PackagePolicyV1, Or3SetupDescriptorV1 } from './profile';
import type { Sha256 } from './candidate';

/**
 * @module packages/plugin-sdk/src/authority
 *
 * Purpose:
 * Derive the candidate receipt's authority digest from the exact descriptors
 * the host and marketplace derive it from, with byte-identical canonical
 * serialization. The receipt hash must equal the host's `computeAuthorityHash`
 * over `toEffectiveAuthority(manifest, policy, setup)` and the marketplace's
 * `computeAuthorityHash(deriveEffectiveAuthority(...))` for the same bytes;
 * anything else makes genuine candidates fail receipt binding.
 *
 * Behavior:
 * - Replicates the host mapping (`toEffectiveAuthority`) and payload
 *   normalization (`authorityPayload`) exactly: destinations grouped by host
 *   and connection with uppercased methods, every set deduplicated and
 *   sorted, keys sorted. The receipt hash must equal the host's
 *   `computeAuthorityHash` and the marketplace's `computeAuthorityHash` for
 *   the same descriptor bytes; the shared cross-repo test vector pins this.
 * - Fails closed: missing descriptors or malformed authority inputs throw
 *   instead of producing a weaker digest.
 *
 * Constraints:
 * - Node-only (node:crypto plus relative type imports), like the rest of the
 *   candidate pipeline. Never re-exported from `src/index.ts`.
 */

export interface CandidateAuthorityManifest {
    readonly trust: string;
    readonly requestedGrants: readonly string[];
    readonly features: { readonly required: readonly string[] };
    readonly engines: { readonly or3: string; readonly pluginApi?: string };
    readonly dependencies?: {
        readonly required: readonly { readonly id: string; readonly range: string; readonly features?: readonly string[] }[];
        readonly optional: readonly { readonly id: string; readonly range: string; readonly features?: readonly string[] }[];
    };
}

interface AuthorityDestination {
    readonly host: string;
    readonly methods: readonly string[];
    readonly pathPrefixes: readonly string[];
    readonly connection: string | null;
}

interface EffectiveAuthorityPayload {
    readonly trust: string;
    readonly grants: readonly string[];
    readonly features: readonly string[];
    readonly engines: readonly string[];
    readonly destinations: readonly AuthorityDestination[];
    readonly connectionScopes: readonly string[];
    readonly dataScopes: readonly string[];
    readonly writes: readonly string[];
    readonly setupHooks: readonly string[];
    readonly dependencies: readonly string[];
}

function uniqueSorted(values: readonly string[]): string[] {
    return Array.from(new Set(values)).sort();
}

function dependencyEntries(dependencies: CandidateAuthorityManifest['dependencies']): string[] {
    if (!dependencies) return [];
    const entries: string[] = [];
    for (const group of ['required', 'optional'] as const) {
        for (const dependency of dependencies[group] ?? []) {
            const features = uniqueSorted(dependency.features ?? []).join('+');
            entries.push(
                `${group}:${dependency.id}@${dependency.range}${features.length > 0 ? `#${features}` : ''}`
            );
        }
    }
    return entries;
}

/**
 * Map validated descriptors to the effective authority, replicating the host's
 * `toEffectiveAuthority` field for field. The payload normalization (below)
 * sorts every set exactly like the host's `authorityPayload`, so do not
 * pre-sort here either: keep the mapping literal and let the payload match.
 */
export function toCandidateAuthority(input: {
    readonly manifest: CandidateAuthorityManifest;
    readonly policy: Or3PackagePolicyV1;
    readonly setup: Or3SetupDescriptorV1;
}): EffectiveAuthorityPayload {
    const { manifest, policy, setup } = input;
    if (!manifest || !policy || !setup) {
        throw new Error('Cannot derive candidate authority without manifest, policy and setup descriptors');
    }
    return {
        trust: manifest.trust,
        grants: uniqueSorted(manifest.requestedGrants),
        features: uniqueSorted([
            ...(manifest.features?.required ?? []),
            ...policy.requiredFeatures,
        ]),
        engines: [
            `or3:${manifest.engines.or3}`,
            ...(manifest.engines.pluginApi === undefined
                ? []
                : [`pluginApi:${manifest.engines.pluginApi}`]),
        ],
        destinations: policy.destinations.flatMap((destination) =>
            destination.hosts.map((host) => ({
                host,
                methods: [...destination.methods],
                pathPrefixes: [...destination.scopes],
                connection: destination.id,
            }))
        ),
        connectionScopes: uniqueSorted(
            policy.connections.flatMap((connection) => [
                ...connection.scopes.map((scope) => `${connection.id}:${scope}`),
                ...connection.operations.map((operation) => `${connection.id}:op:${operation}`),
            ])
        ),
        dataScopes: uniqueSorted(policy.dataScopes),
        writes: uniqueSorted(policy.writes),
        setupHooks: [
            ...(setup.testAction ? [setup.testAction.operationId] : []),
            setup.firstAction.operationId,
        ],
        dependencies: dependencyEntries(manifest.dependencies),
    };
}

interface AuthorityDestinationInput {
    readonly host: string;
    readonly methods: readonly string[];
    readonly pathPrefixes: readonly string[];
    readonly connection: string | null;
}

interface GroupedDestination {
    readonly host: string;
    readonly connection: string;
    readonly methods: Set<string>;
    readonly paths: Set<string>;
}

function groupDestinations(
    destinations: readonly AuthorityDestinationInput[]
): Map<string, GroupedDestination> {
    const grouped = new Map<string, GroupedDestination>();
    for (const destination of destinations) {
        const connection = destination.connection ?? null;
        const key = `${destination.host}\u0000${connection ?? ''}`;
        const existing = grouped.get(key) ?? {
            host: destination.host,
            connection: connection ?? '',
            methods: new Set<string>(),
            paths: new Set<string>(),
        };
        for (const method of destination.methods) existing.methods.add(method.toUpperCase());
        for (const path of destination.pathPrefixes) existing.paths.add(path);
        grouped.set(key, existing);
    }
    return grouped;
}

/** Canonical payload: normalized sets plus host/connection-grouped destinations. */
export function canonicalAuthorityPayload(authority: EffectiveAuthorityPayload): Record<string, unknown> {
    const destinations = [...groupDestinations(authority.destinations).values()]
        .map((destination) => ({
            host: destination.host,
            methods: [...destination.methods].sort(),
            pathPrefixes: [...destination.paths].sort(),
            connection: destination.connection || null,
        }))
        .sort((left, right) => {
            if (left.host !== right.host) return left.host < right.host ? -1 : 1;
            const leftConnection = left.connection ?? '';
            const rightConnection = right.connection ?? '';
            if (leftConnection !== rightConnection) return leftConnection < rightConnection ? -1 : 1;
            const leftMethods = left.methods.join('\u0000');
            const rightMethods = right.methods.join('\u0000');
            if (leftMethods !== rightMethods) return leftMethods < rightMethods ? -1 : 1;
            const leftPaths = left.pathPrefixes.join('\u0000');
            const rightPaths = right.pathPrefixes.join('\u0000');
            return leftPaths === rightPaths ? 0 : leftPaths < rightPaths ? -1 : 1;
        });
    return {
        trust: authority.trust,
        grants: uniqueSorted(authority.grants),
        features: uniqueSorted(authority.features),
        engines: uniqueSorted(authority.engines),
        destinations,
        connectionScopes: uniqueSorted(authority.connectionScopes),
        dataScopes: uniqueSorted(authority.dataScopes),
        writes: uniqueSorted(authority.writes),
        setupHooks: uniqueSorted(authority.setupHooks),
        dependencies: uniqueSorted(authority.dependencies),
    };
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Canonical JSON does not allow non-finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!value || typeof value !== 'object') throw new Error('Canonical JSON does not allow this value');
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
}

/**
 * Host-parity authority digest for candidate receipts. Must equal the host and
 * marketplace digests for the same descriptor bytes; the shared cross-repo
 * test vector pins this.
 */
export function deriveCandidateAuthoritySha256(input: {
    readonly manifest: CandidateAuthorityManifest;
    readonly policy: Or3PackagePolicyV1;
    readonly setup: Or3SetupDescriptorV1;
}): Sha256 {
    const payload = canonicalAuthorityPayload(toCandidateAuthority(input));
    return `sha256-${createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')}`;
}
