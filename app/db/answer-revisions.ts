import { compareMessageOrder } from './messages';
import { getWriteTxTableNames, nextClock, nowSec } from './util';
import { generateHLC } from '~/core/sync/hlc';
import { answerRevisionData, answerRevisionOf, rowsForUserTurn } from '~/utils/chat/answer-revisions';
import { isSupersededMessage } from '~/utils/chat/transcript';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';

/** Switch positions atomically with their tool results and the current prompt correction. */
export async function selectAnswerVersion(
    scope: WorkspaceOperationScope, threadId: string, currentId: string, targetId: string,
): Promise<boolean> {
    const { db } = scope;
    return db.transaction('rw', getWriteTxTableNames(db, 'messages', { include: ['threads', 'chat_request_recoveries'] }), async () => {
        scope.assertCurrent('write');
        const thread = await db.threads.get(threadId);
        if (!thread || thread.deleted || currentId === targetId) return false;
        const rows = (await db.messages.where('thread_id').equals(threadId).toArray()).filter(row => !row.deleted).sort(compareMessageOrder);
        const visible = rows.filter(row => !isSupersededMessage(row));
        const current = visible.find(row => row.id === currentId && row.role === 'user');
        const target = rows.find(row => row.id === targetId && row.role === 'user' && isSupersededMessage(row));
        const revision = answerRevisionOf(current);
        const targetRevision = answerRevisionOf(target);
        if (!current || !target || !revision || !targetRevision || targetRevision.groupId !== revision.groupId
            || visible.some(row => row.pending)) return false;

        const archived = rows.filter(row => {
            const membership = answerRevisionOf(row);
            return membership?.groupId === revision.groupId && membership.versionId === target.id;
        });
        const currentData = current.data as Record<string, unknown> | null;
        const updatedAt = nowSec();
        const stamp = (row: typeof current) => ({ ...row, clock: nextClock(row.clock), hlc: generateHLC(), updated_at: updatedAt });
        scope.assertCurrent('write');
        await db.messages.bulkPut([
            ...rowsForUserTurn(visible, current).map(row => ({ ...stamp(row),
                data: { ...row.data as object, ...answerRevisionData(revision.groupId, current.id), superseded_by: target.id } })),
            ...archived.map(row => {
                const { superseded_by: _archived, ...data } = row.data as Record<string, unknown>;
                if (row.id === target.id) {
                    data.content = currentData?.content;
                    if (currentData?.edit_id) data.edit_id = currentData.edit_id;
                    else delete data.edit_id;
                }
                return { ...stamp(row), data };
            }),
        ]);
        const recovery = await db.chat_request_recoveries.get(threadId);
        if (recovery?.user_message_id === current.id || recovery?.user_message_id === target.id) {
            await db.chat_request_recoveries.delete(threadId);
        }
        return true;
    });
}
