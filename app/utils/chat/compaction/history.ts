import { getDb, type Or3DB } from '~/db/client';
import type { Message, Thread } from '~/db/schema';
import { compareMessageOrder } from '~/db/messages';
import { withoutSupersededMessages } from '../transcript';
import { readCompactionData } from '~~/shared/chat/compaction';
import { resolveChatProject, projectSettingsId } from '~/db/project-workspace';
import { readProjectSettings } from '~~/shared/projects/workspace';

export class CompactionHistoryError extends Error {
    constructor(readonly code: 'scope_incomplete' | 'invalid_anchor' | 'cyclic_lineage' | 'summary_pending', message: string) {
        super(message); this.name = 'CompactionHistoryError';
    }
}
export interface ThreadProjectionSegment { thread: Thread; rows: Message[]; visible: Message[] }
export interface ThreadProjection { messages: Message[]; segments: ThreadProjectionSegment[] }

/** The original content may be gone, but the summary's own pair must be intact. */
export function assertCompactedSummary(thread: Thread, rows: readonly Message[]): Message {
    const summary = rows.find((row) => row.id === thread.summary_message_id);
    const data = summary?.data && typeof summary.data === 'object' && !Array.isArray(summary.data)
        ? summary.data as Record<string, unknown> : undefined;
    const metadata = readCompactionData(data?.compaction);
    if (!summary || summary.deleted || summary.pending || summary.thread_id !== thread.id || summary.role !== 'system'
        || data?.kind !== 'compaction' || !metadata || typeof data.content !== 'string' || !data.content.trim()
        || metadata.source_thread_id !== thread.parent_thread_id || metadata.anchor_message_id !== thread.anchor_message_id) {
        throw new CompactionHistoryError('summary_pending', 'This compacted conversation is waiting for its valid summary. Sync or reload before continuing.');
    }
    return summary;
}

/**
 * One read snapshot, iterative lineage, ID anchors and no arbitrary depth/conversation cutoff.
 * Request paths enforce project provenance; display reads (`projectProvenance: false`)
 * always render the chat's own transcript.
 */
export async function resolveThreadProjection(threadId: string, db: Or3DB = getDb(), throughMessageId?: string,
    options: { projectProvenance?: boolean } = {}): Promise<ThreadProjection> {
    const enforce = options.projectProvenance !== false;
    return db.transaction('r', ['threads', 'messages', 'projects', 'posts'], async () => {
        const source = await db.threads.get(threadId);
        if (!source || source.deleted) throw new CompactionHistoryError('scope_incomplete', 'Conversation source is unavailable.');
        const owner = enforce ? await resolveChatProject(db, threadId) : null;
        const settings = owner ? await db.posts.get(projectSettingsId(owner)) : undefined;
        const excluded = new Set(settings && !settings.deleted
            ? readProjectSettings(settings.content).excluded_chat_ids : []);
        const permitted = new Set<string>([threadId]);
        const assertPermitted = async (id: string) => {
            if (!enforce || permitted.has(id)) return;
            // Retained summaries survive source deletion, but never an owner
            // change or explicit exclusion. Tombstones retain their ownership.
            const provenanceOwner = await resolveChatProject(db, id, { includeDeleted: true }).catch(() => {
                throw new CompactionHistoryError('scope_incomplete', 'Conversation project provenance is unavailable.');
            });
            if (excluded.has(id) || provenanceOwner !== owner)
                throw new CompactionHistoryError('scope_incomplete', 'Conversation provenance is outside the permitted project. Move or copy its history explicitly before continuing.');
            permitted.add(id);
        };
        const assertSummaryProvenance = async (summary: Message) => {
            if (!enforce) return;
            const seen = new Set<string>();
            let current: Message | undefined = summary;
            while (current) {
                if (seen.has(current.id)) throw new CompactionHistoryError('cyclic_lineage', 'Summary provenance is cyclic.');
                seen.add(current.id);
                const data = current.data as Record<string, unknown> | undefined;
                const metadata = readCompactionData(data?.compaction);
                if (current.role !== 'system' || current.pending || data?.kind !== 'compaction' || !metadata)
                    throw new CompactionHistoryError('scope_incomplete', 'Summary provenance is unavailable.');
                const ids = new Set([current.thread_id, metadata.source_thread_id,
                    ...metadata.history_scope.segments.map(segment => segment.thread_id),
                    ...metadata.landmarks.map(landmark => landmark.thread_id)]);
                for (const provenanceId of ids) if (!permitted.has(provenanceId)) await assertPermitted(provenanceId);
                const inherited = metadata.history_scope.inherited_scope_message_id;
                if (!inherited) break;
                current = await db.messages.get(inherited);
                if (!current) throw new CompactionHistoryError('scope_incomplete', 'Inherited summary provenance is unavailable.');
            }
        };
        const visited = new Set<string>();
        const reverse: ThreadProjectionSegment[] = [];
        let id = threadId;
        let cutoff: Message | undefined;
        if (throughMessageId) {
            cutoff = await db.messages.get(throughMessageId);
            if (!cutoff || cutoff.deleted || cutoff.thread_id !== threadId) {
                throw new CompactionHistoryError('invalid_anchor', 'The selected conversation message is unavailable.');
            }
        }
        for (;;) {
            if (visited.has(id)) throw new CompactionHistoryError('cyclic_lineage', 'Conversation lineage is cyclic.');
            visited.add(id);
            const thread = await db.threads.get(id);
            if (!thread || thread.deleted) throw new CompactionHistoryError('scope_incomplete', 'Conversation source is unavailable.');
            if (!permitted.has(id)) await assertPermitted(id);
            const rows = (await db.messages.where('thread_id').equals(id).toArray()).sort(compareMessageOrder);
            if (cutoff && (!rows.some((row) => row.id === cutoff!.id && !row.deleted) || cutoff.thread_id !== id)) {
                throw new CompactionHistoryError('invalid_anchor', 'The reference anchor is unavailable.');
            }
            let visible = withoutSupersededMessages(rows.filter((row) => !row.deleted && (!cutoff || compareMessageOrder(row, cutoff) <= 0)));
            if (thread.branch_mode === 'compacted') {
                const summary = assertCompactedSummary(thread, rows);
                await assertSummaryProvenance(summary);
                visible = [summary, ...visible.filter((row) => row.id !== summary.id)];
            }
            reverse.push({ thread, rows, visible });
            if (thread.branch_mode !== 'reference') break;
            if (!thread.parent_thread_id || !thread.anchor_message_id) {
                throw new CompactionHistoryError('invalid_anchor', 'An explicit reference branch needs its source anchor.');
            }
            const anchor = await db.messages.get(thread.anchor_message_id);
            if (!anchor || anchor.deleted || anchor.thread_id !== thread.parent_thread_id) {
                throw new CompactionHistoryError('invalid_anchor', 'The reference anchor is unavailable.');
            }
            cutoff = anchor; id = thread.parent_thread_id;
        }
        const segments = reverse.reverse();
        return { segments, messages: segments.flatMap((segment) => segment.visible) };
    });
}

/** Derive roots through the real lineage, including ancestors predating denormalized fields. */
export async function resolveRootThreadId(threadId: string, db: Or3DB = getDb()): Promise<string> {
    const visited = new Set<string>();
    let id = threadId;
    for (;;) {
        if (visited.has(id)) throw new CompactionHistoryError('cyclic_lineage', 'Conversation lineage is cyclic.');
        visited.add(id);
        const thread = await db.threads.get(id);
        if (!thread) throw new CompactionHistoryError('scope_incomplete', 'Conversation lineage is incomplete.');
        if (!thread.parent_thread_id) return thread.id;
        id = thread.parent_thread_id;
    }
}
