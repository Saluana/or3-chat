import { getCurrentScope, onScopeDispose, shallowReactive } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { usePaneApps } from '~/composables/core/usePaneApps';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';

export interface WorkspaceTabMetadata {
    title: string;
    fullTitle: string;
    icon?: string;
    image?: string;
}

function fallbackTitle(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return tab.resource.threadId ? 'Chat' : 'New chat';
    if (tab.resource.kind === 'document') return 'Untitled document';
    return tab.resource.appId;
}

/**
 * Batch title resolver. It deliberately refreshes one compact map rather than
 * creating a database live query for every open tab. Workspace changes clear
 * the map and invalidate pending reads, including switches back to the same DB.
 */
export function useWorkspaceTabMetadata() {
    const metadata = shallowReactive(new Map<string, WorkspaceTabMetadata>());
    const { getPaneApp } = usePaneApps();
    let requestGeneration = 0;
    let workspaceGeneration = getWorkspaceGeneration();
    const observe = !!getCurrentScope() && typeof window !== 'undefined';
    let subscription: Subscription | undefined;
    let settleRefresh: (() => void) | undefined;
    let disposed = false;

    function stopObservation(): void {
        subscription?.unsubscribe();
        subscription = undefined;
        settleRefresh?.();
        settleRefresh = undefined;
    }

    function synchronizeScope(): void {
        const current = getWorkspaceGeneration();
        if (current === workspaceGeneration) return;
        workspaceGeneration = current;
        requestGeneration++;
        stopObservation();
        metadata.clear();
    }

    if (getCurrentScope()) {
        const stopWorkspace = typeof window === 'undefined'
            ? () => undefined
            : subscribeActiveWorkspaceDb(synchronizeScope);
        onScopeDispose(() => {
            disposed = true;
            stopWorkspace();
            stopObservation();
            requestGeneration++;
            metadata.clear();
        });
    }

    async function refresh(tabs: readonly WorkspaceTab[]): Promise<void> {
        if (disposed) return;
        synchronizeScope();
        stopObservation();
        const generation = ++requestGeneration;
        const threadIds = tabs.flatMap((tab) =>
            tab.resource.kind === 'chat' && tab.resource.threadId
                ? [tab.resource.threadId]
                : []
        );
        const documentIds = tabs.flatMap((tab) =>
            tab.resource.kind === 'document' ? [tab.resource.documentId] : []
        );
        const db = getDb();
        const readMetadata = async () => {
            const [threads, documents] = await Promise.all([
                threadIds.length ? db.threads.bulkGet(threadIds) : Promise.resolve([]),
                documentIds.length ? db.posts.bulkGet(documentIds) : Promise.resolve([]),
            ]);
            const threadTitles = new Map(
                threads.flatMap((thread) =>
                    thread && !thread.deleted && typeof thread.title === 'string'
                        ? [[thread.id, thread.title] as const]
                        : []
                )
            );
            const documentTitles = new Map(
                documents.flatMap((document) =>
                    document &&
                    !document.deleted &&
                    document.postType === 'doc' &&
                    typeof document.title === 'string'
                        ? [[document.id, document.title] as const]
                        : []
                )
            );
            const next = new Map<string, WorkspaceTabMetadata>();
            for (const tab of tabs) {
                let title = tab.cachedTitle || fallbackTitle(tab);
                if (tab.resource.kind === 'chat' && tab.resource.threadId) {
                    title = threadTitles.get(tab.resource.threadId)?.trim() || title;
                } else if (tab.resource.kind === 'document') {
                    title = documentTitles.get(tab.resource.documentId)?.trim() || title;
                } else if (tab.resource.kind === 'app') {
                    const appLabel = getPaneApp(tab.resource.appId)?.label;
                    const cachedTitle = tab.cachedTitle.trim();
                    title =
                        cachedTitle &&
                        cachedTitle !== tab.resource.appId &&
                        cachedTitle !== appLabel
                            ? cachedTitle
                            : appLabel || title;
                }
                next.set(tab.id, {
                    title,
                    fullTitle: title,
                    icon:
                        tab.resource.kind === 'app'
                            ? getPaneApp(tab.resource.appId)?.icon
                            : undefined,
                    image:
                        tab.resource.kind === 'app'
                            ? getPaneApp(tab.resource.appId)?.image
                            : undefined,
                });
            }
            return next;
        };
        const apply = (next: Map<string, WorkspaceTabMetadata>) => {
            synchronizeScope();
            if (disposed || generation !== requestGeneration) return;
            metadata.clear();
            next.forEach((value, key) => metadata.set(key, value));
        };
        if (observe && (threadIds.length || documentIds.length)) {
            // One batched local observer for all open tabs. Remote sync and
            // sibling windows bypass the local CRUD hooks used by the shell.
            await new Promise<void>((resolve, reject) => {
                settleRefresh = resolve;
                subscription = liveQuery(readMetadata).subscribe({
                    next: next => { apply(next); resolve(); settleRefresh = undefined; },
                    error: error => { reject(error); settleRefresh = undefined; },
                });
            });
        } else {
            apply(await readMetadata());
        }
    }

    function titleFor(tab: WorkspaceTab): WorkspaceTabMetadata {
        synchronizeScope();
        return metadata.get(tab.id) ?? {
            title: tab.cachedTitle || fallbackTitle(tab),
            fullTitle: tab.cachedTitle || fallbackTitle(tab),
        };
    }

    return { metadata, refresh, titleFor };
}
