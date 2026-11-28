import type { Message, Thread } from '~/db/schema';
import { compareMessageOrder } from '~/db/messages';
import { selectedAnswerVersionRows } from './answer-revisions';

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
    const visible: Message[] = [];
    for (let index = lineage.length - 1; index >= 0; index -= 1) {
        const thread = lineage[index]!;
        const rows = [...(messages.get(thread.id) ?? [])].sort(compareMessageOrder);
        const child = lineage[index - 1];
        const anchor = child && rows.find(row => row.id === child.anchor_message_id && !row.deleted);
        if (child && !anchor) throw new Error('Conversation anchor is unavailable.');
        visible.push(...selectedAnswerVersionRows(rows, anchor).filter(row => row.role === 'user' || row.role === 'assistant'));
    }
    return visible;
}
