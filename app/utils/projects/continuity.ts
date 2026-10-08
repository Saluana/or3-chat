import { normalizeProjectData } from '~/utils/projects/normalizeProjectData';
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
    selection?: {
        state: Awaited<ReturnType<typeof readProjectWorkspace>>;
        terms: readonly string[];
        threadId: string;
        limit: number;
    },
) {
    scope.assertCurrent();
    if (selection && !selection.terms.length) return [];
    const state =
        selection?.state ?? (await readProjectWorkspace(scope.db, projectId));
    const { settings } = state;
    const excluded = new Set(settings.excluded_chat_ids);
    const owned = await scope.db.threads
        .where('project_id')
        .equals(projectId)
        .toArray();
    const legacyIds = normalizeProjectData(state.project.data)
        .filter((entry) => entry.kind === 'chat')
        .map((entry) => entry.id);
    const legacy = (await scope.db.threads.bulkGet(legacyIds)).filter(
        (row): row is NonNullable<typeof row> =>
            Boolean(row && !row.project_id),
    );
    const threads = [...owned, ...legacy]
        .filter(
            (row) =>
                !row.deleted &&
                row.summary_message_id &&
                !excluded.has(row.id) &&
                row.id !== selection?.threadId,
        );
    const candidates = [];
    for (const thread of threads) {
        scope.assertCurrent();
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
        // Discover relevance from small summaries before validating their often
        // large source history. Only selected candidates pay that cost.
        const searchable = (thread.title + ' ' + data.summary_markdown).toLowerCase();
        const score = selection?.terms.filter(term => searchable.includes(term)).length ?? 0;
        if (selection && !score) continue;
        candidates.push({ thread, row, data, score });
    }
    if (selection) candidates.sort((a, b) => b.score - a.score
        || b.thread.updated_at - a.thread.updated_at || a.thread.id.localeCompare(b.thread.id));
    const summaries = [];
    // Result count alone does not bound invalid candidates or inherited evidence.
    const attemptLimit = selection ? Math.min(24, Math.max(1, selection.limit) * 4) : 100;
    let attempts = 0;
    let evidenceBudget = selection ? 1000 : 10000;
    for (const { thread, row, data } of candidates) {
        scope.assertCurrent();
        if (selection && summaries.length >= selection.limit) break;
        if (attempts++ >= attemptLimit || evidenceBudget <= 0) break;
        if (await resolveChatProject(scope.db, thread.id).catch(() => null) !== projectId) continue;
        let valid =
            row.thread_id === thread.id &&
            row.role === 'system' &&
            !row.pending;
        const visited = new Set<string>();
        let current = data;
        for (;;) {
            scope.assertCurrent();
            if (evidenceBudget-- <= 0) { valid = false; break; }
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
                if (evidenceBudget-- <= 0) { valid = false; break; }
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
                    scope.assertCurrent();
                    if (evidenceBudget-- <= 0) { valid = false; break; }
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
            if (evidenceBudget-- <= 0) { valid = false; break; }
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
    return selection ? summaries : summaries.sort((a, b) => b.data.generated_at - a.data.generated_at);
}
