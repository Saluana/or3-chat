import { ref, onScopeDispose } from 'vue';
import { useRuntimeConfig } from '#imports';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { getCachedSessionPayload } from '~/composables/auth/useSessionContext';
import { emptyWorkspaceModels, WorkspaceModelsSchema } from '~~/shared/ai/workspace-models';

const policy = ref(emptyWorkspaceModels());
let generation = -1;
let pending: Promise<void> | null = null;
export function useWorkspaceModels() {
    // Server renders have no browser credentials or shared client workspace state.
    if (import.meta.server) return { policy: ref(emptyWorkspaceModels()), load: async () => {} };
    const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
    function reset() {
        if (generation === getWorkspaceGeneration()) return;
        generation = getWorkspaceGeneration(); policy.value = emptyWorkspaceModels(); pending = null;
    }
    async function load() {
        reset();
        if (!cloud || getCachedSessionPayload()?.session?.authenticated !== true) return;
        if (pending) return pending;
        const owner = generation;
        const request = $fetch('/api/workspaces/models').then(result => {
            if (generation === owner && getWorkspaceGeneration() === owner) policy.value = WorkspaceModelsSchema.parse(result);
        }).finally(() => { if (pending === request) pending = null; });
        pending = request;
        return request;
    }
    reset();
    const unsubscribe = subscribeActiveWorkspaceDb(() => { reset(); void load().catch(() => {}); });
    onScopeDispose(unsubscribe);
    return { policy, load };
}
