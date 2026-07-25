import type { Or3DB } from '~/db/client';
import type { Message, Thread } from '~/db/schema';
import { normalizeMessageContent } from '../normalize';
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
    };
}

export function buildChatResources(
    threads: readonly Thread[],
    messages: readonly Message[],
    context: PaletteLoadContext
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
    for (const thread of threads) {
        context.signal?.throwIfAborted();
        const threadMessages = byThread.get(thread.id) ?? [];
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
            },
        });
    }
    return resources;
}
