import {
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    type Or3DB,
} from '~/db/client';
import { useCommandPalette } from '~/composables/search/useCommandPalette';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import { appendMessageRows, prepareMessageAppend, messagesByThread } from '~/db/messages';
import { getThread } from '~/db/threads';
import { normalizeMessageContent } from '~/core/search/command-palette/normalize';

const MAX_SEARCH_RESULTS = 10;
const MAX_READ_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TRANSCRIPT_CHARS = 18_000;
const MAX_SEND_CHARS = 20_000;

const READABLE_ROLES = new Set(['user', 'assistant']);

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

function assertWriteOrigin(context: ToolExecutionContext, db: Or3DB, generation: number): void {
    assertChatWorkspace(context);
    if (getDb() !== db || getWorkspaceGeneration() !== generation) {
        throw new Error('The workspace changed before the message could be sent.');
    }
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

const searchThreadsDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'search_threads',
        description: 'Search other chat threads in the current workspace by title or message text. Returns thread IDs, titles, and matching snippets. Use a threadId with read_thread or send_message_to_thread. The current chat is excluded from results.',
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
        label: 'Find chats',
        descriptionHint: 'Search other chat threads by title or message text.',
        category: 'Chat',
        icon: 'i-lucide-message-square-text',
        defaultEnabled: true,
    },
    runtime: 'client',
};

const readThreadDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'read_thread',
        description: 'Read the recent messages of another chat thread in the current workspace. Supply a threadId from search_threads. Returns up to the most recent messages with their roles and text. Content is read-only.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['threadId'],
            properties: {
                threadId: { type: 'string', minLength: 1, maxLength: 200 },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_READ_MESSAGES,
                    description: `Optional cap on how many of the most recent messages to return (default ${MAX_READ_MESSAGES}).`,
                },
            },
        },
    },
    ui: {
        label: 'Read a chat',
        descriptionHint: 'Let chat read the messages of another thread.',
        category: 'Chat',
        icon: 'i-lucide-messages-square',
        defaultEnabled: true,
    },
    runtime: 'client',
};

const sendMessageToThreadDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'send_message_to_thread',
        description: 'Append a message to another chat thread in the current workspace. Supply a threadId from search_threads and the message content. By default the message is added as a user turn (so the thread can be continued by the model when reopened); pass role "assistant" to leave an assistant note instead. This does not generate a reply and cannot target the current chat.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['threadId', 'content'],
            properties: {
                threadId: { type: 'string', minLength: 1, maxLength: 200 },
                content: { type: 'string', minLength: 1, maxLength: MAX_SEND_CHARS },
                role: {
                    type: 'string',
                    enum: ['user', 'assistant'],
                    description: 'Role to record the message under. Defaults to "user".',
                },
            },
        },
    },
    ui: {
        label: 'Message another chat',
        descriptionHint: 'Let chat post a message into another thread.',
        category: 'Chat',
        icon: 'i-lucide-send',
        defaultEnabled: true,
    },
    runtime: 'client',
};

async function searchThreads(query: string, context: ToolExecutionContext): Promise<string> {
    assertChatWorkspace(context);
    const normalized = query.trim();
    if (!normalized) throw new Error('Enter a chat search term.');
    const originDbName = getDb().name;
    const palette = useCommandPalette();
    if (!palette.getCoordinator()) await palette.warm();
    const coordinator = palette.getCoordinator();
    if (!coordinator) throw new Error('Chat search is unavailable right now.');
    const results = await coordinator.searchSource('chat', normalized, MAX_SEARCH_RESULTS + 1);
    assertChatWorkspace(context);
    if (getDb().name !== originDbName) throw new Error('The workspace changed during chat search.');
    return JSON.stringify({
        query,
        results: results
            .filter((item) => item.recordId !== context.threadId)
            .slice(0, MAX_SEARCH_RESULTS)
            .map((item) => ({
                threadId: item.recordId,
                title: item.title,
                snippet: item.snippet ?? '',
                messageCount: item.metadata.messageCount ?? undefined,
            })),
    });
}

async function readThread(
    threadId: string,
    limit: number | undefined,
    context: ToolExecutionContext,
): Promise<string> {
    assertChatWorkspace(context);
    const originDbName = getDb().name;
    const thread = await getThread(threadId);
    if (!thread || thread.deleted) throw new Error('That chat is no longer available.');
    const db = getDb();
    if (db.name !== originDbName) throw new Error('The workspace changed while reading this chat.');
    const cap = Math.min(Math.max(1, limit ?? MAX_READ_MESSAGES), MAX_READ_MESSAGES);
    const rows = (await messagesByThread(threadId, db)) as
        Array<{ role: string; content?: unknown; data?: unknown; deleted?: boolean }> | undefined;
    assertChatWorkspace(context);
    if (getDb().name !== originDbName) throw new Error('The workspace changed while reading this chat.');
    const visible = (rows ?? [])
        .filter((message) => !message.deleted && READABLE_ROLES.has(message.role));
    const recent = visible.slice(-cap);
    let used = 0;
    const messages: Array<{ role: string; content: string }> = [];
    for (const message of [...recent].reverse()) {
        const text = normalizeMessageContent(message).trim();
        if (!text) continue;
        const clipped = truncate(text, MAX_MESSAGE_CHARS);
        if (used + clipped.length > MAX_TRANSCRIPT_CHARS) break;
        used += clipped.length;
        messages.push({ role: message.role, content: clipped });
    }
    messages.reverse();
    return JSON.stringify({
        threadId,
        title: thread.title?.trim() || 'Untitled chat',
        totalMessages: visible.length,
        returnedMessages: messages.length,
        messages,
    });
}

async function sendMessageToThread(
    threadId: string,
    content: string,
    role: string | undefined,
    context: ToolExecutionContext
): Promise<string> {
    assertChatWorkspace(context);
    if (threadId === context.threadId) {
        throw new Error(
            'Cannot send a message to the current chat. Choose a different thread.'
        );
    }
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Enter the message content to send.');
    const messageRole = role === 'assistant' ? 'assistant' : 'user';
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const thread = await getThread(threadId);
    if (!thread || thread.deleted)
        throw new Error('That chat is no longer available.');
    assertWriteOrigin(context, db, generation);
    const { captureWorkspaceOperation } = await import('./workspace-access');
    const { assertProjectToolAllowed } =
        await import('~/utils/projects/context');
    const { getWriteTxTableNames } = await import('~/db/util');
    const scope = captureWorkspaceOperation(context);
    const prepared = await prepareMessageAppend({ thread_id: threadId, role: messageRole,
        data: { content: trimmed, attachments: [] } });
    if (prepared.value.thread_id !== threadId || prepared.value.role !== messageRole
        || JSON.stringify(prepared.value.data) !== JSON.stringify({ content: trimmed, attachments: [] }))
        throw new Error('The approved message changed during preparation.');
    const message = await db.transaction(
        'rw',
        getWriteTxTableNames(db, [
            'threads',
            'messages',
            'projects',
            'posts',
            'file_meta',
        ]),
        async () => {
            scope.assertCurrent('write');
            await context.assertToolAuthorized?.();
            await assertProjectToolAllowed(
                scope,
                context.threadId!,
                'send_message_to_thread',
                { threadId, content: trimmed, role: messageRole },
                async () => true,
                context.projectId
            );
            const current = await db.threads.get(threadId);
            if (!current || current.deleted)
                throw new Error('That chat is no longer available.');
            const message = await appendMessageRows(db, prepared.value);
            scope.assertCurrent('write');
            return message;
        }
    );
    await prepared.afterCommit(message);
    return JSON.stringify({
        threadId,
        messageId: message.id,
        role: messageRole,
        title: thread.title?.trim() || 'Untitled chat',
    });
}

/** Register cross-thread search, read, and send tools with chat. */
export function registerThreadChatTools(): () => void {
    const registry = useToolRegistry();
    const handles = [
        registry.registerTool(searchThreadsDefinition, ({ query }, context) =>
            searchThreads(String(query), context), { runtime: 'client', available }),
        registry.registerTool(readThreadDefinition, ({ threadId, limit }, context) =>
            readThread(
                String(threadId),
                typeof limit === 'number' ? limit : undefined,
                context,
            ), { runtime: 'client', available }),
        registry.registerTool(sendMessageToThreadDefinition, ({ threadId, content, role }, context) =>
            sendMessageToThread(
                String(threadId),
                String(content),
                typeof role === 'string' ? role : undefined,
                context,
            ), { runtime: 'client', available }),
    ];
    return () => handles.forEach((handle) => handle.dispose());
}
