import Dexie, { liveQuery } from 'dexie';
import { shallowRef } from 'vue';
import { getDb, getWorkspaceGeneration, getActiveWorkspaceId, subscribeActiveWorkspaceDb } from '~/db/client';
import type { createHistoryRetrievalService, GetHistoryMessageArgs, SearchParentArgs } from '~~/shared/chat/history-retrieval';
import { historyToolDefinitions } from '~~/shared/chat/history-tools';
import { capturedHistoryContext } from './history-reader';
import { useToolRegistry } from './tool-registry';
import { trackHistoryRevisions } from './history-revisions';

/** Client placement uses the existing background browser bridge. No server readiness is inferred. */
export function registerHistoryTools(): () => void {
    const registry = useToolRegistry();
    let service: ReturnType<typeof createHistoryRetrievalService> | undefined;
    let revision = 0; const eligible = shallowRef(new Set<string>());
    const changed = () => { revision++; };
    Dexie.on('storagemutated', changed);
    let subscription: { unsubscribe(): void } | undefined;
    let scopedRevisions: ReturnType<typeof trackHistoryRevisions> | undefined;
    function observe() {
        subscription?.unsubscribe(); eligible.value = new Set(); revision++;
        const db = getDb(); const generation = getWorkspaceGeneration();
        scopedRevisions = trackHistoryRevisions(db);
        subscription = liveQuery(async () => {
            // Metadata only: no history content is loaded to advertise tools.
            const rows = await db.threads.toArray(); const byId = new Map(rows.map((row) => [row.id, row]));
            const ready = new Set<string>(); const resolved = new Map<string, boolean>();
            for (const row of rows) {
                let current = row; const visited = new Set<string>();
                let available = false;
                while (!current.deleted) {
                    if (visited.has(current.id)) break; visited.add(current.id);
                    const cached = resolved.get(current.id); if (cached !== undefined) { available = cached; break; }
                    if (current.branch_mode === 'compacted' && current.summary_message_id) { available = true; break; }
                    if (!current.parent_thread_id) break;
                    const parent = byId.get(current.parent_thread_id); if (!parent) break; current = parent;
                }
                for (const id of visited) { resolved.set(id, available); if (available) ready.add(id); }
            }
            return ready;
        }).subscribe({ next: (ready) => { if (getDb() === db && getWorkspaceGeneration() === generation) eligible.value = ready; },
            error: () => { eligible.value = new Set(); } });
    }
    observe(); const stopWorkspace = subscribeActiveWorkspaceDb(observe);
    const handles: Array<{ dispose(): boolean }> = [];
    try {
        for (const definition of historyToolDefinitions) handles.push(registry.registerTool(definition, async (args, execution) => {
            const capturedRevisions = scopedRevisions!;
            const context = capturedHistoryContext(execution, (ids) => ids ? `${getWorkspaceGeneration()}:${capturedRevisions.revision(ids)}` : `${getWorkspaceGeneration()}:${revision}`);
            // Capture the request workspace before loading code; reads still authorize
            // against that captured workspace after this asynchronous boundary.
            const { createHistoryRetrievalService } = await import('~~/shared/chat/history-retrieval');
            service ??= createHistoryRetrievalService();
            return JSON.stringify(definition.function.name === 'get_message'
                ? await service.getMessage(context, args as unknown as GetHistoryMessageArgs)
                : await service.searchParent(context, args as unknown as SearchParentArgs));
        }, { runtime: 'client', available: ({ workspaceId, threadId }) => Boolean(threadId && eligible.value.has(threadId)
            && workspaceId === (getActiveWorkspaceId() ?? 'local')) }));
    } catch (error) {
        handles.forEach((handle) => handle.dispose()); subscription?.unsubscribe(); stopWorkspace();
        Dexie.on.storagemutated.unsubscribe(changed); throw error;
    }
    return () => { handles.forEach((handle) => handle.dispose()); subscription?.unsubscribe(); stopWorkspace();
        Dexie.on.storagemutated.unsubscribe(changed); };
}
