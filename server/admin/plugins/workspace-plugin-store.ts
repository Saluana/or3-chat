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
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    createPluginPolicyRevision,
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

const PersistedPluginGrantReviewSchema = z
    .object({
        schemaVersion: z.literal(1),
        requestedGrants: z.array(PluginGrantIdSchema),
        approvedGrants: z.array(PluginGrantIdSchema),
        revision: z.string().regex(/^sha256-[a-f0-9]{64}$/),
        reviewedAt: z.number().int().min(0),
        reviewedBy: z.string().min(1).optional(),
    })
    .strict();

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
    };
}

/** Reads the separately persisted reviewed-grant decision for one V2 plugin. */
export async function getPluginGrantReview(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    requestedGrants: readonly string[]
): Promise<PluginGrantReviewSnapshot> {
    const requested = normalizeGrantIds(requestedGrants);
    if (requested.length === 0) {
        return {
            requestedGrants: Object.freeze([]),
            approvedGrants: Object.freeze([]),
            revision: createReviewedPluginGrantsRevision({
                requestedGrants: [],
                approvedGrants: [],
            }),
            status: 'current',
        };
    }
    const raw = await store.get(workspaceId, `plugins.grants.${pluginId}`);
    if (!raw) return emptyGrantReview(requested, 'unreviewed');
    const parsed = PersistedPluginGrantReviewSchema.safeParse(safeJsonParse(raw));
    if (!parsed.success) return emptyGrantReview(requested, 'unreviewed');
    const storedRequested = normalizeGrantIds(parsed.data.requestedGrants);
    const storedApproved = normalizeGrantIds(parsed.data.approvedGrants);
    const expectedRevision = createReviewedPluginGrantsRevision({
        requestedGrants: storedRequested,
        approvedGrants: storedApproved,
    });
    const approvedIsSubset = storedApproved.every((grant) => storedRequested.includes(grant));
    if (!approvedIsSubset || parsed.data.revision !== expectedRevision) {
        return emptyGrantReview(requested, 'unreviewed');
    }
    if (!sameStrings(storedRequested, requested)) {
        return emptyGrantReview(requested, 'stale');
    }
    return {
        requestedGrants: Object.freeze(storedRequested),
        approvedGrants: Object.freeze(storedApproved),
        revision: expectedRevision,
        status: 'current',
    };
}

/** Replaces only the reviewed-grant record; access policy and plugin settings are untouched. */
export async function setPluginGrantReview(
    store: WorkspaceSettingsStore,
    workspaceId: string,
    pluginId: string,
    input: {
        requestedGrants: readonly string[];
        approvedGrants: readonly string[];
        reviewedBy?: string;
        reviewedAt?: number;
    }
): Promise<PluginGrantReviewSnapshot> {
    const requestedGrants = normalizeGrantIds(input.requestedGrants);
    const approvedGrants = normalizeGrantIds(input.approvedGrants);
    if (
        !requestedGrants.every((grant) => PluginGrantIdSchema.safeParse(grant).success) ||
        !approvedGrants.every((grant) => PluginGrantIdSchema.safeParse(grant).success) ||
        !approvedGrants.every((grant) => requestedGrants.includes(grant))
    ) {
        throw new Error('Invalid reviewed grants');
    }
    const revision = createReviewedPluginGrantsRevision({
        requestedGrants,
        approvedGrants,
    });
    const persisted = PersistedPluginGrantReviewSchema.parse({
        schemaVersion: 1,
        requestedGrants,
        approvedGrants,
        revision,
        reviewedAt: input.reviewedAt ?? Date.now(),
        reviewedBy: input.reviewedBy,
    });
    await store.set(
        workspaceId,
        `plugins.grants.${pluginId}`,
        JSON.stringify(persisted)
    );
    return {
        requestedGrants: Object.freeze(requestedGrants),
        approvedGrants: Object.freeze(approvedGrants),
        revision,
        status: 'current',
    };
}
