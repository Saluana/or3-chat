import { ref, onScopeDispose } from 'vue';
import { useRuntimeConfig } from '#imports';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getCachedSessionPayload } from '~/composables/auth/useSessionContext';
import { emptyWorkspaceModels, WorkspaceModelsSchema } from '~~/shared/ai/workspace-models';

// Every chat pane asks for the policy when it mounts. The server enforces it on
// each request, so a briefly stale copy only affects which models are listed.
const MAX_AGE_MS = 60_000;

const policy = ref(emptyWorkspaceModels());
let generation = -1;
let pending: Promise<void> | null = null;
let loadedAt = 0;
export function useWorkspaceModels() {
    // Server renders have no browser credentials or shared client workspace state.
    if (import.meta.server) return { policy: ref(emptyWorkspaceModels()), load: async () => {} };
    const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
    function reset() {
        if (generation === getWorkspaceGeneration()) return;
        generation = getWorkspaceGeneration(); policy.value = emptyWorkspaceModels(); pending = null; loadedAt = 0;
    }
    /** `force` skips the cache, e.g. for an explicit refresh. */
    async function load(options: { force?: boolean } = {}) {
        reset();
        if (!cloud || getCachedSessionPayload()?.session?.authenticated !== true) return;
        if (pending) return pending;
        if (!options.force && loadedAt && Date.now() - loadedAt < MAX_AGE_MS) return;
        const owner = generation;
        const request = $fetch('/api/workspaces/models').then(result => {
            if (generation === owner && getWorkspaceGeneration() === owner) {
                policy.value = WorkspaceModelsSchema.parse(result);
                loadedAt = Date.now();
            }
        }).finally(() => { if (pending === request) pending = null; });
        pending = request;
        return request;
    }
    reset();
    const unsubscribe = subscribeActiveWorkspaceDb(() => { reset(); void load().catch(() => {}); });
    onScopeDispose(unsubscribe);
    return { policy, load };
}
