import { useState } from '#imports';
import type { PaletteHostContext } from '~/core/search/command-palette/types';

export function useProjectExplorerReveal() {
    return useState<{ projectId: string; key: string; generation: number } | null>('project-explorer-reveal', () => null);
}

export function useFilesExplorerReveal() {
    return useState<{ itemId: string; generation: number } | null>('files-explorer-reveal', () => null);
}

export async function openFilesTab(host: PaletteHostContext) {
    const { getOpenWorkspaceTabs } = await import('~/core/search/command-palette/sources/workspace-tab-source');
    const existing = getOpenWorkspaceTabs().find(tab => tab.resource.kind === 'app' && tab.resource.appId === 'or3-files' && !tab.resource.recordId);
    return existing && host.openWorkspaceTab ? host.openWorkspaceTab(existing.id) : host.openPaneApp('or3-files', undefined, 'active');
}
