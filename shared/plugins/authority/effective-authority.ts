/**
 * @module shared/plugins/authority/effective-authority
 *
 * Purpose:
 * Bind consent to what a release can actually do, not just to its grant strings.
 * Effective authority hashes grants together with network destinations and
 * methods, connection scopes, data scopes, trust profile, setup hooks and
 * relevant dependency metadata, and ties the result to one exact release.
 *
 * Behavior:
 * - `computeAuthorityHash` is canonical and order-independent.
 * - `compareAuthority` reports expansion and narrowing so an update that adds a
 *   hostname, scope, write or action still needs fresh consent even when the
 *   grant strings are unchanged; a narrowing still passes technical review.
 * - `evaluateConsent` refuses missing, release-changed, authority-expanded or
 *   generation-stale evidence.
 *
 * Constraints:
 * - Pure data and hashing only: no network, no storage, no UI.
 *
 * Non-Goals:
 * - Storing consent (host services own persistence).
 * - Runtime grant enforcement (see `grant-review` / `host-rpc-broker`).
 */

import { canonicalJson } from '../descriptor-key';
import { sha256Identity } from '../digest';
import type { Sha256 } from '../runtime-descriptor';

export interface AuthorityDestination {
    /** Exact hostname; wildcards are not part of the portable profile. */
    readonly host: string;
    readonly methods: readonly string[];
    /** Path prefixes the release may call, most specific first or any order. */
    readonly pathPrefixes: readonly string[];
    readonly connection?: string;
}

export interface EffectiveAuthority {
    readonly trust: string;
    /** Approved grants (sorted canonically by the hash). */
    readonly grants: readonly string[];
    readonly features: readonly string[];
    readonly engines: readonly string[];
    /** Outbound destinations with their methods and path prefixes. */
    readonly destinations: readonly AuthorityDestination[];
    /** Named connection scopes the release may request (for example `read:repo`). */
    readonly connectionScopes: readonly string[];
    /** Data scopes the release may request (for example `documents.read`). */
    readonly dataScopes: readonly string[];
    /** Workspace writes the release may perform (for example `notes.append`). */
    readonly writes: readonly string[];
    /** Setup hooks the release declares (test action + first action ids). */
    readonly setupHooks: readonly string[];
    /** Dependency metadata that changes runtime authority. */
    readonly dependencies: readonly string[];
}

export type AuthorityChangeKind =
    | 'grant-added'
    | 'host-added'
    | 'method-added'
    | 'path-added'
    | 'connection-changed'
    | 'connection-scope-added'
    | 'data-scope-added'
    | 'write-added'
    | 'setup-hook-added'
    | 'feature-added'
    | 'engine-added'
    | 'dependency-added'
    | 'trust-changed';

export interface AuthorityChange {
    readonly kind: AuthorityChangeKind;
    readonly detail: string;
}

export interface AuthorityComparison {
    readonly expanded: boolean;
    readonly narrowed: boolean;
    readonly identical: boolean;
    readonly expansions: readonly AuthorityChange[];
    readonly narrowings: readonly AuthorityChange[];
    /** New/changed hostname, scope, write or action always needs fresh consent. */
    readonly requiresFreshConsent: boolean;
    /** Narrowing still passes technical review, without redundant broad consent. */
    readonly requiresTechnicalReview: boolean;
}

function authorityPayload(authority: EffectiveAuthority) {
    const canonicalStringSet = (values: readonly string[]) =>
        [...new Set(values)].sort();

    // Normalize duplicate declarations for the same host/connection before
    // sorting. Sorting by host alone makes two same-host connections depend on
    // publication order, so an equivalent descriptor could hash differently
    // across the registry and host.
    const destinations = [...groupDestinations(authority.destinations).values()]
        .map((destination) => ({
            host: destination.host,
            methods: canonicalStringSet([...destination.methods]),
            pathPrefixes: canonicalStringSet([...destination.paths]),
            connection: destination.connection || null,
        }))
        .sort((left, right) => {
            const host = left.host < right.host ? -1 : left.host > right.host ? 1 : 0;
            if (host !== 0) return host;
            const leftConnection = left.connection ?? '';
            const rightConnection = right.connection ?? '';
            if (leftConnection < rightConnection) return -1;
            if (leftConnection > rightConnection) return 1;
            const leftMethods = left.methods.join('\u0000');
            const rightMethods = right.methods.join('\u0000');
            if (leftMethods < rightMethods) return -1;
            if (leftMethods > rightMethods) return 1;
            const leftPaths = left.pathPrefixes.join('\u0000');
            const rightPaths = right.pathPrefixes.join('\u0000');
            return leftPaths < rightPaths ? -1 : leftPaths > rightPaths ? 1 : 0;
        });
    return {
        trust: authority.trust,
        grants: canonicalStringSet(authority.grants),
        features: canonicalStringSet(authority.features),
        engines: canonicalStringSet(authority.engines),
        destinations,
        connectionScopes: canonicalStringSet(authority.connectionScopes),
        dataScopes: canonicalStringSet(authority.dataScopes),
        writes: canonicalStringSet(authority.writes),
        setupHooks: canonicalStringSet(authority.setupHooks),
        dependencies: canonicalStringSet(authority.dependencies),
    };
}

/** Canonical, order-independent authority hash. */
export async function computeAuthorityHash(
    authority: EffectiveAuthority
): Promise<Sha256> {
    return await sha256Identity(canonicalJson(authorityPayload(authority)));
}

function diffSets(
    kind: AuthorityChangeKind,
    previous: readonly string[],
    next: readonly string[]
): { added: AuthorityChange[]; removed: AuthorityChange[] } {
    const previousSet = new Set(previous);
    const nextSet = new Set(next);
    return {
        added: next
            .filter((value) => !previousSet.has(value))
            .map((value) => ({ kind, detail: value })),
        removed: previous
            .filter((value) => !nextSet.has(value))
            .map((value) => ({ kind, detail: value })),
    };
}

/**
 * Group destinations by host + connection identity.
 *
 * Keying on the hostname alone collapsed several entries for one host into the
 * last one written, and made a connection swap invisible even though the
 * connection is part of the authority hash. Keying on the connection as well
 * keeps every declared destination, and multiple entries for the same host and
 * connection are merged (union of methods and paths) rather than overwritten.
 */
interface GroupedDestination {
    readonly host: string;
    readonly connection: string;
    readonly methods: Set<string>;
    readonly paths: Set<string>;
}

function destinationKey(host: string, connection: string | null): string {
    return `${host}\u0000${connection ?? ''}`;
}

function groupDestinations(
    destinations: readonly AuthorityDestination[]
): Map<string, GroupedDestination> {
    const grouped = new Map<string, GroupedDestination>();
    for (const destination of destinations) {
        const connection = destination.connection ?? null;
        const key = destinationKey(destination.host, connection);
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

function destinationChanges(
    previous: readonly AuthorityDestination[],
    next: readonly AuthorityDestination[]
): { added: AuthorityChange[]; removed: AuthorityChange[] } {
    const added: AuthorityChange[] = [];
    const removed: AuthorityChange[] = [];
    const previousByKey = groupDestinations(previous);
    const nextByKey = groupDestinations(next);

    // Which connections each host declared, so a swap is reported as such.
    const connectionsByHost = (grouped: Map<string, GroupedDestination>) => {
        const map = new Map<string, Set<string>>();
        for (const entry of grouped.values()) {
            const set = map.get(entry.host) ?? new Set<string>();
            set.add(entry.connection);
            map.set(entry.host, set);
        }
        return map;
    };
    const previousConnectionsByHost = connectionsByHost(previousByKey);
    const nextConnectionsByHost = connectionsByHost(nextByKey);

    const connectionList = (values: Set<string>) =>
        [...values]
            .map((value) => value || '(none)')
            .sort()
            .join('|');

    const diffGroup = (
        before: GroupedDestination | undefined,
        after: GroupedDestination
    ) => {
        if (!before) {
            const previousConnections = previousConnectionsByHost.get(after.host);
            if (previousConnections && previousConnections.size > 0) {
                // Same hostname, different connection identity: the authority hash
                // changed even though no grant string or hostname moved, so this
                // must require fresh consent.
                added.push({
                    kind: 'connection-changed',
                    detail: `${after.host}: ${connectionList(previousConnections)} -> ${connectionList(
                        nextConnectionsByHost.get(after.host) ?? new Set()
                    )}`,
                });
                return;
            }
            added.push({ kind: 'host-added', detail: after.host });
            return;
        }
        for (const method of after.methods) {
            if (!before.methods.has(method)) {
                added.push({ kind: 'method-added', detail: `${after.host} ${method}` });
            }
        }
        for (const method of before.methods) {
            if (!after.methods.has(method)) {
                removed.push({ kind: 'method-added', detail: `${after.host} ${method}` });
            }
        }
        for (const path of after.paths) {
            if (!before.paths.has(path)) {
                added.push({ kind: 'path-added', detail: `${after.host} ${path}` });
            }
        }
        for (const path of before.paths) {
            if (!after.paths.has(path)) {
                removed.push({ kind: 'path-added', detail: `${after.host} ${path}` });
            }
        }
    };

    for (const [key, after] of nextByKey) {
        diffGroup(previousByKey.get(key), after);
    }
    for (const [key, before] of previousByKey) {
        if (nextByKey.has(key)) continue;
        const remaining = nextConnectionsByHost.get(before.host);
        if (remaining && remaining.size > 0) {
            removed.push({
                kind: 'connection-changed',
                detail: `${before.host}: ${connectionList(
                    previousConnectionsByHost.get(before.host) ?? new Set()
                )} -> ${connectionList(remaining)}`,
            });
            continue;
        }
        removed.push({ kind: 'host-added', detail: before.host });
    }

    return { added, removed };
}

/**
 * Compare two authority snapshots for one plugin.
 * Any new host, method, path, scope, hook, feature, dependency or trust change
 * counts as an expansion and requires fresh consent even if no grant string moved.
 * Engine ranges are signed compatibility metadata, checked by the host rather
 * than by workspace access consent.
 */
export function compareAuthority(
    previous: EffectiveAuthority,
    next: EffectiveAuthority
): AuthorityComparison {
    const expansions: AuthorityChange[] = [];
    const narrowings: AuthorityChange[] = [];

    const grants = diffSets('grant-added', previous.grants, next.grants);
    expansions.push(...grants.added);
    narrowings.push(...grants.removed);

    const destinations = destinationChanges(previous.destinations, next.destinations);
    expansions.push(...destinations.added);
    narrowings.push(...destinations.removed);

    for (const [kind, before, after] of [
        ['connection-scope-added', previous.connectionScopes, next.connectionScopes],
        ['data-scope-added', previous.dataScopes, next.dataScopes],
        ['write-added', previous.writes, next.writes],
        ['setup-hook-added', previous.setupHooks, next.setupHooks],
        ['feature-added', previous.features, next.features],
        ['dependency-added', previous.dependencies, next.dependencies],
    ] as const) {
        const diff = diffSets(kind, before, after);
        expansions.push(...diff.added);
        narrowings.push(...diff.removed);
    }

    if (previous.trust !== next.trust) {
        expansions.push({ kind: 'trust-changed', detail: `${previous.trust} -> ${next.trust}` });
    }

    const identical = expansions.length === 0 && narrowings.length === 0;
    return Object.freeze({
        expanded: expansions.length > 0,
        narrowed: narrowings.length > 0,
        identical,
        expansions: Object.freeze(expansions),
        narrowings: Object.freeze(narrowings),
        requiresFreshConsent: expansions.length > 0,
        requiresTechnicalReview: narrowings.length > 0 && expansions.length === 0,
    });
}

export interface AuthorityConsent {
    readonly subjectId: string;
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly releaseId: string;
    readonly generation: number;
    readonly authorityHash: Sha256;
    readonly approvedAt: number;
    readonly approvedBy: string;
}

export interface AuthorityCandidate {
    readonly pluginId: string;
    readonly releaseId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly authorityHash: Sha256;
}

export type ConsentDecision =
    | { readonly status: 'allowed'; readonly consent: AuthorityConsent }
    | {
          readonly status: 'denied';
          readonly code:
              | 'consent-missing'
              | 'consent-release-changed'
              | 'consent-authority-expanded'
              | 'consent-stale-generation'
              | 'consent-workspace-mismatch';
          readonly message: string;
      };

/**
 * Decide whether an approval still covers the candidate release.
 * The release digest and generation are both bound, so a re-issued or
 * other-workspace consent cannot be reused.
 */
export function evaluateConsent(input: {
    readonly consent: AuthorityConsent | null;
    readonly candidate: AuthorityCandidate;
    /** Authority of the release the consent was granted for, when known. */
    readonly consentedAuthority?: EffectiveAuthority;
    readonly candidateAuthority?: EffectiveAuthority;
}): ConsentDecision {
    const { consent, candidate } = input;
    if (!consent) {
        return denied('consent-missing', 'No local approval exists for this plugin');
    }
    if (consent.workspaceId !== candidate.workspaceId) {
        return denied(
            'consent-workspace-mismatch',
            'Approval belongs to a different workspace'
        );
    }
    if (consent.pluginId !== candidate.pluginId) {
        return denied('consent-workspace-mismatch', 'Approval belongs to a different plugin');
    }
    if (consent.releaseId !== candidate.releaseId) {
        return denied(
            'consent-release-changed',
            'Approval was granted for a different release'
        );
    }
    if (consent.generation !== candidate.generation) {
        return denied(
            'consent-stale-generation',
            'Approval is stale after a package change'
        );
    }
    if (consent.authorityHash !== candidate.authorityHash) {
        return denied(
            'consent-authority-expanded',
            'Effective authority differs from what was approved'
        );
    }
    if (input.consentedAuthority && input.candidateAuthority) {
        const comparison = compareAuthority(input.consentedAuthority, input.candidateAuthority);
        if (comparison.expanded) {
            return denied(
                'consent-authority-expanded',
                `Approval no longer covers: ${comparison.expansions
                    .map((change) => `${change.kind}(${change.detail})`)
                    .join(', ')}`
            );
        }
    }
    return { status: 'allowed', consent };
}

function denied(
    code: Extract<ConsentDecision, { status: 'denied' }>['code'],
    message: string
): ConsentDecision {
    return { status: 'denied', code, message };
}

/** Host-created, generation-bound handle for a selected document or message. */
export interface SelectedContextHandle {
    readonly handleId: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly kind: 'document' | 'message';
    readonly contextId: string;
    readonly issuedAt: number;
}

export type HandleResolution =
    | { readonly status: 'resolved'; readonly handle: SelectedContextHandle }
    | {
          readonly status: 'denied';
          readonly code: 'handle-unknown' | 'handle-stale' | 'handle-foreign';
          readonly message: string;
      };

export interface SelectionHandleAuthorityOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly now?: () => number;
}

/**
 * Host-side registry for selection/connection handles.
 * Handles are minted by the host, invalidated by generation rotation, and
 * resolved only for the plugin/workspace that owns them.
 */
export class SelectionHandleAuthority {
    readonly #pluginId: string;
    readonly #workspaceId: string;
    readonly #now: () => number;
    readonly #handles = new Map<string, SelectedContextHandle>();
    #generation: number;
    #counter = 0;

    constructor(options: SelectionHandleAuthorityOptions) {
        this.#pluginId = options.pluginId;
        this.#workspaceId = options.workspaceId;
        this.#generation = options.generation;
        this.#now = options.now ?? (() => Date.now());
    }

    get generation(): number {
        return this.#generation;
    }

    mint(input: {
        readonly kind: 'document' | 'message';
        readonly contextId: string;
    }): SelectedContextHandle {
        this.#counter += 1;
        const handle: SelectedContextHandle = Object.freeze({
            handleId: `sel_${this.#counter}_${this.#generation}`,
            pluginId: this.#pluginId,
            workspaceId: this.#workspaceId,
            generation: this.#generation,
            kind: input.kind,
            contextId: input.contextId,
            issuedAt: this.#now(),
        });
        this.#handles.set(handle.handleId, handle);
        return handle;
    }

    /** Rotate on update/workspace switch: previous handles stop resolving. */
    rotateGeneration(generation: number): void {
        this.#generation = generation;
        this.#handles.clear();
    }

    resolve(
        handleId: string,
        requester: { readonly pluginId: string; readonly workspaceId: string }
    ): HandleResolution {
        const handle = this.#handles.get(handleId);
        if (!handle) {
            return {
                status: 'denied',
                code: 'handle-stale',
                message: 'Selection handle is no longer valid',
            };
        }
        if (
            handle.pluginId !== requester.pluginId ||
            handle.workspaceId !== requester.workspaceId
        ) {
            return {
                status: 'denied',
                code: 'handle-foreign',
                message: 'Selection handle belongs to another plugin or workspace',
            };
        }
        if (handle.generation !== this.#generation) {
            return {
                status: 'denied',
                code: 'handle-stale',
                message: 'Selection handle is stale after a generation change',
            };
        }
        return { status: 'resolved', handle };
    }
}
