import { watch } from 'vue';
import Dexie from 'dexie';
import { getDefaultDb, setActiveWorkspaceDb } from '~/db/client';
import { getKvByName } from '~/db/kv';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { cleanupCursorManager } from '~/core/sync/cursor-manager';
import { cleanupHookBridge } from '~/core/sync/hook-bridge';
import { cleanupSubscriptionManager } from '~/core/sync/subscription-manager';

const cacheKey = 'workspace.manager.cache';
const logoutPolicyPrefix = 'workspace.logout.policy.';

async function clearWorkspaceDbsOnLogout() {
    const baseDb = getDefaultDb();
    const cached = await getKvByName(cacheKey, baseDb);
    if (!cached?.value) return;
    try {
        const parsed = JSON.parse(cached.value) as {
            workspaces?: Array<{ _id: string }>;
        };
        const ids = parsed.workspaces?.map((w) => w._id) ?? [];
        await Promise.all(
            ids.map(async (workspaceId) => {
                const policy = await getKvByName(
                    `${logoutPolicyPrefix}${workspaceId}`,
                    baseDb
                );
                if (policy?.value !== 'clear') return;
                await Dexie.delete(`or3-db-${workspaceId}`);
            })
        );
    } catch {
        // ignore cache parse errors
    }
}

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        setActiveWorkspaceDb(null);
        return;
    }

    const { data, refresh } = useSessionContext();

    await refresh();

    const resolveWorkspaceId = () =>
        data.value?.session?.authenticated ? data.value?.session?.workspace?.id ?? null : null;

    setActiveWorkspaceDb(resolveWorkspaceId());

    watch(
        () => data.value?.session,
        async (newSession, oldSession) => {
            const oldWorkspaceId = oldSession?.workspace?.id;
            if (oldWorkspaceId) {
                const dbName = `or3-db-${oldWorkspaceId}`;
                cleanupCursorManager(dbName);
                cleanupHookBridge(dbName);
                cleanupSubscriptionManager(`${oldWorkspaceId}:default`);
            }
            if (oldSession?.authenticated && !newSession?.authenticated) {
                await clearWorkspaceDbsOnLogout();
            }
            setActiveWorkspaceDb(resolveWorkspaceId());
        }
    );
});
