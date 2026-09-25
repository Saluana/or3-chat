import { getActiveWorkspaceId, getDb } from '~/db/client';
import { getDocument } from '~/db/documents';
import { useCommandPalette } from '~/composables/search/useCommandPalette';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import { DOCUMENT_AI_AGENT_TOOLS } from './document-ai-tools';
import { getActiveDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { getOpenWorkspaceTabs } from '~/core/search/command-palette/sources/workspace-tab-source';
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
        description: 'List the other open workspace tabs when called without tabId. With tabId, read bounded context from that tab. Visible document editors include live unsaved content and exact block refs; inactive documents and chats return read-only saved content. App tabs return metadata.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                tabId: { type: 'string', minLength: 1, maxLength: 200 },
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

async function openPaneContext(tabId: string | undefined, context: ToolExecutionContext): Promise<string> {
    assertChatWorkspace(context);
    const tabs = getOpenWorkspaceTabs();
    if (!tabId) {
        return JSON.stringify({
            tabs: tabs.slice(0, 50).map((tab) => ({
                tabId: tab.id,
                title: tab.cachedTitle || 'Untitled',
                kind: tab.resource.kind,
                ...(tab.resource.kind === 'document'
                    ? {
                        documentId: tab.resource.documentId,
                        editorOpen: Boolean(getActiveDocumentEditorSession(tab.resource.documentId, tab.id)),
                    }
                    : tab.resource.kind === 'chat'
                        ? { threadId: tab.resource.threadId }
                        : { appId: tab.resource.appId, recordId: tab.resource.recordId }),
            })),
            total: tabs.length,
        });
    }
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) throw new Error('That tab is no longer open. List tabs again.');
    const resource = tab.resource;
    const originDbName = getDb().name;
    let content: string;
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
    } else {
        content = '';
    }
    assertChatWorkspace(context);
    if (getDb().name !== originDbName) throw new Error('The workspace changed while reading this tab.');
    const current = getOpenWorkspaceTabs().find((entry) => entry.id === tabId);
    if (!current || JSON.stringify(current.resource) !== JSON.stringify(resource)) {
        throw new Error('That tab changed while its context was being read. List tabs again.');
    }
    return JSON.stringify({
        tabId,
        title: tab.cachedTitle || 'Untitled',
        ...resource,
        content: truncate(content),
        readOnly: true,
        editorOpen: resource.kind === 'document'
            && Boolean(getActiveDocumentEditorSession(resource.documentId, tab.id)),
    });
}

/** Register the document agent's native tools with chat, using the live editor for execution. */
export function registerDocumentChatTools(): () => void {
    const registry = useToolRegistry();
    const handles = [
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
