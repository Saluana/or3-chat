import { z } from 'zod';
import { getKvRecordByName, setKvByName } from './kv';
import { getTextFromContent } from '../utils/chat/messages';
import { getDb, getWorkspaceGeneration, type Or3DB } from './client';
import { MessageSchema, ThreadSchema, type Message, type Thread } from './schema';
import { compareMessageOrder } from './messages';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import { generateHLC } from '../core/sync/hlc';
import { useHooks } from '../core/hooks/useHooks';
import { resolveThreadProjection, type ThreadProjection } from '../utils/chat/compaction/history';
import { storedMessagesToCanonicalTranscript, type CanonicalTranscriptRecord } from '../utils/chat/transcript';
import { CompactionDataSchema, readCompactionData, type CompactionData, type HistoryScope } from '~~/shared/chat/compaction';
import { MAX_SYNC_PAYLOAD_BYTES } from '~~/shared/sync/sanitize';
import { ProjectContextReceiptSchema, type ProjectContextReceipt } from '~~/shared/projects/workspace';
import { resolveChatProject } from './project-workspace';
import { preservedProjectEntries, projectEntryIdentity } from '~/utils/projects/normalizeProjectData';

export class CompactionError extends Error {
    constructor(readonly code: 'stale_source' | 'cancelled' | 'source_busy' | 'not_eligible' | 'scope_incomplete'
        | 'invalid_summary' | 'summary_too_large' | 'not_beneficial' | 'invalid_capture' | 'summary_input_too_large' | 'model_metadata_unavailable', message: string) {
        super(message); this.name = 'CompactionError';
    }
}
export interface CompactionCapture {
    readonly operationId: string;
    readonly childThreadId: string;
    readonly summaryMessageId: string;
    readonly sourceThreadId: string;
    readonly anchorMessageId: string;
    readonly model: string;
    readonly messages: readonly CanonicalTranscriptRecord[];
    readonly historyScope: HistoryScope;
}
export interface ValidatedCompactionSummary { readonly summaryMarkdown: string; readonly content: string; readonly discardedLandmarks: number }
interface CapturedState {
    db: Or3DB; generation: number; options: CaptureOptions; snapshot: string; root: string;
    source: Thread; anchor: Message; scope: HistoryScope; rows: Map<string, Message>; messages: CanonicalTranscriptRecord[];
    messageCount: number; priorMessageCount: number;
}
interface CaptureOptions {
    sourceThreadId: string; anchorMessageId: string; model: string; db?: Or3DB;
    /** Captured pane/model/authorization identity; synchronous host check, never model-authored. */
    isCurrent?: () => boolean;
    signal?: AbortSignal;
}
const captures = new WeakMap<CompactionCapture, CapturedState>();
const summaries = new WeakMap<ValidatedCompactionSummary, { capture: CompactionCapture; data: CompactionData; content: string; projectReceipt?: ProjectContextReceipt }>();
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
}
function requireCurrent(state: Pick<CapturedState, 'db' | 'generation' | 'options'>, signal = state.options.signal): void {
    if (signal?.aborted || state.options.signal?.aborted) throw new CompactionError('cancelled', 'Compaction was cancelled.');
    if (getDb() !== state.db || getWorkspaceGeneration() !== state.generation || state.options.isCurrent?.() === false) {
        throw new CompactionError('stale_source', 'Workspace, model or source selection changed.');
    }
}
function stable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}

async function readCapture(options: CaptureOptions, db: Or3DB): Promise<Omit<CapturedState, 'db' | 'generation' | 'options'>> {
    const projection: ThreadProjection = await resolveThreadProjection(options.sourceThreadId, db);
    const sourceSegment = projection.segments.at(-1)!;
    const source = sourceSegment.thread;
    const anchor = sourceSegment.rows.find((row) => row.id === options.anchorMessageId && !row.deleted);
    if (!anchor || !sourceSegment.visible.some((row) => row.id === anchor.id)) {
        throw new CompactionError('not_eligible', 'Choose a persisted, visible message owned by this conversation.');
    }
    const messages = eligibleSourceMessages(projection, anchor);
    const ancestry: Thread[] = [];
    const inheritedScopes: Message[] = [];
    const path = new Set<string>(); let pathId: string | null | undefined = source.id;
    while (pathId) {
        if (path.has(pathId)) throw new CompactionError('scope_incomplete', 'Conversation lineage is cyclic.');
        path.add(pathId); const row: Thread | undefined = await db.threads.get(pathId);
        if (!row) throw new CompactionError('scope_incomplete', 'Conversation lineage is incomplete.');
        ancestry.push(row); pathId = row.parent_thread_id;
    }
    const rows = new Map<string, Message>();
    const priorIds = new Set<string>(); let priorMessageCount = 0;
    const segments: HistoryScope['segments'] = [];
    const snapshotSegments: unknown[] = [];
    let inherited: string | undefined;
    for (let index = 0; index < projection.segments.length; index += 1) {
        const segment = projection.segments[index]!;
        const child = projection.segments[index + 1];
        const cutoff = segment === sourceSegment ? anchor : child?.thread.anchor_message_id
            ? segment.rows.find((row) => row.id === child.thread.anchor_message_id) : undefined;
        const captured = segment.rows.filter((row) => !row.deleted && (!cutoff || compareMessageOrder(row, cutoff) <= 0));
        const summary = captured.find((row) => readCompactionData((row.data as Record<string, unknown> | null)?.compaction));
        if (summary) {
            if (inherited) throw new CompactionError('scope_incomplete', 'More than one prior summary boundary is ambiguous.');
            inherited = summary.id;
            const visitedScopes = new Set<string>(); let scopeRow: Message = summary;
            for (;;) {
                if (visitedScopes.has(scopeRow.id)) throw new CompactionError('scope_incomplete', 'Inherited history scope is cyclic.');
                visitedScopes.add(scopeRow.id); inheritedScopes.push(scopeRow);
                const metadata = readCompactionData((scopeRow.data as Record<string, unknown> | null)?.compaction);
                if (!metadata || !path.has(metadata.source_thread_id) || !path.has(scopeRow.thread_id)) {
                    throw new CompactionError('scope_incomplete', 'Prior summary scope is outside this conversation lineage.');
                }
                if (scopeRow === summary) priorMessageCount = metadata.message_count + metadata.prior_message_count;
                for (const part of metadata.history_scope.segments) {
                    if (!path.has(part.thread_id)) throw new CompactionError('scope_incomplete', 'Prior summary refers to an unrelated conversation.');
                    for (const ref of part.messages) {
                        priorIds.add(ref.message_id);
                        const row = await db.messages.get(ref.message_id);
                        if (row && row.thread_id !== part.thread_id) throw new CompactionError('scope_incomplete', 'Prior summary message ownership is invalid.');
                        if (row && !row.deleted) rows.set(row.id, row);
                    }
                }
                const priorId = metadata.history_scope.inherited_scope_message_id;
                if (!priorId) break;
                const prior = await db.messages.get(priorId);
                if (!prior || prior.deleted) throw new CompactionError('scope_incomplete', 'Prior summary scope is unavailable.');
                scopeRow = prior;
            }
        }
        const newlyCovered = captured.filter((row) => row.id !== summary?.id);
        for (const row of newlyCovered) rows.set(row.id, row);
        if (newlyCovered.length) segments.push({ thread_id: segment.thread.id, messages: newlyCovered.map((row) => ({ message_id: row.id, clock: row.clock })) });
        snapshotSegments.push({ thread: segment.thread, rows: captured });
    }
    const scope: HistoryScope = { version: 1, segments, ...(inherited ? { inherited_scope_message_id: inherited } : {}) };
    const root = ancestry.at(-1)!.id;
    // Coverage counts describe original visible messages, never generated
    // summary rows or a second copy of the inherited original IDs.
    const messageCount = new Set(messages.filter((row) => !row.compaction && !priorIds.has(row.id)).map((row) => row.id)).size;
    return { root, source, anchor, scope, rows, messages, messageCount, priorMessageCount,
        snapshot: stable({ root, ancestry, inheritedScopes, segments: snapshotSegments, inheritedRows: [...rows.values()], model: options.model }) };
}

/** Shared canonical checks for capture and lazy history-menu inspection. */
function eligibleSourceMessages(projection: ThreadProjection, anchor: Message): CanonicalTranscriptRecord[] {
    const sourceSegment = projection.segments.at(-1)!;
    const source = sourceSegment.thread;
    if (source.status !== 'ready' || sourceSegment.rows.some((row) => row.pending)) {
        throw new CompactionError('source_busy', 'Wait for pending generation to settle before compacting.');
    }
    const sourceTranscript = storedMessagesToCanonicalTranscript(sourceSegment.visible);
    if (sourceTranscript.some((row) => row.toolCalls.some((call) => call.status !== 'complete' && call.status !== 'error'))) {
        throw new CompactionError('source_busy', 'Wait for pending tools in the source conversation to settle.');
    }
    const selected = projection.segments.flatMap((segment) => segment === sourceSegment
        ? segment.visible.filter((row) => compareMessageOrder(row, anchor) <= 0) : segment.visible);
    const messages = storedMessagesToCanonicalTranscript(selected);
    if (messages.some((row) => row.pending || row.generation && ['pending', 'streaming', 'detached'].includes(row.generation.state)
        || row.toolCalls.some((call) => call.status !== 'complete' && call.status !== 'error'))) {
        throw new CompactionError('source_busy', 'Wait for pending generation and unresolved tools to settle.');
    }
    let turns = 0; let userPending = false;
    for (const row of messages) {
        if (row.role === 'user') userPending = true;
        if (row.role === 'assistant' && getTextFromContent(row.content).trim() && userPending) { turns += 1; userPending = false; }
    }
    if (turns < 2) throw new CompactionError('not_eligible', 'Compaction requires at least two settled user/assistant turns.');
    return messages;
}

/** Read-only menu inspection, without a selected model, operation IDs or writes. */
export async function inspectCompactionSource(sourceThreadId: string): Promise<void> {
    await inspectCompactionRevision(sourceThreadId, false);
}
async function inspectCompactionRevision(sourceThreadId: string, captureRevision = true): Promise<string> {
    const db = getDb(); const generation = getWorkspaceGeneration();
    const revision = await db.transaction('r', ['threads', 'messages', 'projects', 'posts'], async () => {
        const projection = await resolveThreadProjection(sourceThreadId, db);
        const anchor = projection.segments.at(-1)?.visible.at(-1);
        if (!anchor) throw new CompactionError('not_eligible', 'This conversation has no local persisted anchor.');
        eligibleSourceMessages(projection, anchor);
        return captureRevision ? stable(projection.segments.map(segment => ({ thread: segment.thread, rows: segment.rows }))) : '';
    });
    if (getDb() !== db || getWorkspaceGeneration() !== generation)
        throw new CompactionError('stale_source', 'Workspace changed while checking this conversation.');
    if (!captureRevision) return '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(revision));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Durable CAS claim before paid work; one bounded record per workspace conversation. */
export async function claimAutomaticCompaction(sourceThreadId: string, isCurrent: () => boolean): Promise<boolean> {
    const db = getDb(); const generation = getWorkspaceGeneration();
    const valid = () => getDb() === db && getWorkspaceGeneration() === generation && isCurrent();
    const revision = await inspectCompactionRevision(sourceThreadId);
    if (!valid()) return false;
    const name = 'compaction:auto-attempt:' + encodeURIComponent(sourceThreadId);
    const saved = await getKvRecordByName(name, db);
    if (saved.row && !saved.row.deleted && saved.row.value === revision) return false;
    try {
        await setKvByName(name, revision, db, { ifClock: saved.revision, isValid: valid });
        return valid();
    } catch (error) {
        // A competing tab or a revoked workspace must never start paid work.
        if (!valid() || (error as { rpcCode?: string }).rpcCode === 'conflict') return false;
        throw error;
    }
}

/** Checks the host-owned operation identity before any auxiliary request is spent. */
export function assertCompactionCaptureCurrent(capture: CompactionCapture): void {
    const state = captures.get(capture);
    if (!state) throw new CompactionError('invalid_capture', 'Use a valid captured compaction operation.');
    requireCurrent(state);
}

/** Bind request lifetime to the captured operation without exposing its private state. */
export function subscribeCompactionCancellation(capture: CompactionCapture, onAbort: () => void): () => void {
    const state = captures.get(capture);
    if (!state) throw new CompactionError('invalid_capture', 'Use a valid captured compaction operation.');
    const signal = state.options.signal;
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return () => signal?.removeEventListener('abort', onAbort);
}

/** Captures IDs and clocks; inference happens after the read transaction has ended. */
export async function captureCompaction(options: CaptureOptions): Promise<CompactionCapture> {
    const db = options.db ?? getDb(); const generation = getWorkspaceGeneration();
    const ownership = { db, generation, options: { ...options } }; requireCurrent(ownership);
    if (!options.model.trim()) throw new CompactionError('invalid_capture', 'Compaction requires its captured chat model.');
    const state = await db.transaction('r', ['threads', 'messages', 'projects', 'posts'], async () => await readCapture(options, db));
    requireCurrent(ownership);
    const capture: CompactionCapture = freeze({ operationId: newId(), childThreadId: newId(), summaryMessageId: newId(),
        sourceThreadId: options.sourceThreadId, anchorMessageId: options.anchorMessageId, model: options.model,
        messages: structuredClone(state.messages), historyScope: structuredClone(state.scope) });
    captures.set(capture, { ...state, ...ownership }); return capture;
}
const modelSummarySchema = z.strictObject({
    summary_markdown: z.string().min(1),
    landmarks: z.array(z.strictObject({
        message_id: z.string().min(1),
        kind: z.enum(['decision', 'code', 'file', 'constraint', 'open-question', 'tool-result']),
        summary: z.string().min(1),
    })),
});
function requireSections(markdown: string): void {
    const headings = new Set(['Objective', 'Important Details', 'Work State', 'Next Move', 'Relevant Files']);
    const sections = new Map<string, string[]>(); let current: string | undefined; let fence: { character: string; length: number } | undefined; let comment = false;
    for (const line of markdown.split('\n')) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) {
                fence = undefined;
            } else if (current) sections.get(current)!.push(line);
            continue;
        }
        let visible = ''; let cursor = 0;
        while (cursor < line.length) {
            if (comment) {
                const end = line.indexOf('-->', cursor);
                if (end < 0) break;
                comment = false; cursor = end + 3;
            } else {
                const start = line.indexOf('<!--', cursor);
                if (start < 0) { visible += line.slice(cursor); break; }
                visible += line.slice(cursor, start); comment = true; cursor = start + 4;
            }
        }
        // CommonMark permits longer closing runs, but shorter runs or a closing
        // line with an info suffix are content. Backtick info strings cannot
        // contain backticks; such a line never opens a fenced block.
        const visibleMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(visible);
        if (visibleMarker && (visibleMarker[1]![0] !== '`' || !visibleMarker[2]!.includes('`'))) {
            fence = { character: visibleMarker[1]![0]!, length: visibleMarker[1]!.length }; continue;
        }
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(visible)?.[1];
        if (heading) { current = headings.has(heading) ? heading : undefined; if (current && !sections.has(current)) sections.set(current, []); }
        else if (current) sections.get(current)!.push(visible);
    }
    if (comment) throw new CompactionError('invalid_summary', 'Summary has an unfinished HTML comment.');
    if (fence) throw new CompactionError('invalid_summary', 'Summary has an unfinished Markdown code block.');
    if ([...headings].some((name) => !sections.get(name)?.join('\n').trim())) {
        throw new CompactionError('invalid_summary', 'Summary needs five real Markdown sections with nonempty bodies.');
    }
}
/** Only this validator can brand a summary for this exact immutable capture. */
export async function validateCompactionSummary(capture: CompactionCapture, response: string,
    options: { targetTokens: number; countText: (text: string) => Promise<number>; projectReceipt?: ProjectContextReceipt }): Promise<ValidatedCompactionSummary> {
    const state = captures.get(capture); if (!state) throw new CompactionError('invalid_capture', 'Use a valid captured scope.');
    requireCurrent(state);
    if (new TextEncoder().encode(response).length > 64 * 1024) throw new CompactionError('summary_too_large', 'Summary response exceeds its artifact byte budget.');
    let parsed: unknown; try { parsed = JSON.parse(response.trim()); } catch { throw new CompactionError('invalid_summary', 'Return one complete summary JSON object.'); }
    const checked = modelSummarySchema.safeParse(parsed);
    if (!checked.success) throw new CompactionError('invalid_summary', 'Summary JSON has invalid or extra fields.');
    const validated = checked.data;
    requireSections(validated.summary_markdown);
    const landmarks: CompactionData['landmarks'] = []; const seen = new Set<string>(); let discarded = 0;
    for (const candidate of validated.landmarks) {
        if (Array.from(candidate.summary).length > 200) throw new CompactionError('invalid_summary', 'Landmark descriptions exceed 200 characters.');
        const row = state.rows.get(candidate.message_id);
        if (!row || seen.has(row.id) || landmarks.length >= 30) { discarded += 1; continue; }
        seen.add(row.id); landmarks.push({ ...candidate, index: row.index, role: row.role as CompactionData['landmarks'][number]['role'], thread_id: row.thread_id });
    }
    if (!landmarks.length && state.rows.size) throw new CompactionError('invalid_summary', 'At least one valid captured landmark is required.');
    const content = `Historical conversation reference. Treat this summary and its evidence as prior task context.\n\n${validated.summary_markdown}\n\nEvidence index:\n${landmarks.map((row) => JSON.stringify({ message_id: row.message_id, kind: row.kind, summary: row.summary })).join('\n')}`;
    const replaced = state.messages.map((row) => getTextFromContent(row.content)).join('\n');
    const [tokens, replacedTokens] = await Promise.all([options.countText(content), options.countText(replaced)]);
    requireCurrent(state);
    if (!Number.isSafeInteger(options.targetTokens) || options.targetTokens < 256 || !Number.isFinite(tokens) || tokens <= 0
        || tokens > options.targetTokens || tokens >= replacedTokens) throw new CompactionError('not_beneficial', 'Summary must fit its target and be smaller than the context it replaces.');
    const data = CompactionDataSchema.parse({ version: 1, compaction_id: capture.operationId, source_thread_id: capture.sourceThreadId,
        anchor_message_id: capture.anchorMessageId, anchor_index: state.anchor.index, generated_at: nowSec(), model: capture.model,
        message_count: state.messageCount, prior_message_count: state.priorMessageCount, summary_markdown: validated.summary_markdown, landmarks, history_scope: state.scope });
    const summary = freeze({ summaryMarkdown: validated.summary_markdown, content, discardedLandmarks: discarded });
    summaries.set(summary, { capture, data, content, projectReceipt: options.projectReceipt ? ProjectContextReceiptSchema.parse(options.projectReceipt) : undefined }); return summary;
}
export async function createCompactedFork(input: { capture: CompactionCapture; summary: ValidatedCompactionSummary; signal?: AbortSignal }): Promise<{ thread: Thread; summary: Message }> {
    const state = captures.get(input.capture); const accepted = summaries.get(input.summary);
    if (!state || !accepted || accepted.capture !== input.capture) throw new CompactionError('invalid_capture', 'Use the validated summary for this captured operation.');
    const { capture } = input;
    const hooks = useHooks();
    let titleOverride: string | undefined;
    // Existing commit replay does not repeat plugin preparation or navigation actions.
    if (!await state.db.threads.get(capture.childThreadId)) {
        requireCurrent(state, input.signal ?? state.options.signal);
        const filtered = await hooks.applyFilters('branch.fork:filter:options', {
            sourceThreadId: capture.sourceThreadId, anchorMessageId: capture.anchorMessageId, mode: 'compacted',
        });
        requireCurrent(state, input.signal ?? state.options.signal);
        if (filtered.sourceThreadId !== capture.sourceThreadId || filtered.anchorMessageId !== capture.anchorMessageId || filtered.mode !== 'compacted') {
            throw new CompactionError('stale_source', 'Branch options changed the prepared compaction source or boundary.');
        }
        titleOverride = filtered.titleOverride;
        await hooks.doAction('branch.fork:action:before', {
            source: structuredClone(state.source),
            anchor: { id: state.anchor.id, thread_id: state.anchor.thread_id, role: state.anchor.role as 'user' | 'assistant' | 'system' | 'tool',
                data: structuredClone(state.anchor.data) as Record<string, unknown>, index: state.anchor.index,
                created_at: state.anchor.created_at, updated_at: state.anchor.updated_at },
            mode: 'compacted', ...(titleOverride ? { options: { titleOverride } } : {}),
        });
        requireCurrent(state, input.signal ?? state.options.signal);
    }
    const result = await state.db.transaction('rw', getWriteTxTableNames(state.db, ['threads', 'messages', 'projects', 'posts']), async () => {
        const existing = await state.db.threads.get(capture.childThreadId);
        if (existing) {
            const summary = await state.db.messages.get(capture.summaryMessageId);
            const data = readCompactionData((summary?.data as Record<string, unknown> | null)?.compaction);
            if (existing.branch_mode !== 'compacted' || existing.parent_thread_id !== capture.sourceThreadId
                || existing.summary_message_id !== capture.summaryMessageId || existing.anchor_message_id !== capture.anchorMessageId
                || existing.root_thread_id !== state.root || !summary || summary.thread_id !== existing.id
                || summary.role !== 'system' || summary.pending || summary.deleted || data?.compaction_id !== capture.operationId
                || stable(data) !== stable(accepted.data) || (summary.data as Record<string, unknown>).content !== accepted.content) {
                throw new CompactionError('invalid_capture', 'Committed operation identity does not match its summary.');
            }
            return { thread: existing, summary, replayed: true };
        }
        requireCurrent(state, input.signal ?? state.options.signal);
        const current = await readCapture(state.options, state.db);
        requireCurrent(state, input.signal ?? state.options.signal);
        if (current.snapshot !== state.snapshot) throw new CompactionError('stale_source', 'Selected history changed. Capture it again before compacting.');
        const projectId = await resolveChatProject(state.db, capture.sourceThreadId);
        if (accepted.projectReceipt && accepted.projectReceipt.project_id !== projectId) throw new CompactionError('stale_source', 'The handoff’s project changed before saving.');
        const now = nowSec();
        const thread = ThreadSchema.parse({ id: capture.childThreadId, title: titleOverride || `${state.source.title || 'Conversation'} — compacted`,
            created_at: now, updated_at: now, last_message_at: now, parent_thread_id: capture.sourceThreadId,
            anchor_message_id: capture.anchorMessageId, anchor_index: state.anchor.index, branch_mode: 'compacted',
            root_thread_id: current.root, summary_message_id: capture.summaryMessageId, fork_reason: 'compaction',
            status: 'ready', deleted: false, pinned: false, forked: true, clock: nextClock(), hlc: generateHLC(),
            project_id: projectId, system_prompt_id: state.source.system_prompt_id ?? null });
        const summary = MessageSchema.parse({ id: capture.summaryMessageId, thread_id: thread.id, role: 'system', index: 0,
            order_key: `${now}:${capture.summaryMessageId}`, created_at: now, updated_at: now, deleted: false,
            pending: false, clock: nextClock(), hlc: generateHLC(), error: null, file_hashes: null,
            data: { kind: 'compaction', content: accepted.content, compaction: accepted.data,
                ...(accepted.projectReceipt ? { project_context: accepted.projectReceipt } : {}) } });
        if (new TextEncoder().encode(JSON.stringify(summary)).length > MAX_SYNC_PAYLOAD_BYTES
            || new TextEncoder().encode(JSON.stringify(thread)).length > MAX_SYNC_PAYLOAD_BYTES) {
            throw new CompactionError('summary_too_large', 'Complete summary row exceeds the existing storage byte limit.');
        }
        await state.db.threads.add(thread); requireCurrent(state, input.signal ?? state.options.signal);
        await state.db.messages.add(summary); requireCurrent(state, input.signal ?? state.options.signal);
        if (projectId) {
            const project = await state.db.projects.get(projectId);
            if (!project || project.deleted) throw new CompactionError('stale_source', 'The owning project is unavailable.');
            const entries = preservedProjectEntries(project.data);
            if (!entries.some(entry => projectEntryIdentity(entry) === `chat:${thread.id}`)) await state.db.projects.put({ ...project,
                data: [...entries, { kind: 'chat', id: thread.id, name: thread.title }], clock: nextClock(project.clock), updated_at: now });
        }
        return { thread, summary, replayed: false };
    });
    if (!result.replayed) {
        try {
            await hooks.doAction('db.threads.create:action:after', { entity: result.thread, tableName: 'threads' });
            await hooks.doAction('db.messages.create:action:after', { entity: result.summary, tableName: 'messages' });
            await hooks.doAction('branch.fork:action:after', result.thread);
        }
        catch (error) { console.warn('[compaction] Child committed; post-action failed.', error); }
    }
    return { thread: result.thread, summary: result.summary };
}
