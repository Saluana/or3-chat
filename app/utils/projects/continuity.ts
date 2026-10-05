import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { readCompactionData } from '~~/shared/chat/compaction';
import {
    readProjectWorkspace,
    resolveChatProject,
} from '~/db/project-workspace';

/** Reuse existing reviewed handoff artifacts; derive validity from live evidence, never a second summary index. */
export async function projectContinuity(
    scope: WorkspaceOperationScope,
    projectId: string,
) {
    const { settings } = await readProjectWorkspace(scope.db, projectId);
    const excluded = new Set(settings.excluded_chat_ids);
    const threads = (await scope.db.threads.toArray()).filter(
        (row) =>
            !row.deleted && row.summary_message_id && !excluded.has(row.id),
    );
    const summaries = [];
    for (const thread of threads) {
        if (
            (await resolveChatProject(scope.db, thread.id).catch(
                () => null,
            )) !== projectId
        )
            continue;
        const row = await scope.db.messages.get(thread.summary_message_id!);
        const data = readCompactionData(
            (row?.data as Record<string, unknown> | undefined)?.compaction,
        );
        if (!row || row.deleted || !data || excluded.has(data.source_thread_id))
            continue;
        let valid =
            row.thread_id === thread.id &&
            row.role === 'system' &&
            !row.pending;
        const visited = new Set<string>();
        let current = data;
        for (;;) {
            if (
                excluded.has(current.source_thread_id) ||
                (await resolveChatProject(
                    scope.db,
                    current.source_thread_id,
                ).catch(() => null)) !== projectId
            ) {
                valid = false;
                break;
            }
            for (const segment of current.history_scope.segments) {
                if (
                    excluded.has(segment.thread_id) ||
                    (await resolveChatProject(
                        scope.db,
                        segment.thread_id,
                    ).catch(() => null)) !== projectId
                ) {
                    valid = false;
                    break;
                }
                for (const evidence of segment.messages) {
                    const message = await scope.db.messages.get(
                        evidence.message_id,
                    );
                    if (
                        !message ||
                        message.deleted ||
                        message.thread_id !== segment.thread_id ||
                        message.clock !== evidence.clock
                    ) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) break;
            }
            if (!valid || !current.history_scope.inherited_scope_message_id)
                break;
            const inheritedId =
                current.history_scope.inherited_scope_message_id;
            if (visited.has(inheritedId)) {
                valid = false;
                break;
            }
            visited.add(inheritedId);
            const inherited = await scope.db.messages.get(inheritedId);
            const metadata = readCompactionData(
                (inherited?.data as Record<string, unknown> | undefined)
                    ?.compaction,
            );
            if (
                !inherited ||
                inherited.deleted ||
                inherited.pending ||
                !metadata ||
                excluded.has(inherited.thread_id) ||
                (await resolveChatProject(scope.db, inherited.thread_id).catch(
                    () => null,
                )) !== projectId
            ) {
                valid = false;
                break;
            }
            current = metadata;
        }
        if (valid) summaries.push({ thread, row, data });
    }
    scope.assertCurrent();
    return summaries.sort((a, b) => b.data.generated_at - a.data.generated_at);
}
