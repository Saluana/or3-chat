import type { WorkspaceTab, WorkspaceTabStatus } from './types';

export function workspaceTabTitle(tab: WorkspaceTab): string {
    if (tab.cachedTitle) return tab.cachedTitle;
    if (tab.resource.kind === 'chat') {
        return tab.resource.threadId ? 'Chat' : 'New chat';
    }
    if (tab.resource.kind === 'document') return 'Untitled document';
    return tab.resource.appId;
}

export function workspaceTabKindLabel(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return 'Chat';
    if (tab.resource.kind === 'document') return 'Document';
    return `App · ${tab.resource.appId}`;
}

export function workspaceTabFallbackIcon(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return 'i-lucide-message-circle';
    if (tab.resource.kind === 'document') return 'i-lucide-file-text';
    return 'i-lucide-panels-top-left';
}

export function workspaceTabStatusDescription(
    status: WorkspaceTabStatus
): string {
    if (status === 'idle') return '';
    if (status === 'attention') return 'Needs attention';
    if (status === 'streaming') return 'Generating response';
    if (status === 'saving') return 'Saving';
    if (status === 'loading') return 'Loading';
    return 'Error';
}

/** Human label for when a tab was last focused/opened. */
export function workspaceTabOpenedLabel(
    timestampMs: number,
    nowMs: number = Date.now()
): string {
    const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
    if (seconds < 45) return 'Opened just now';
    if (seconds < 3600) {
        const minutes = Math.max(1, Math.floor(seconds / 60));
        return minutes === 1 ? 'Opened 1 min ago' : `Opened ${minutes} min ago`;
    }
    if (seconds < 86_400) {
        const hours = Math.max(1, Math.floor(seconds / 3600));
        return hours === 1 ? 'Opened 1 hour ago' : `Opened ${hours} hours ago`;
    }
    const days = Math.max(1, Math.floor(seconds / 86_400));
    return days === 1 ? 'Opened 1 day ago' : `Opened ${days} days ago`;
}

export type WorkspaceTabSortId =
    | 'recent'
    | 'least-recent'
    | 'title-asc'
    | 'title-desc'
    | 'kind'
    | 'newest-created'
    | 'oldest-created';

export const WORKSPACE_TAB_SORT_OPTIONS: readonly {
    id: WorkspaceTabSortId;
    label: string;
}[] = [
    { id: 'recent', label: 'Most recently opened' },
    { id: 'least-recent', label: 'Least recently opened' },
    { id: 'title-asc', label: 'Title A–Z' },
    { id: 'title-desc', label: 'Title Z–A' },
    { id: 'kind', label: 'Type' },
    { id: 'newest-created', label: 'Newest created' },
    { id: 'oldest-created', label: 'Oldest created' },
] as const;

const KIND_ORDER: Record<WorkspaceTab['resource']['kind'], number> = {
    chat: 0,
    document: 1,
    app: 2,
};

export function sortWorkspaceTabs(
    tabs: readonly WorkspaceTab[],
    sortId: WorkspaceTabSortId
): WorkspaceTab[] {
    const next = [...tabs];
    next.sort((a, b) => {
        switch (sortId) {
            case 'least-recent':
                return a.lastActivatedAt - b.lastActivatedAt;
            case 'title-asc':
                return workspaceTabTitle(a).localeCompare(
                    workspaceTabTitle(b),
                    undefined,
                    { sensitivity: 'base' }
                );
            case 'title-desc':
                return workspaceTabTitle(b).localeCompare(
                    workspaceTabTitle(a),
                    undefined,
                    { sensitivity: 'base' }
                );
            case 'kind': {
                const byKind =
                    KIND_ORDER[a.resource.kind] - KIND_ORDER[b.resource.kind];
                if (byKind !== 0) return byKind;
                return workspaceTabTitle(a).localeCompare(
                    workspaceTabTitle(b),
                    undefined,
                    { sensitivity: 'base' }
                );
            }
            case 'newest-created':
                return b.createdAt - a.createdAt;
            case 'oldest-created':
                return a.createdAt - b.createdAt;
            case 'recent':
            default:
                return b.lastActivatedAt - a.lastActivatedAt;
        }
    });
    return next;
}
