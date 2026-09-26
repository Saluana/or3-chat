import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import { createDocumentInDb, getDocument, getDocumentInDb, type CreateDocumentInput } from '~/db/documents';
import { useCommandPalette } from '~/composables/search/useCommandPalette';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import { DOCUMENT_AI_AGENT_TOOLS } from './document-ai-tools';
import { getActiveDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { getOpenWorkspaceTabs } from '~/core/search/command-palette/sources/workspace-tab-source';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';
import { tiptapToPlainText, normalizeMessageContent } from '~/core/search/command-palette/normalize';
import { messagesByThread } from '~/db/messages';
import { getThread } from '~/db/threads';

const MAX_CONTEXT_CHARS = 18_000;
const MAX_SEARCH_RESULTS = 10;
const MAX_DOCUMENT_CONTENT_CHARS = 50_000;

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

function available(context: { workspaceId: string | null; threadId: string | null }): boolean {
    return Boolean(
        context.threadId
        && context.workspaceId
        && context.workspaceId === (getActiveWorkspaceId() ?? 'local'),
    );
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

const createDocumentDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'create_document',
        description: 'Create a new document in the current workspace. Supply a title and optional body text. The new document is saved but not opened automatically.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                content: { type: 'string', maxLength: MAX_DOCUMENT_CONTENT_CHARS, description: 'Optional document body. Simple Markdown formatting is supported.' },
            },
        },
    },
    ui: {
        label: 'Create document',
        descriptionHint: 'Make a new document from a title and optional text.',
        category: 'Document',
        icon: 'i-lucide-file-plus-2',
        defaultEnabled: true,
    },
    runtime: 'client',
};

const duplicateDocumentDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'duplicate_document',
        description: 'Make a separate copy of an existing document in the current workspace, preserving its content and formatting. Use a documentId from search_documents or get_open_pane_context. If the source is open in multiple editor panes, supply tabId. The copy is saved but not opened automatically.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['documentId'],
            properties: {
                documentId: { type: 'string', minLength: 1, maxLength: 200 },
                tabId: { type: 'string', minLength: 1, maxLength: 200 },
                title: { type: 'string', minLength: 1, maxLength: 200, description: 'Optional title for the copy.' },
            },
        },
    },
    ui: {
        label: 'Duplicate document',
        descriptionHint: 'Make a separate copy of a document.',
        category: 'Document',
        icon: 'i-lucide-files',
        defaultEnabled: true,
    },
    runtime: 'client',
};

async function createChatDocument(
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
    const created = await createDocumentInDb(db, { title, content: documentContent });
    return JSON.stringify({ documentId: created.id, title: created.title });
}

async function duplicateChatDocument(
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
    const copy = await createDocumentInDb(db, {
        title: title?.trim() || `${source.title} (copy)`,
        content: source.content,
    });
    return JSON.stringify({ documentId: copy.id, title: copy.title, sourceDocumentId: source.id });
}

const searchDocumentsDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'search_documents',
        description: 'Find documents in the current workspace by title or text. Returns document IDs and open tab IDs. Use a document ID with the document tools; editing requires its editor to be open in a visible pane.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
                query: { type: 'string', minLength: 1, maxLength: 200 },
            },
        },
    },
    ui: {
        label: 'Find documents',
        descriptionHint: 'Search workspace documents by title or text.',
        category: 'Document',
        icon: 'i-lucide-files',
        defaultEnabled: true,
    },
    runtime: 'client',
};

const openPaneContextDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'get_open_pane_context',
        description: 'Call with no arguments, or a blank tabId, to list open workspace tabs and their exact tabIds. Do not invent a tabId. A new chat with no messages is still open: it has no threadId, and reading it reports that it is empty. Pass a listed tabId to read that tab. An unknown tabId returns the current list instead of failing. Visible document editors include live unsaved content and block refs; inactive documents and chats return read-only saved content. App tabs return metadata.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                tabId: {
                    type: 'string',
                    maxLength: 2_000,
                    description: 'Omit, or pass a blank string, to list open tabs. Otherwise pass a tabId from that list.',
                },
            },
        },
    },
    ui: {
        label: 'See open tabs',
        descriptionHint: 'Let chat see what is open in other tabs.',
        category: 'Workspace',
        icon: 'i-lucide-panels-top-left',
        defaultEnabled: true,
    },
    runtime: 'client',
};

const documentChatDefinitions: ToolDefinition[] = DOCUMENT_AI_AGENT_TOOLS.map((tool) => ({
    ...tool,
    function: {
        ...tool.function,
        description: `${tool.function.description} Requires documentId from search_documents or get_open_pane_context and a visible document editor. If the same document is visible in two panes, supply tabId.${['read_blocks', 'propose_edits'].includes(tool.function.name) ? ' Use the snapshotId returned by the latest document outline, search, or open-pane context.' : ''} Changes appear in the editor for review; they are never applied automatically.`,
        parameters: {
            ...tool.function.parameters,
            required: [
                ...(tool.function.parameters.required ?? []),
                'documentId',
                ...(['read_blocks', 'propose_edits'].includes(tool.function.name) ? ['snapshotId'] : []),
            ],
            properties: {
                ...tool.function.parameters.properties,
                documentId: { type: 'string', minLength: 1, maxLength: 200 },
                tabId: { type: 'string', minLength: 1, maxLength: 200 },
                ...(['read_blocks', 'propose_edits'].includes(tool.function.name)
                    ? { snapshotId: { type: 'string', description: 'Use the snapshotId returned when you read this document.' } }
                    : {}),
            },
        },
    },
    ui: {
        ...tool.ui,
        defaultEnabled: true,
    },
    runtime: 'client',
}));

async function searchDocuments(query: string, context: ToolExecutionContext): Promise<string> {
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

async function openPaneContext(tabId: string | undefined, context: ToolExecutionContext): Promise<string> {
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

/** Register document discovery, creation, duplication, and editor tools with chat. */
export function registerDocumentChatTools(): () => void {
    const registry = useToolRegistry();
    const handles = [
        registry.registerTool(createDocumentDefinition, ({ title, content }, context) =>
            createChatDocument(
                typeof title === 'string' ? title : undefined,
                typeof content === 'string' ? content : undefined,
                context,
            ), { runtime: 'client', available }),
        registry.registerTool(duplicateDocumentDefinition, ({ documentId, tabId, title }, context) =>
            duplicateChatDocument(
                String(documentId),
                typeof tabId === 'string' ? tabId : undefined,
                typeof title === 'string' ? title : undefined,
                context,
            ), { runtime: 'client', available }),
        registry.registerTool(searchDocumentsDefinition, ({ query }, context) =>
            searchDocuments(String(query), context), { runtime: 'client', available }),
        registry.registerTool(openPaneContextDefinition, ({ tabId }, context) =>
            openPaneContext(typeof tabId === 'string' ? tabId : undefined, context),
        { runtime: 'client', available }),
        ...documentChatDefinitions.map((definition) => registry.registerTool(
            definition,
            (args, context) => {
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
                    definition.function.name,
                    JSON.stringify(args),
                    context.requestId,
                );
                assertChatWorkspace(context);
                return result;
            },
            { runtime: 'client', available },
        )),
    ];
    return () => handles.forEach((handle) => handle.dispose());
}
