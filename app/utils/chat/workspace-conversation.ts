import type { Message, Thread } from '~/db/schema';
import { compareMessageOrder } from '~/db/messages';
import { isSupersededMessage } from './transcript';

export function visibleConversationRows(rows: readonly Message[]): Message[] {
    return rows.filter((row) => !row.deleted && !isSupersededMessage(row)
        && (row.role === 'user' || row.role === 'assistant')).sort(compareMessageOrder);
}

/** Explicit reference branches inherit exact anchor slices; unanchored legacy links do not. */
export function projectWorkspaceConversation(
    threadId: string, threads: ReadonlyMap<string, Thread>, messages: ReadonlyMap<string, readonly Message[]>,
): Message[] {
    const lineage: Thread[] = [];
    const visited = new Set<string>();
    let id: string | undefined = threadId;
    while (id) {
        if (visited.has(id)) throw new Error('Conversation lineage is cyclic.');
        visited.add(id);
        const thread = threads.get(id);
        if (!thread || thread.deleted) throw new Error('Conversation source is unavailable.');
        lineage.push(thread);
        id = thread.branch_mode === 'reference' ? thread.parent_thread_id ?? undefined : undefined;
    }
    let visible: Message[] = [];
    for (let index = lineage.length - 1; index >= 0; index -= 1) {
        const thread = lineage[index]!;
        if (index < lineage.length - 1) {
            const parentId = thread.parent_thread_id!;
            const anchor = messages.get(parentId)?.find((row) => row.id === thread.anchor_message_id && !row.deleted);
            if (!anchor) throw new Error('Conversation anchor is unavailable.');
            // Inherited rows precede parent-local rows; only the latter use this anchor's order.
            visible = visible.filter((row) => row.thread_id !== parentId || compareMessageOrder(row, anchor) <= 0);
        }
        visible.push(...visibleConversationRows(messages.get(thread.id) ?? []));
    }
    return visible;
}
