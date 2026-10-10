import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import { prepareDocumentCreate, getDocument, getDocumentInDb, type CreateDocumentInput } from '~/db/documents';
import { getWriteTxTableNames } from '~/db/util';
import { parseFileHashes } from '~/db/files-util';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';
import { useCommandPalette } from '~/composables/search/useCommandPalette';
import type { ToolExecutionContext } from '~/utils/chat/types';
import { getActiveDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { getOpenWorkspaceTabs } from '~/core/search/command-palette/sources/workspace-tab-source';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import { tiptapToPlainText, normalizeMessageContent } from '~/core/search/command-palette/normalize';
import { messagesByThread } from '~/db/messages';
import { getThread } from '~/db/threads';

const MAX_CONTEXT_CHARS = 18_000;
const MAX_SEARCH_RESULTS = 10;

function assertChatWorkspace(context: ToolExecutionContext): void {
    if (
        context.abortSignal.aborted
        || !context.threadId
        || !context.workspaceId
        || context.workspaceId !== (getActiveWorkspaceId() ?? 'local')
    ) {
        throw new Error('This chat no longer belongs to the active workspace.');
    }
}

function truncate(text: string): string {
    return text.length > MAX_CONTEXT_CHARS
        ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n…[truncated]`
        : text;
}

function assertWriteOrigin(context: ToolExecutionContext, db: Or3DB, generation: number): void {
    assertChatWorkspace(context);
    if (getDb() !== db || getWorkspaceGeneration() !== generation) {
        throw new Error('The workspace changed before the document could be saved.');
    }
}

/** Preparation may run plugin hooks; authorization is checked again at commit. */
async function saveChatDocument(input: CreateDocumentInput, context: ToolExecutionContext, sourceId?: string) {
    const scope = captureWorkspaceOperation(context);
    scope.assertCurrent('write');
    const prepared = await prepareDocumentCreate(input);
    await scope.db.transaction('rw', getWriteTxTableNames(scope.db, ['posts', 'file_meta', 'projects', 'threads']), async () => {
        scope.assertCurrent('write');
        await context.assertToolAuthorized?.();
        if (sourceId) {
            const source = await scope.db.posts.get(sourceId);
            if (!source || source.deleted || source.postType !== 'doc') throw new Error('The source document is no longer available.');
        }
        for (const hash of parseFileHashes(prepared.row.file_hashes)) {
            const file = await scope.db.file_meta.get(hash);
            if (!file || file.deleted) throw new Error('A referenced workspace image is unavailable.');
        }
        scope.assertCurrent('write');
        await scope.db.posts.put(prepared.row);
    });
    try { await prepared.afterCommit(); }
    catch (error) { console.warn('Document saved; after-create hook failed.', error); }
    return prepared.row;
}

export async function createChatDocument(
    title: string | undefined,
    content: string | undefined,
    context: ToolExecutionContext,
): Promise<string> {
    assertChatWorkspace(context);
    const db = getDb();
    const generation = getWorkspaceGeneration();
    let documentContent: CreateDocumentInput['content'];
    if (content?.trim()) {
        const { markdownToTipTapDoc } = await import('~/utils/chat/markdownToTipTapDoc');
        documentContent = markdownToTipTapDoc(content) as CreateDocumentInput['content'];
    }
    assertWriteOrigin(context, db, generation);
    const created = await saveChatDocument({ title, content: documentContent }, context);
    return JSON.stringify({ documentId: created.id, title: created.title });
}

export async function duplicateChatDocument(
    documentId: string,
    tabId: string | undefined,
    title: string | undefined,
    context: ToolExecutionContext,
): Promise<string> {
    assertChatWorkspace(context);
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const documentTabs = getOpenWorkspaceTabs().filter((tab) =>
        tab.resource.kind === 'document'
        && tab.resource.documentId === documentId,
    );
    if (tabId && !documentTabs.some((tab) => tab.id === tabId)) {
        throw new Error('That document tab is no longer open. List tabs again.');
    }
    const activeTabs = documentTabs.filter((tab) =>
        getActiveDocumentEditorSession(documentId, tab.id),
    );
    if (!tabId && activeTabs.length > 1) {
        throw new Error('This document is open in multiple editor panes. Specify tabId.');
    }
    const activeTab = tabId
        ? activeTabs.find((tab) => tab.id === tabId)
        : activeTabs[0];
    if (activeTab) {
        await getActiveDocumentEditorSession(documentId, activeTab.id)?.ensureLocalDurability();
    }
    assertWriteOrigin(context, db, generation);
    const source = await getDocumentInDb(db, documentId);
    if (!source || source.deleted) throw new Error('The source document is no longer available.');
    assertWriteOrigin(context, db, generation);
    const copy = await saveChatDocument({
        title: title?.trim() || `${source.title} (copy)`,
        content: source.content,
    }, context, source.id);
    return JSON.stringify({ documentId: copy.id, title: copy.title, sourceDocumentId: source.id });
}

export async function searchDocuments(query: string, context: ToolExecutionContext): Promise<string> {
    assertChatWorkspace(context);
    const normalized = query.trim();
    if (!normalized) throw new Error('Enter a document search term.');
    const originDbName = getDb().name;
    const palette = useCommandPalette();
    if (!palette.getCoordinator()) await palette.warm();
    const coordinator = palette.getCoordinator();
    if (!coordinator) throw new Error('Document search is unavailable right now.');
    const results = await coordinator.searchSource('document', normalized, MAX_SEARCH_RESULTS);
    assertChatWorkspace(context);
    if (getDb().name !== originDbName) throw new Error('The workspace changed during document search.');
    const tabs = getOpenWorkspaceTabs();
    return JSON.stringify({
        query,
        results: results.map((item) => ({
            documentId: item.recordId,
            title: item.title,
            match: item.title.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()) ? 'title' : 'content',
            snippet: item.snippet ?? '',
            openTabIds: tabs.flatMap((tab) =>
                tab.resource.kind === 'document' && tab.resource.documentId === item.recordId
                    ? [tab.id] : [],
            ),
        })),
    });
}

const EMPTY_CHAT_CONTEXT = 'This chat has no messages yet.';

function openTabTitle(tab: WorkspaceTab): string {
    if (tab.cachedTitle) return tab.cachedTitle;
    const resource = tab.resource;
    if (resource.kind === 'chat') return resource.threadId ? 'Chat' : 'New chat';
    if (resource.kind === 'document') return 'Untitled document';
    return resource.appId;
}

function summarizeOpenTab(tab: WorkspaceTab, currentThreadId: string | null) {
    const resource = tab.resource;
    if (resource.kind === 'document') {
        return {
            tabId: tab.id,
            title: openTabTitle(tab),
            kind: resource.kind,
            documentId: resource.documentId,
            editorOpen: Boolean(getActiveDocumentEditorSession(resource.documentId, tab.id)),
        };
    }
    if (resource.kind === 'chat') {
        return {
            tabId: tab.id,
            title: openTabTitle(tab),
            kind: resource.kind,
            ...(resource.threadId
                ? {
                    threadId: resource.threadId,
                    ...(resource.threadId === currentThreadId ? { current: true } : {}),
                }
                : { empty: true }),
        };
    }
    return {
        tabId: tab.id,
        title: openTabTitle(tab),
        kind: resource.kind,
        appId: resource.appId,
        recordId: resource.recordId,
    };
}

function listOpenTabsPayload(tabs: readonly WorkspaceTab[], currentThreadId: string | null) {
    return {
        tabs: tabs.slice(0, 50).map((tab) => summarizeOpenTab(tab, currentThreadId)),
        total: tabs.length,
    };
}

export async function openPaneContext(tabId: string | undefined, context: ToolExecutionContext): Promise<string> {
    assertChatWorkspace(context);
    const requested = tabId?.trim();
    const tabs = getOpenWorkspaceTabs();
    if (!requested) {
        return JSON.stringify(listOpenTabsPayload(tabs, context.threadId));
    }
    const tab = tabs.find((entry) => entry.id === requested);
    if (!tab) {
        return JSON.stringify({
            matched: false,
            message: 'No open tab uses that id. Copy a tabId from tabs and call again to read it. A new chat with no messages has no threadId; it is empty, not closed.',
            ...listOpenTabsPayload(tabs, context.threadId),
        });
    }
    const resource = tab.resource;
    const originDbName = getDb().name;
    let content: string;
    let emptyChat = false;
    if (resource.kind === 'document') {
        const session = getActiveDocumentEditorSession(resource.documentId, tab.id);
        if (session?.getChatContext) {
            content = session.getChatContext(context.requestId);
        } else {
            const row = await getDocument(resource.documentId);
            if (!row || row.deleted) {
                throw new Error('This document is no longer available.');
            }
            content = tiptapToPlainText(row.content);
        }
    } else if (resource.kind === 'chat' && resource.threadId) {
        const db = getDb();
        const thread = await getThread(resource.threadId);
        if (!thread || thread.deleted) throw new Error('This chat is no longer available.');
        const messages = await messagesByThread(resource.threadId, db) as
            Array<{ role: string; content?: unknown; data?: unknown; deleted?: boolean }> | undefined;
        content = (messages ?? []).filter((message) => !message.deleted).slice(-30)
            .map((message) => `${message.role}: ${normalizeMessageContent(message).slice(0, 2_000)}`)
            .join('\n');
        if (!content.trim()) {
            content = EMPTY_CHAT_CONTEXT;
            emptyChat = true;
        }
    } else if (resource.kind === 'chat') {
        content = EMPTY_CHAT_CONTEXT;
        emptyChat = true;
    } else {
        content = '';
    }
    assertChatWorkspace(context);
    if (getDb().name !== originDbName) throw new Error('The workspace changed while reading this tab.');
    const current = getOpenWorkspaceTabs().find((entry) => entry.id === requested);
    if (!current || JSON.stringify(current.resource) !== JSON.stringify(resource)) {
        return JSON.stringify({
            matched: false,
            message: 'That tab changed while it was being read. Copy a tabId from tabs and call again.',
            ...listOpenTabsPayload(getOpenWorkspaceTabs(), context.threadId),
        });
    }
    const identity = resource.kind === 'chat'
        ? {
            kind: 'chat' as const,
            ...(resource.threadId
                ? {
                    threadId: resource.threadId,
                    ...(resource.threadId === context.threadId ? { current: true } : {}),
                }
                : {}),
            ...(emptyChat ? { empty: true } : {}),
        }
        : resource;
    return JSON.stringify({
        tabId: requested,
        title: openTabTitle(tab),
        ...identity,
        content: truncate(content),
        readOnly: true,
        editorOpen: resource.kind === 'document'
            && Boolean(getActiveDocumentEditorSession(resource.documentId, tab.id)),
    });
}


export function executeDocumentEditorTool(name: string, args: Record<string, unknown>, context: ToolExecutionContext) {
    assertChatWorkspace(context);
    const documentId = String(args.documentId);
    const candidates = getOpenWorkspaceTabs().filter((entry) =>
        entry.resource.kind === 'document'
        && entry.resource.documentId === documentId
        && getActiveDocumentEditorSession(documentId, entry.id),
    );
    const tab = typeof args.tabId === 'string'
        ? candidates.find((entry) => entry.id === args.tabId)
        : candidates.length === 1 ? candidates[0] : undefined;
    if (!args.tabId && candidates.length > 1) {
        throw new Error('This document is open in multiple editor panes. Specify tabId.');
    }
    const session = getActiveDocumentEditorSession(documentId, tab?.id);
    if (!tab || !session?.executeChatTool) {
        throw new Error('Open this document in a visible editor pane before using its edit tools.');
    }
    const result = session.executeChatTool(
        name,
        JSON.stringify(args),
        context.requestId,
    );
    assertChatWorkspace(context);
    return result;
}
