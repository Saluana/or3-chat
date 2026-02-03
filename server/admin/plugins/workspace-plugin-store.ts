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

const SettingsSchema = z.record(z.string(), z.unknown()).default({});

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
    await store.set(
        workspaceId,
        `plugins.settings.${pluginId}`,
        JSON.stringify(parsed.data)
    );
}
