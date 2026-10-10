import { getActiveWorkspaceId, getDb, getWorkspaceGeneration } from '~/db/client';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import { DOCUMENT_AI_AGENT_TOOLS } from './document-ai-tool-definitions';

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


async function loadExecution(context: ToolExecutionContext) {
    assertChatWorkspace(context);
    const db = getDb(); const generation = getWorkspaceGeneration();
    const execution = await import('./document-chat-tool-execution');
    assertChatWorkspace(context);
    if (getDb() !== db || getWorkspaceGeneration() !== generation) {
        throw new Error('The workspace changed while loading document tools.');
    }
    return execution;
}

/** Definitions register immediately; execution loads within the authorized operation. */
export function registerDocumentChatTools(): () => void {
    const registry = useToolRegistry();
    const handles = [
        registry.registerTool(createDocumentDefinition, async ({ title, content }, context) =>
            (await loadExecution(context)).createChatDocument(
                typeof title === 'string' ? title : undefined,
                typeof content === 'string' ? content : undefined, context,
            ), { runtime: 'client', available }),
        registry.registerTool(duplicateDocumentDefinition, async ({ documentId, tabId, title }, context) =>
            (await loadExecution(context)).duplicateChatDocument(
                String(documentId), typeof tabId === 'string' ? tabId : undefined,
                typeof title === 'string' ? title : undefined, context,
            ), { runtime: 'client', available }),
        registry.registerTool(searchDocumentsDefinition, async ({ query }, context) =>
            (await loadExecution(context)).searchDocuments(String(query), context), { runtime: 'client', available }),
        registry.registerTool(openPaneContextDefinition, async ({ tabId }, context) =>
            (await loadExecution(context)).openPaneContext(typeof tabId === 'string' ? tabId : undefined, context),
            { runtime: 'client', available }),
        ...documentChatDefinitions.map(definition => registry.registerTool(definition,
            async (args, context) => (await loadExecution(context)).executeDocumentEditorTool(definition.function.name, args, context),
            { runtime: 'client', available },
        )),
    ];
    return () => handles.forEach(handle => handle.dispose());
}
