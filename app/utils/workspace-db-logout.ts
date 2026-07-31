/**
 * @module app/utils/workspace-db-logout
 *
 * Purpose:
 * Clears workspace-scoped IndexedDB databases on logout based on policy flags.
 *
 * Behavior:
 * - Enumerates workspace DB names when possible
 * - Falls back to cached workspace list when enumeration is unavailable
 * - Deletes DBs only when per-workspace logout policy is `clear`
 *
 * Constraints:
 * - Uses best-effort deletion and ignores failures
 */

import Dexie from 'dexie';
import { getDefaultDb } from '~/db/client';
import { getKvByName } from '~/db/kv';

const WORKSPACE_DB_PREFIX = 'or3-db-';
const LOGOUT_POLICY_PREFIX = 'workspace.logout.policy.';

/**
 * `clearWorkspaceDbsOnLogout`
 *
 * Purpose:
 * Deletes workspace DBs that are configured to be cleared on logout.
 */
export async function clearWorkspaceDbsOnLogout(): Promise<void> {
    const baseDb = getDefaultDb();
    let names: string[] = [];
    try {
        names = await Dexie.getDatabaseNames();
    } catch {
        // Fallback to cached workspace list if IndexedDB name enumeration is unavailable.
        try {
            const cached = await getKvByName('workspace.manager.cache', baseDb);
            const parsed = cached?.value
                ? (JSON.parse(cached.value) as {
                      workspaces?: Array<{ _id: string }>;
                  })
                : null;
            names = (parsed?.workspaces ?? []).map(
                (w) => `${WORKSPACE_DB_PREFIX}${w._id}`
            );
        } catch {
            return;
        }
    }

    const workspaceDbs = names.filter((name) =>
        name.startsWith(WORKSPACE_DB_PREFIX)
    );

    await Promise.allSettled(
        workspaceDbs.map(async (name) => {
            const workspaceId = name.slice(WORKSPACE_DB_PREFIX.length);
            if (!workspaceId) return;
            const policy = await getKvByName(
                `${LOGOUT_POLICY_PREFIX}${workspaceId}`,
                baseDb
            );
            if (policy?.value !== 'clear') return;
            await Dexie.delete(name);
        })
    );
}
