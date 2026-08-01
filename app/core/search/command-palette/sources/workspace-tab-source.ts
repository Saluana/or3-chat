import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';

let getOpenTabs: () => readonly WorkspaceTab[] = () => [];

/** PageShell supplies the current local session without making it global API. */
export function setWorkspaceTabPaletteProvider(
    provider: () => readonly WorkspaceTab[]
): () => void {
    getOpenTabs = provider;
    return () => {
        if (getOpenTabs === provider) getOpenTabs = () => [];
    };
}

function tabTitle(tab: WorkspaceTab): string {
    if (tab.cachedTitle) return tab.cachedTitle;
    if (tab.resource.kind === 'chat') return tab.resource.threadId ? 'Chat' : 'New chat';
    if (tab.resource.kind === 'document') return 'Untitled document';
    return tab.resource.appId;
}

function tabSubtitle(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return 'Chat';
    if (tab.resource.kind === 'document') return 'Document';
    return `App · ${tab.resource.appId}`;
}

function tabIcon(tab: WorkspaceTab): string {
    if (tab.resource.kind === 'chat') return 'i-lucide-message-circle';
    if (tab.resource.kind === 'document') return 'i-lucide-file-text';
    return 'i-lucide-panels-top-left';
}

export function createWorkspaceTabPaletteSource(): PaletteSearchSource {
    return {
        id: 'workspace-tab',
        label: 'Open tabs',
        category: CORE_PALETTE_CATEGORIES.find((entry) => entry.id === 'tab')!,
        order: 15,
        async load() {
            return getOpenTabs().map(
                (tab): PaletteResource => ({
                    key: `workspace-tab:${tab.id}`,
                    sourceId: 'workspace-tab',
                    categoryId: 'tab',
                    recordId: tab.id,
                    title: tabTitle(tab),
                    subtitle: tabSubtitle(tab),
                    keywords: [tab.resource.kind],
                    updatedAt: tab.lastActivatedAt,
                    icon: tabIcon(tab),
                    primaryAction: {
                        id: `workspace-tab:open:${tab.id}`,
                        label: 'Open tab',
                        target: { kind: 'workspace-tab', tabId: tab.id },
                    },
                    metadata: {
                        ephemeral: tab.ephemeral,
                        kind: tab.resource.kind,
                    },
                })
            );
        },
    };
}
