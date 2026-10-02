import type { WorkspaceSource } from './workspace-items';

export interface WorkspaceSourceReceipt {
    workspaceId: string;
    source: WorkspaceSource;
    partial: boolean;
}

/** Only host workspace-tool results can produce source controls. No Markdown links. */
export function workspaceSourceReceipts(call: { name: string; status: string; result?: string }): WorkspaceSourceReceipt[] {
    if (call.status !== 'complete' || !call.result
        || !['workspace_search', 'workspace_read', 'workspace_create_document', 'workspace_update_project'].includes(call.name)) return [];
    try {
        const parsed: unknown = JSON.parse(call.result);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
        const value = parsed as Record<string, unknown>;
        if (value.version !== 1 || typeof value.workspaceId !== 'string' || !value.workspaceId) return [];
        const sources: unknown[] = call.name !== 'workspace_search' ? [value.source]
            : Array.isArray(value.results) ? value.results.map((item: unknown) =>
                item && typeof item === 'object' ? (item as Record<string, unknown>).source : undefined) : [];
        return sources.filter((candidate): candidate is WorkspaceSource => {
            if (!candidate || typeof candidate !== 'object') return false;
            const source = candidate as Record<string, unknown>;
            return typeof source.kind === 'string' && ['chat', 'document', 'project', 'file'].includes(source.kind)
                && typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 200
                && typeof source.title === 'string' && typeof source.revision === 'string'
                && /^[a-f0-9]{64}$/.test(source.revision);
        })
            .map((source) => ({ workspaceId: value.workspaceId, source,
                partial: value.partial === true || value.coverage === 'partial' })) as WorkspaceSourceReceipt[];
    } catch { return []; }
}

export async function openWorkspaceSource(receipt: WorkspaceSourceReceipt): Promise<void> {
    const [{ captureWorkspaceOperation }, { readWorkspaceItem }, { getPaletteHostContext }, { createRuntimeUuid }] = await Promise.all([
        import('./workspace-access'), import('./workspace-items'),
        import('~/composables/search/useCommandPalette'), import('~~/shared/runtime-id'),
    ]);
    const scope = captureWorkspaceOperation({
        subject: null, workspaceId: receipt.workspaceId, threadId: 'source-navigation', messageId: null,
        requestId: createRuntimeUuid(), callId: createRuntimeUuid(), abortSignal: new AbortController().signal,
    });
    // Identity/visibility and workspace access are checked again at click time.
    await readWorkspaceItem(scope, receipt.source);
    scope.assertCurrent();
    const host = getPaletteHostContext();
    if (!host) throw new Error('Source navigation is unavailable.');
    const result = receipt.source.kind === 'chat' ? await host.openChat(receipt.source.id, 'active')
        : receipt.source.kind === 'document' ? await host.openDocument(receipt.source.id, 'active')
        : receipt.source.kind === 'project' ? await host.revealProject(receipt.source.id)
        : await host.openPaneApp('or3-files', receipt.source.id, 'active');
    if (!result.ok) throw new Error(result.error.message);
}
