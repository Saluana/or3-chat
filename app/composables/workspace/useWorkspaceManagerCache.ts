import { ref } from 'vue';
import type { WorkspaceSummary } from '~/core/workspace/types';
import { getKvByName, setKvByName } from '~/db/kv';

export function useWorkspaceManagerCache(
    baseDb: unknown,
    cacheKey: string
) {
    const cachedWorkspaces = ref<WorkspaceSummary[]>([]);
    const cachedActiveId = ref<string | null>(null);

    async function loadCache() {
        const cached = await getKvByName(cacheKey, baseDb as any);
        if (!cached?.value) return;
        try {
            const parsed = JSON.parse(cached.value) as {
                workspaces?: WorkspaceSummary[];
                activeId?: string | null;
            };
            cachedActiveId.value = parsed.activeId ?? null;
            cachedWorkspaces.value = (parsed.workspaces ?? []).map(
                (workspace) => ({
                    ...workspace,
                    isActive: workspace.id === cachedActiveId.value,
                })
            );
        } catch {
            cachedWorkspaces.value = [];
            cachedActiveId.value = null;
        }
    }

    async function saveCache(list: WorkspaceSummary[]) {
        const activeId =
            list.find((workspace) => workspace.isActive)?.id ??
            cachedActiveId.value;
        cachedActiveId.value = activeId ?? null;

        await setKvByName(
            cacheKey,
            JSON.stringify({
                workspaces: list,
                activeId: cachedActiveId.value,
            }),
            baseDb as any
        );
    }

    return {
        cachedWorkspaces,
        cachedActiveId,
        loadCache,
        saveCache,
    };
}
