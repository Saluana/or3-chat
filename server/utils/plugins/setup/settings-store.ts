/**
 * Saved setup settings for one plugin in one workspace.
 *
 * Values live in the workspace settings store as a single JSON document. They are
 * the user's data, not the plugin's: the host validates them against the installed
 * package schema before they are stored or counted toward readiness.
 */

import type { H3Event } from 'h3';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';

export function setupValuesKey(pluginId: string): string {
    return `plugin:${pluginId}:setup-values`;
}

/** Reads the stored document; a corrupt value reads as unset, never half-applied. */
export async function readSetupValues(
    event: H3Event,
    workspaceId: string,
    pluginId: string
): Promise<Record<string, unknown>> {
    const store = getWorkspaceSettingsStore(event);
    const raw = await store.get(workspaceId, setupValuesKey(pluginId));
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return {};
    }
    return {};
}

export async function writeSetupValues(
    event: H3Event,
    workspaceId: string,
    pluginId: string,
    values: Readonly<Record<string, unknown>>
): Promise<void> {
    const store = getWorkspaceSettingsStore(event);
    await store.set(workspaceId, setupValuesKey(pluginId), JSON.stringify(values));
}
