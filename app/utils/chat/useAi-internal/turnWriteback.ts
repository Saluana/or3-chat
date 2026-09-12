/**
 * @module app/utils/chat/useAi-internal/turnWriteback
 *
 * Purpose:
 * Reconciles a just-finished assistant turn from IndexedDB back into the
 * canonical in-memory history (`rawMessages`).
 *
 * Behavior:
 * Reloads the assistant row plus its tool-result rows from the captured
 * workspace database, converts them through the canonical transcript
 * projection, then replaces the turn in place: the (possibly empty)
 * placeholder is swapped for the finished assistant and missing tool rows
 * are inserted in index order right after it.
 *
 * Constraints:
 * - Read-only against the database; never writes.
 * - No-op when the assistant row is absent or the view moved to another
 *   thread while the read was in flight.
 *
 * Non-Goals:
 * - Does not touch UI projections (`messages`, `tailAssistant`); callers own
 *   those refs.
 */

import Dexie from 'dexie';
import type { Ref } from 'vue';
import type { Or3DB } from '~/db/client';
import { compareMessageOrder } from '~/db/messages';
import type { ChatMessage } from '~/utils/chat/types';
import {
    projectTranscriptForOpenRouter,
    storedMessagesToCanonicalTranscript,
} from '~/utils/chat/transcript';
import type { StoredMessage } from './types';

type StoredRow = StoredMessage & { thread_id: string };

function toolRowsForAssistant(
    rows: StoredRow[],
    assistantId: string
): StoredRow[] {
    return rows.filter((row) => {
        if (row.role !== 'tool') return false;
        const data =
            row.data && typeof row.data === 'object'
                ? (row.data as Record<string, unknown>)
                : null;
        return data?.parent_assistant_id === assistantId;
    });
}

/**
 * `reloadTurnIntoRawMessages`
 *
 * Purpose:
 * Replaces a completed turn in `rawMessages` with its durable rows so the
 * next model request keeps the previous answer and tool context.
 */
export async function reloadTurnIntoRawMessages(
    db: Or3DB,
    threadId: string,
    assistantId: string,
    rawMessages: Ref<ChatMessage[]>,
    threadIdRef?: { value: string | undefined }
): Promise<void> {
    const all = (await db.messages
        .where('[thread_id+index]')
        .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
        .filter((message) => !message.deleted)
        .toArray()) as StoredRow[];
    all.sort(compareMessageOrder);
    const assistantRow = all.find((row) => row.id === assistantId);
    if (!assistantRow || assistantRow.thread_id !== threadId) return;
    if (threadIdRef && threadIdRef.value !== threadId) return;

    const turnRows = [
        assistantRow,
        ...toolRowsForAssistant(all, assistantId),
    ].sort(compareMessageOrder);
    const projected = projectTranscriptForOpenRouter(
        storedMessagesToCanonicalTranscript(turnRows as StoredMessage[])
    );
    const [finishedAssistant, ...toolMessages] = projected;
    if (!finishedAssistant) return;

    const next = [...rawMessages.value];
    const assistantIdx = next.findIndex((message) => message.id === assistantId);
    if (assistantIdx >= 0) {
        next.splice(assistantIdx, 1, finishedAssistant);
    } else {
        next.push(finishedAssistant);
    }
    let insertAt =
        next.findIndex((message) => message.id === assistantId) + 1;
    for (const toolMessage of toolMessages) {
        const existingIdx = next.findIndex(
            (message) => message.id === toolMessage.id
        );
        if (existingIdx >= 0) {
            next.splice(existingIdx, 1, toolMessage);
            if (existingIdx < insertAt) insertAt -= 1;
            continue;
        }
        next.splice(insertAt, 0, toolMessage);
        insertAt += 1;
    }
    rawMessages.value = next;
}
