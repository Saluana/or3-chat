/**
 * @module server/admin/plugins/workspace-plugin-store.ts
 *
 * Purpose:
 * Provides a high-level, schema-aware API for managing workspace-specific
 * plugin configurations. It acts as a specialized wrapper around the generic
 * `WorkspaceSettingsStore`.
 *
 * Responsibilities:
 * - Managing the list of enabled plugins for a workspace.
 * - Persisting and retrieving plugin-specific settings objects.
 * - Ensuring data integrity via Zod schema validation and safe JSON parsing.
 *
 * Architecture:
 * This module bridges the raw key-value storage of the settings store with
 * structured application-level plugin state. It uses specific key namespaces
 * (e.g., `plugins.enabled`, `plugins.settings.*`) to isolate plugin data.
 *
 * Constraints:
 * - Depends on an external `WorkspaceSettingsStore` implementation.
 * - All persisted values are JSON-stringified.
 */
import { z } from 'zod';
import type { WorkspaceSettingsStore } from '../stores/types';
import {
    StrictPluginGatePolicySchema,
    normalizePluginGatePolicy,
    type PluginGatePolicy,
    type PluginGatePolicyNormalized,
} from '~~/shared/plugins/access-policy';
import {
    compareAuthority,
    type EffectiveAuthority,
} from '~~/shared/plugins/authority/effective-authority';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';
import {
    createPluginPolicyRevision,
    createReviewedPluginAuthorityRevision,
    createReviewedPluginGrantsRevision,
} from './plugin-revisions';

const PluginsEnabledSchema = z.array(z.string()).default([]);

/**
 * Safely parses a JSON string into an unknown object.
 *
 * Behavior:
 * Returns `null` if the input is not valid JSON, preventing downstream
 * parse errors from crashing the request.
 *
 * Internal utility.
 */
function safeJsonParse(raw: string): unknown | null {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

/**
 * Retrieves the list of enabled plugin IDs for a specific workspace.
 *
 * Behavior:
 * 1. Fetches the raw string value from `plugins.enabled`.
 * 2. Parses the JSON array.
 * 3. Validates the array structure via `PluginsEnabledSchema`.
 * 4. Returns an empty array if any step fails or the key is missing.
 */
export async function getEnabledPlugins(
    store: WorkspaceSettingsStore,
    workspaceId: string
): Promise<string[]> {
    const raw = await store.get(workspaceId, 'plugins.enabled');
    if (!raw) return [];
    const json = safeJsonParse(raw);
    if (json === null) return [];
    const parsed = PluginsEnabledSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data;
}

/**
 * Updates the enablement status of a plugin for a workspace.
 *
 * Behavior:
 * Adds or removes the plugin ID from the `plugins.enabled` set and persists the result.
 *
 * @returns The updated list of all enabled plugin IDs.
 * @example
 * ```ts
 * await setPluginEnabled(store, "ws_123", "github-sync", true);
 * ```
 */
export async function setPluginEnabled(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    enabled: boolean
): Promise<string[]> {
    const current = await getEnabledPlugins(store, workspaceId);
    const next = new Set(current);
    if (enabled) {
        next.add(pluginId);
    } else {
        next.delete(pluginId);
    }
    const list = Array.from(next);
    await store.set(workspaceId, 'plugins.enabled', JSON.stringify(list));
    return list;
}

/**
 * Seeds default enabled plugin IDs for a workspace only when the key is unset.
 * If `plugins.enabled` already exists, this is a no-op and current values are returned.
 */
export async function bootstrapDefaultEnabledPlugins(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    defaultPluginIds: string[]
): Promise<string[]> {
    const raw = await store.get(workspaceId, 'plugins.enabled');
    if (raw != null) {
        return getEnabledPlugins(store, workspaceId);
    }
    const normalized = Array.from(
        new Set(defaultPluginIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
    );
    await store.set(workspaceId, 'plugins.enabled', JSON.stringify(normalized));
    return normalized;
}

const SettingsSchema = z.record(z.string(), z.unknown()).default({});

const SettingsAccessSchema = z.object({
    access: StrictPluginGatePolicySchema.optional(),
});

const PluginGrantIdSchema = z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);

const Sha256Schema = z.string().regex(/^sha256-[a-f0-9]{64}$/);

const AuthorityDestinationSchema = z
    .object({
        host: z.string().min(1).max(253),
        methods: z.array(z.string().min(1).max(16)).max(16),
        pathPrefixes: z.array(z.string().min(1).max(256)).max(64),
        connection: z.string().min(1).max(128).optional(),
    })
    .strict();

/**
 * Persisted form of the authority a release declared. Consent binds to this
 * descriptor so an update that adds a destination, method, path, scope, write,
 * hook, feature or dependency needs fresh approval even when every
 * grant string is unchanged.
 */
const EffectiveAuthoritySchema = z
    .object({
        trust: z.string().min(1).max(64),
        grants: z.array(z.string().min(1).max(64)).max(64),
        features: z.array(z.string().min(1).max(64)).max(64),
        engines: z.array(z.string().min(1).max(64)).max(16),
        destinations: z.array(AuthorityDestinationSchema).max(64),
        connectionScopes: z.array(z.string().min(1).max(128)).max(256),
        dataScopes: z.array(z.string().min(1).max(64)).max(64),
        writes: z.array(z.string().min(1).max(64)).max(64),
        setupHooks: z.array(z.string().min(1).max(64)).max(32),
        dependencies: z.array(z.string().min(1).max(128)).max(64),
    })
    .strict();

const PersistedPluginGrantReviewSchema = z
    .object({
        schemaVersion: z.literal(2),
        requestedGrants: z.array(PluginGrantIdSchema),
        approvedGrants: z.array(PluginGrantIdSchema),
        releaseId: z.string().min(1).max(128).nullable(),
        packageDigest: Sha256Schema.nullable(),
        authoritySha256: Sha256Schema.nullable(),
        /**
         * Declared authority when the package descriptors were readable at
         * approval time. A registry-only approval records the signed hash
         * without the descriptor and carries over only to the exact same hash.
         */
        authority: EffectiveAuthoritySchema.nullable(),
        revision: z.string().regex(/^sha256-[a-f0-9]{64}$/),
        reviewedAt: z.number().int().min(0),
        reviewedBy: z.string().min(1).optional(),
    })
    .strict();

/** What a candidate release declares, as far as the host can verify it. */
export interface PluginGrantCandidate {
    readonly requestedGrants: readonly string[];
    readonly releaseId: string | null;
    readonly packageDigest: Sha256 | null;
    /** Signed policy revision when the registry metadata was resolvable. */
    readonly authoritySha256: Sha256 | null;
    /** Complete declared authority; null only when descriptors are unreadable. */
    readonly authority: EffectiveAuthority | null;
}

function normalizeGrantIds(grants: readonly string[]): string[] {
    return Array.from(new Set(grants)).sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Retrieves the settings for a specific plugin in a workspace.
 *
 * Behavior:
 * Fetches data from `plugins.settings.{pluginId}`. Returns an empty object
 * if the settings are missing or invalid.
 */
export async function getPluginSettings(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string
): Promise<Record<string, unknown>> {
    const raw = await store.get(workspaceId, `plugins.settings.${pluginId}`);
    if (!raw) return {};
    const json = safeJsonParse(raw);
    if (json === null) return {};
    const parsed = SettingsSchema.safeParse(json);
    if (!parsed.success) return {};
    return parsed.data;
}

/**
 * Persists settings for a specific plugin in a workspace.
 *
 * Behavior:
 * Validates the input object and stores it as a JSON string under the
 * `plugins.settings.{pluginId}` key.
 *
 * @throws Error if the provided settings object does not match the expected record structure.
 */
export async function setPluginSettings(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    settings: Record<string, unknown>
): Promise<void> {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
        throw new Error('Invalid settings');
    }
    const current = await getPluginSettings(store, workspaceId, pluginId);
    const merged = {
        ...current,
        ...parsed.data,
    };
    await store.set(
        workspaceId,
        `plugins.settings.${pluginId}`,
        JSON.stringify(merged)
    );
}

/** Replaces settings exactly. Lifecycle rollback uses this instead of the
 * normal merge-oriented editor update so deleted keys are restored too. */
export async function replacePluginSettings(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    settings: Record<string, unknown>
): Promise<void> {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
        throw new Error('Invalid settings');
    }
    await store.set(
        workspaceId,
        `plugins.settings.${pluginId}`,
        JSON.stringify(parsed.data)
    );
}

export function readPluginAccessPolicy(
    settings: Record<string, unknown>
): PluginGatePolicy | null {
    const parsed = SettingsAccessSchema.safeParse(settings);
    if (!parsed.success) return null;
    return parsed.data.access ?? null;
}

export async function getPluginAccessPolicy(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    defaults?: PluginGatePolicy | null
): Promise<PluginGatePolicyNormalized> {
    return (await getPluginAccessPolicySnapshot(store, workspaceId, pluginId, defaults)).policy;
}

export async function getPluginAccessPolicySnapshot(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    defaults?: PluginGatePolicy | null
): Promise<{ policy: PluginGatePolicyNormalized; revision: string }> {
    const settings = await getPluginSettings(store, workspaceId, pluginId);
    const policy = readPluginAccessPolicy(settings);
    const normalized = normalizePluginGatePolicy(policy ?? defaults ?? {});
    return {
        policy: normalized,
        revision: createPluginPolicyRevision(normalized),
    };
}

export async function setPluginAccessPolicy(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    access: PluginGatePolicy
): Promise<void> {
    const parsed = StrictPluginGatePolicySchema.safeParse(access);
    if (!parsed.success) {
        throw new Error('Invalid access policy');
    }
    await setPluginSettings(store, workspaceId, pluginId, {
        access: parsed.data,
    });
}

function emptyGrantReview(
    requestedGrants: readonly string[],
    status: 'unreviewed' | 'stale'
): PluginGrantReviewSnapshot {
    const requested = normalizeGrantIds(requestedGrants);
    const approved: string[] = [];
    return {
        requestedGrants: Object.freeze(requested),
        approvedGrants: Object.freeze(approved),
        revision: createReviewedPluginGrantsRevision({
            requestedGrants: requested,
            approvedGrants: approved,
        }),
        status,
        authoritySha256: null,
        packageDigest: null,
    };
}

/**
 * Reads the persisted authority consent for one V2 plugin candidate.
 *
 * A review is current only when the complete declared authority of the
 * candidate is covered by what the workspace approved: an unchanged grant list
 * with a wider destination, scope, write or hook set is stale. Narrowing still
 * passes, so an update that removes authority does not demand fresh consent.
 */
function reviewStorageKey(pluginId: string): string {
    return `plugins.grants.${pluginId}`;
}

function priorReviewStorageKey(pluginId: string, digest: Sha256): string {
    return `${reviewStorageKey(pluginId)}.by-digest.${digest}`;
}

function evaluateStoredGrantReview(
    raw: string | null,
    candidate: PluginGrantCandidate
): PluginGrantReviewSnapshot {
    const requested = normalizeGrantIds(candidate.requestedGrants);
    if (!raw) return emptyGrantReview(requested, 'unreviewed');
    const json = safeJsonParse(raw);
    const parsed = PersistedPluginGrantReviewSchema.safeParse(json);
    if (!parsed.success) {
        const legacy =
            json !== null &&
            typeof json === 'object' &&
            (json as { schemaVersion?: unknown }).schemaVersion === 1;
        return emptyGrantReview(requested, legacy ? 'stale' : 'unreviewed');
    }
    const stored = parsed.data;
    const storedRequested = normalizeGrantIds(stored.requestedGrants);
    const storedApproved = normalizeGrantIds(stored.approvedGrants);
    const expectedRevision = createReviewedPluginAuthorityRevision({
        requestedGrants: storedRequested,
        approvedGrants: storedApproved,
        releaseId: stored.releaseId,
        packageDigest: stored.packageDigest,
        authoritySha256: stored.authoritySha256,
        authority: stored.authority,
    });
    const approvedIsSubset = storedApproved.every((grant) => storedRequested.includes(grant));
    if (!approvedIsSubset || stored.revision !== expectedRevision) {
        return emptyGrantReview(requested, 'unreviewed');
    }
    if (!candidate.authority || !stored.authority) {
        const sameAuthority =
            candidate.authoritySha256 !== null &&
            candidate.authoritySha256 === stored.authoritySha256;
        const sameBytes =
            stored.packageDigest === null ||
            (candidate.packageDigest !== null &&
                candidate.packageDigest === stored.packageDigest);
        if (!sameAuthority || !sameBytes) return emptyGrantReview(requested, 'stale');
    } else {
        const comparison = compareAuthority(stored.authority, candidate.authority);
        if (comparison.expanded) return emptyGrantReview(requested, 'stale');
    }
    if (!requested.every((grant) => storedRequested.includes(grant))) {
        return emptyGrantReview(requested, 'stale');
    }
    return {
        requestedGrants: Object.freeze(requested),
        approvedGrants: Object.freeze(
            storedApproved.filter((grant) => requested.includes(grant))
        ),
        revision: stored.revision,
        status: 'current',
        authoritySha256: stored.authoritySha256,
        packageDigest: stored.packageDigest,
    };
}

export async function getPluginGrantReview(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    candidate: PluginGrantCandidate
): Promise<PluginGrantReviewSnapshot> {
    const requested = normalizeGrantIds(candidate.requestedGrants);
    // A descriptor-bearing release still needs explicit review even when it
    // requests no grant strings: destinations, scopes, writes, hooks, trust
    // and dependencies are part of the authority a consent record covers.
    const requiresAuthorityReview = requested.length > 0 || candidate.authority !== null;
    if (!requiresAuthorityReview) {
        return {
            requestedGrants: Object.freeze([]),
            approvedGrants: Object.freeze([]),
            revision: createReviewedPluginGrantsRevision({
                requestedGrants: [],
                approvedGrants: [],
            }),
            status: 'current',
            authoritySha256: candidate.authoritySha256,
            packageDigest: candidate.packageDigest,
        };
    }
    const key = reviewStorageKey(pluginId);
    const primary = evaluateStoredGrantReview(await store.get(workspaceId, key), candidate);
    if (primary.status === 'current' || !candidate.packageDigest) return primary;

    // A candidate's approval must not revoke the still-selected package when
    // an update pauses or fails. Keep the prior exact-package review available
    // until that package is no longer selected.
    const prior = await store.get(
        workspaceId,
        priorReviewStorageKey(pluginId, candidate.packageDigest)
    );
    if (!prior) return primary;
    const recovered = evaluateStoredGrantReview(prior, candidate);
    return recovered.status === 'current' ? recovered : primary;
}

/** Replaces only the reviewed-authority record; settings and policy are untouched. */
export async function setPluginGrantReview(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    input: {
        readonly candidate: PluginGrantCandidate;
        readonly approvedGrants: readonly string[];
        reviewedBy?: string;
        reviewedAt?: number;
    }
): Promise<PluginGrantReviewSnapshot> {
    const requestedGrants = normalizeGrantIds(input.candidate.requestedGrants);
    const approvedGrants = normalizeGrantIds(input.approvedGrants);
    if (
        !requestedGrants.every((grant) => PluginGrantIdSchema.safeParse(grant).success) ||
        !approvedGrants.every((grant) => PluginGrantIdSchema.safeParse(grant).success) ||
        !approvedGrants.every((grant) => requestedGrants.includes(grant))
    ) {
        throw new Error('Invalid reviewed grants');
    }
    const authority = input.candidate.authority;
    if (!input.candidate.authoritySha256) {
        throw new Error('Reviewed authority must be verifiable');
    }
    const releaseId = input.candidate.releaseId;
    const packageDigest = input.candidate.packageDigest;
    const authoritySha256 = input.candidate.authoritySha256;
    const revision = createReviewedPluginAuthorityRevision({
        requestedGrants,
        approvedGrants,
        releaseId,
        packageDigest,
        authoritySha256,
        authority,
    });
    const persisted = PersistedPluginGrantReviewSchema.parse({
        schemaVersion: 2,
        requestedGrants,
        approvedGrants,
        releaseId,
        packageDigest,
        authoritySha256,
        authority,
        revision,
        reviewedAt: input.reviewedAt ?? Date.now(),
        reviewedBy: input.reviewedBy,
    });
    const key = reviewStorageKey(pluginId);
    const current = await store.get(workspaceId, key);
    const previous = PersistedPluginGrantReviewSchema.safeParse(safeJsonParse(current ?? ''));
    if (
        current &&
        previous.success &&
        previous.data.packageDigest &&
        previous.data.packageDigest !== packageDigest
    ) {
        await store.set(
            workspaceId,
            priorReviewStorageKey(pluginId, previous.data.packageDigest as Sha256),
            current
        );
    }
    await store.set(workspaceId, key, JSON.stringify(persisted));
    return {
        requestedGrants: Object.freeze(requestedGrants),
        approvedGrants: Object.freeze(approvedGrants),
        revision,
        status: 'current',
        authoritySha256,
        packageDigest,
    };
}
