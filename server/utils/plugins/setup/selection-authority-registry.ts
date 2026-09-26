/**
 * Retained selection-handle authorities, one per live activation.
 *
 * A first-action handoff may only mint a selection handle that some activation
 * will actually be able to resolve. The server learns that an activation is live
 * when that activation's sandbox calls the capability bridge (an authenticated,
 * enabled-plugin call carrying its generation). Without a live activation the
 * handoff is reported as pending instead of returning an unusable handle.
 *
 * The map is bounded by insert order, like the per-activation AI governors: a
 * stale entry cannot be resolved by a later generation because minting reads the
 * retained authority's own generation.
 */

import { SelectionHandleAuthority } from '~~/shared/plugins/authority/effective-authority';

interface RetainedAuthority {
    readonly authority: SelectionHandleAuthority;
    touchedAt: number;
}

const authorities = new Map<string, RetainedAuthority>();
const MAX_RETAINED = 256;

function keyFor(pluginId: string, workspaceId: string, generation: number): string {
    return `${pluginId}:${workspaceId}:${generation}`;
}

/**
 * Records that an activation with this generation is live. Called from the
 * capability bridge, which already authenticated the plugin, workspace and user.
 */
export function retainSelectionAuthority(input: {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly now?: () => number;
}): SelectionHandleAuthority {
    const key = keyFor(input.pluginId, input.workspaceId, input.generation);
    const existing = authorities.get(key);
    if (existing) {
        existing.touchedAt = (input.now ?? Date.now)();
        return existing.authority;
    }
    const authority = new SelectionHandleAuthority({
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        generation: input.generation,
    });
    authorities.set(key, { authority, touchedAt: (input.now ?? Date.now)() });
    if (authorities.size > MAX_RETAINED) {
        const oldest = authorities.keys().next().value;
        if (typeof oldest === 'string') authorities.delete(oldest);
    }
    return authority;
}

/** The authority for a live activation, or null when nothing is running. */
export function getRetainedSelectionAuthority(
    pluginId: string,
    workspaceId: string,
    generation: number
): SelectionHandleAuthority | null {
    return authorities.get(keyFor(pluginId, workspaceId, generation))?.authority ?? null;
}

/** Most recently touched live authority for a plugin, used when no generation is known. */
export function latestRetainedSelectionAuthority(
    pluginId: string,
    workspaceId: string
): SelectionHandleAuthority | null {
    let best: { authority: SelectionHandleAuthority; touchedAt: number } | null = null;
    for (const [key, entry] of authorities) {
        if (!key.startsWith(`${pluginId}:${workspaceId}:`)) continue;
        // `>=` breaks same-millisecond ties by insertion order, so the most
        // recently started activation wins rather than an arbitrary one.
        if (!best || entry.touchedAt >= best.touchedAt) {
            best = { authority: entry.authority, touchedAt: entry.touchedAt };
        }
    }
    return best?.authority ?? null;
}

/** Activation teardown; a rotated generation keeps its own entry. */
export function releaseSelectionAuthority(
    pluginId: string,
    workspaceId: string,
    generation: number
): void {
    authorities.delete(keyFor(pluginId, workspaceId, generation));
}

/** Test helper: clear retained authorities between cases. */
export function clearRetainedSelectionAuthorities(): void {
    authorities.clear();
}
