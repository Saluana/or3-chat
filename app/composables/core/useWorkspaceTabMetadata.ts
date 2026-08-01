import { shallowReactive } from 'vue';
import { getDb } from '~/db/client';
import { usePaneApps } from '~/composables/core/usePaneApps';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';

export interface WorkspaceTabMetadata {
    title: string;
    fullTitle: string;
    icon?: string;
}

function fallbackTitle(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return tab.resource.threadId ? 'Chat' : 'New chat';
    if (tab.resource.kind === 'document') return 'Untitled document';
    return tab.resource.appId;
}

/**
 * Batch title resolver. It deliberately refreshes one compact map rather than
 * creating a database live query for every open tab.
 */
export function useWorkspaceTabMetadata() {
    const metadata = shallowReactive(new Map<string, WorkspaceTabMetadata>());
    const { getPaneApp } = usePaneApps();
    let requestGeneration = 0;

    async function refresh(tabs: readonly WorkspaceTab[]): Promise<void> {
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
        const [threads, documents] = await Promise.all([
            threadIds.length ? db.threads.bulkGet(threadIds) : Promise.resolve([]),
            documentIds.length ? db.posts.bulkGet(documentIds) : Promise.resolve([]),
        ]);
        if (generation !== requestGeneration) return;
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
                title = getPaneApp(tab.resource.appId)?.label || title;
            }
            next.set(tab.id, {
                title,
                fullTitle: title,
                icon:
                    tab.resource.kind === 'app'
                        ? getPaneApp(tab.resource.appId)?.icon
                        : undefined,
            });
        }
        metadata.clear();
        next.forEach((value, key) => metadata.set(key, value));
    }

    function titleFor(tab: WorkspaceTab): WorkspaceTabMetadata {
        return metadata.get(tab.id) ?? {
            title: tab.cachedTitle || fallbackTitle(tab),
            fullTitle: tab.cachedTitle || fallbackTitle(tab),
        };
    }

    return { metadata, refresh, titleFor };
}
