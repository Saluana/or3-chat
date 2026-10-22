import type { Or3DB } from '~/db/client';
import type { Message, Thread } from '~/db/schema';
import { normalizeMessageContent } from '../normalize';
import { projectWorkspaceConversation } from '~/utils/chat/workspace-conversation';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteLoadContext,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';
import { chatActions } from './actions';

function category() {
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'chat')!;
}

export function createChatPaletteSource(): PaletteSearchSource {
    return {
        id: 'chat',
        label: 'Chats',
        category: category(),
        order: 20,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const threads = (await db.threads.toArray()).filter(
                (t) => !t.deleted
            );
            context.signal?.throwIfAborted();
            const messages = (await db.messages.toArray()).filter(
                (m) => !m.deleted
            );
            context.signal?.throwIfAborted();
            return buildChatResources(threads, messages, context);
        },
        async loadRecords(context, recordIds) {
            const db = await context.getDb() as Or3DB;
            const affected = new Set(recordIds);
            let frontier = [...affected];
            // Reference descendants inherit edited ancestor text. Compacted and
            // legacy branches do not inherit that text and need no refresh.
            while (frontier.length) {
                context.signal?.throwIfAborted();
                const children = await db.threads.where('parent_thread_id').anyOf(frontier).toArray();
                frontier = [];
                for (const child of children) {
                    if (child.branch_mode !== 'reference' || child.deleted || affected.has(child.id)) continue;
                    affected.add(child.id);
                    frontier.push(child.id);
                }
            }
            const threads = new Map<string, Thread>();
            const visited = new Set<string>();
            frontier = [...affected];
            while (frontier.length) {
                context.signal?.throwIfAborted();
                const rows = await db.threads.bulkGet(frontier);
                frontier.forEach(id => visited.add(id));
                const parents = new Set<string>();
                for (const thread of rows) {
                    if (!thread) continue;
                    threads.set(thread.id, thread);
                    if (!thread.deleted && thread.branch_mode === 'reference' && thread.parent_thread_id
                        && !visited.has(thread.parent_thread_id)) parents.add(thread.parent_thread_id);
                }
                frontier = [...parents];
            }
            context.signal?.throwIfAborted();
            const ids = [...threads.keys()];
            const messages = ids.length
                ? await db.messages.where('thread_id').anyOf(ids).filter(message => !message.deleted).toArray()
                : [];
            context.signal?.throwIfAborted();
            return {
                resources: buildChatResources([...threads.values()], messages, context, affected),
                removedKeys: [...affected].filter(id => !threads.has(id) || threads.get(id)!.deleted).map(id => `chat:${id}`),
            };
        },
    };
}

export function buildChatResources(
    threads: readonly Thread[],
    messages: readonly Message[],
    context: PaletteLoadContext,
    resourceIds?: ReadonlySet<string>,
): PaletteResource[] {
    const byThread = new Map<string, Message[]>();
    for (const message of messages) {
        context.signal?.throwIfAborted();
        if (!message.thread_id) continue;
        const list = byThread.get(message.thread_id) ?? [];
        list.push(message);
        byThread.set(message.thread_id, list);
    }

    const resources: PaletteResource[] = [];
    const threadMap = new Map(threads.map((thread) => [thread.id, thread]));
    for (const thread of threads) {
        context.signal?.throwIfAborted();
        if (thread.deleted || resourceIds && !resourceIds.has(thread.id)) continue;
        let threadMessages: Message[];
        let incomplete = false;
        try { threadMessages = projectWorkspaceConversation(thread.id, threadMap, byThread); }
        catch { threadMessages = []; incomplete = true; }
        const body = threadMessages
            .map((message) => normalizeMessageContent(message))
            .filter(Boolean)
            .join('\n');
        const actions = chatActions(thread.id, context);
        resources.push({
            key: `chat:${thread.id}`,
            sourceId: 'chat',
            categoryId: 'chat',
            recordId: thread.id,
            title: thread.title?.trim() || 'Untitled chat',
            content: body,
            updatedAt: thread.updated_at,
            revision: `${thread.updated_at}:${threadMessages.length}:${body.length}`,
            icon: 'i-lucide-message-square',
            primaryAction: actions.primary,
            secondaryActions: actions.secondary,
            metadata: {
                messageCount: threadMessages.length,
                incomplete,
            },
        });
    }
    return resources;
}
