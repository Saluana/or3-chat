import type { WorkspaceSource } from './workspace-items';
import type { WorkspaceDocumentChangeRef } from './workspace-document-change';
import { captureWorkspaceOperation } from './workspace-access';
import { createRuntimeUuid } from '~~/shared/runtime-id';

export interface WorkspaceSourceReceipt {
    workspaceId: string;
    source: WorkspaceSource;
    partial: boolean;
    action?: 'created';
}

export function workspaceDocumentChangeReceipt(call: { name: string; status: string; result?: string }):
    (WorkspaceDocumentChangeRef & { source: WorkspaceSource }) | null {
    if (call.name !== 'workspace_propose_document_edit' || call.status !== 'complete' || !call.result) return null;
    try {
        const value = JSON.parse(call.result) as Record<string, unknown>;
        const source = value.source as WorkspaceSource | undefined;
        if (value.version !== 1 || typeof value.workspaceId !== 'string' || !value.workspaceId
            || typeof value.messageId !== 'string' || !value.messageId || typeof value.documentId !== 'string' || !value.documentId
            || typeof value.changeId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.changeId)
            || !['pending_review', 'applied', 'discarded', 'stale', 'undone'].includes(String(value.status))
            || !source || source.kind !== 'document' || source.id !== value.documentId || typeof source.title !== 'string'
            || !/^[a-f0-9]{64}$/u.test(source.revision)) return null;
        return { workspaceId: value.workspaceId, messageId: value.messageId, documentId: value.documentId,
            changeId: value.changeId, source };
    } catch { return null; }
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
                partial: value.partial === true || value.coverage === 'partial',
                ...(call.name === 'workspace_create_document' && value.status === 'saved' ? { action: 'created' } : {}),
            })) as WorkspaceSourceReceipt[];
    } catch { return []; }
}

export async function openWorkspaceSource(receipt: WorkspaceSourceReceipt): Promise<void> {
    const scope = captureWorkspaceOperation({
        subject: null, workspaceId: receipt.workspaceId, threadId: 'source-navigation', messageId: null,
        requestId: createRuntimeUuid(), callId: createRuntimeUuid(), abortSignal: new AbortController().signal,
    });
    const [{ readWorkspaceItem }, { getPaletteHostContext }] = await Promise.all([
        import('./workspace-items'), import('~/composables/search/useCommandPalette'),
    ]);
    scope.assertCurrent();
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
