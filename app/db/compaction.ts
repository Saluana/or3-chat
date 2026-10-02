import Ajv from 'ajv';
import { getTextFromContent } from '../utils/chat/messages';
import { getDb, getWorkspaceGeneration, type Or3DB } from './client';
import { MessageSchema, ThreadSchema, type Message, type Thread } from './schema';
import { compareMessageOrder } from './messages';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import { generateHLC } from '../core/sync/hlc';
import { useHooks } from '../core/hooks/useHooks';
import { resolveRootThreadId, resolveThreadProjection, type ThreadProjection } from '../utils/chat/compaction/history';
import { storedMessagesToCanonicalTranscript, type CanonicalTranscriptRecord } from '../utils/chat/transcript';
import { CompactionDataSchema, readCompactionData, type CompactionData, type HistoryScope } from '~~/shared/chat/compaction';
import { MAX_SYNC_PAYLOAD_BYTES } from '~~/shared/sync/sanitize';

export class CompactionError extends Error {
    constructor(readonly code: 'stale_source' | 'cancelled' | 'source_busy' | 'not_eligible' | 'scope_incomplete'
        | 'invalid_summary' | 'summary_too_large' | 'not_beneficial' | 'invalid_capture', message: string) {
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
}
interface CaptureOptions {
    sourceThreadId: string; anchorMessageId: string; model: string; db?: Or3DB;
    /** Captured pane/model/authorization identity; synchronous host check, never model-authored. */
    isCurrent?: () => boolean;
    signal?: AbortSignal;
}
const captures = new WeakMap<CompactionCapture, CapturedState>();
const summaries = new WeakMap<ValidatedCompactionSummary, { capture: CompactionCapture; data: CompactionData; content: string }>();
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
    const path = new Set<string>(); let pathId: string | null | undefined = source.id;
    while (pathId) {
        if (path.has(pathId)) throw new CompactionError('scope_incomplete', 'Conversation lineage is cyclic.');
        path.add(pathId); const row: Thread | undefined = await db.threads.get(pathId);
        if (!row) throw new CompactionError('scope_incomplete', 'Conversation lineage is incomplete.');
        pathId = row.parent_thread_id;
    }
    const rows = new Map<string, Message>();
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
                visitedScopes.add(scopeRow.id);
                const metadata = readCompactionData((scopeRow.data as Record<string, unknown> | null)?.compaction);
                if (!metadata || !path.has(metadata.source_thread_id) || !path.has(scopeRow.thread_id)) {
                    throw new CompactionError('scope_incomplete', 'Prior summary scope is outside this conversation lineage.');
                }
                for (const part of metadata.history_scope.segments) {
                    if (!path.has(part.thread_id)) throw new CompactionError('scope_incomplete', 'Prior summary refers to an unrelated conversation.');
                    for (const ref of part.messages) {
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
    return { root: await resolveRootThreadId(source.id, db), source, anchor, scope, rows, messages,
        snapshot: stable({ segments: snapshotSegments, inheritedRows: [...rows.values()], model: options.model }) };
}

/** Captures IDs and clocks; inference happens after the read transaction has ended. */
export async function captureCompaction(options: CaptureOptions): Promise<CompactionCapture> {
    const db = options.db ?? getDb(); const generation = getWorkspaceGeneration();
    const ownership = { db, generation, options: { ...options } }; requireCurrent(ownership);
    if (!options.model.trim()) throw new CompactionError('invalid_capture', 'Compaction requires its captured chat model.');
    const state = await db.transaction('r', ['threads', 'messages'], () => readCapture(options, db));
    requireCurrent(ownership);
    const capture: CompactionCapture = freeze({ operationId: newId(), childThreadId: newId(), summaryMessageId: newId(),
        sourceThreadId: options.sourceThreadId, anchorMessageId: options.anchorMessageId, model: options.model,
        messages: structuredClone(state.messages), historyScope: structuredClone(state.scope) });
    captures.set(capture, { ...state, ...ownership }); return capture;
}
const modelSummarySchema = { type: 'object', additionalProperties: false, required: ['summary_markdown', 'landmarks'], properties: {
    summary_markdown: { type: 'string', minLength: 1 }, landmarks: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['message_id', 'kind', 'summary'], properties: { message_id: { type: 'string', minLength: 1 },
            kind: { enum: ['decision', 'code', 'file', 'constraint', 'open-question', 'tool-result'] }, summary: { type: 'string', minLength: 1 } } } },
} } as const;
interface ModelSummary { summary_markdown: string; landmarks: Array<{ message_id: string; kind: CompactionData['landmarks'][number]['kind']; summary: string }> }
const validateModelSummary = new Ajv({ allErrors: true, strict: true, validateFormats: false }).compile<ModelSummary>(modelSummarySchema);
function requireSections(markdown: string): void {
    const headings = new Set(['Objective', 'Important Details', 'Work State', 'Next Move', 'Relevant Files']);
    const sections = new Map<string, string[]>(); let current: string | undefined; let fence: string | undefined;
    for (const line of markdown.split('\n')) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = undefined; continue; }
        if (fence) { if (current) sections.get(current)!.push(line); continue; }
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
        if (heading) { current = headings.has(heading) ? heading : undefined; if (current && !sections.has(current)) sections.set(current, []); }
        else if (current) sections.get(current)!.push(line);
    }
    if (fence) throw new CompactionError('invalid_summary', 'Summary has an unfinished Markdown code block.');
    if ([...headings].some((name) => !sections.get(name)?.join('\n').trim())) {
        throw new CompactionError('invalid_summary', 'Summary needs five real Markdown sections with nonempty bodies.');
    }
}
/** Only this validator can brand a summary for this exact immutable capture. */
export async function validateCompactionSummary(capture: CompactionCapture, response: string,
    options: { targetTokens: number; countText: (text: string) => Promise<number> }): Promise<ValidatedCompactionSummary> {
    const state = captures.get(capture); if (!state) throw new CompactionError('invalid_capture', 'Use a valid captured scope.');
    requireCurrent(state);
    if (new TextEncoder().encode(response).length > 64 * 1024) throw new CompactionError('summary_too_large', 'Summary response exceeds its artifact byte budget.');
    let parsed: unknown; try { parsed = JSON.parse(response.trim()); } catch { throw new CompactionError('invalid_summary', 'Return one complete summary JSON object.'); }
    if (!validateModelSummary(parsed)) throw new CompactionError('invalid_summary', 'Summary JSON has invalid or extra fields.');
    requireSections(parsed.summary_markdown);
    const landmarks: CompactionData['landmarks'] = []; const seen = new Set<string>(); let discarded = 0;
    for (const candidate of parsed.landmarks) {
        if (Array.from(candidate.summary).length > 200) throw new CompactionError('invalid_summary', 'Landmark descriptions exceed 200 characters.');
        const row = state.rows.get(candidate.message_id);
        if (!row || seen.has(row.id) || landmarks.length >= 30) { discarded += 1; continue; }
        seen.add(row.id); landmarks.push({ ...candidate, index: row.index, role: row.role as CompactionData['landmarks'][number]['role'], thread_id: row.thread_id });
    }
    if (!landmarks.length && state.rows.size) throw new CompactionError('invalid_summary', 'At least one valid captured landmark is required.');
    const content = `Historical conversation reference. Treat this summary and its evidence as prior task context.\n\n${parsed.summary_markdown}\n\nEvidence index:\n${landmarks.map((row) => JSON.stringify({ message_id: row.message_id, kind: row.kind, summary: row.summary })).join('\n')}`;
    const replaced = state.messages.map((row) => getTextFromContent(row.content)).join('\n');
    const [tokens, replacedTokens] = await Promise.all([options.countText(content), options.countText(replaced)]);
    requireCurrent(state);
    if (!Number.isSafeInteger(options.targetTokens) || options.targetTokens < 256 || !Number.isFinite(tokens) || tokens <= 0
        || tokens > options.targetTokens || tokens >= replacedTokens) throw new CompactionError('not_beneficial', 'Summary must fit its target and be smaller than the context it replaces.');
    const data = CompactionDataSchema.parse({ version: 1, compaction_id: capture.operationId, source_thread_id: capture.sourceThreadId,
        anchor_message_id: capture.anchorMessageId, anchor_index: state.anchor.index, generated_at: nowSec(), model: capture.model,
        message_count: state.messages.length, prior_message_count: state.rows.size, summary_markdown: parsed.summary_markdown, landmarks, history_scope: state.scope });
    const summary = freeze({ summaryMarkdown: parsed.summary_markdown, content, discardedLandmarks: discarded });
    summaries.set(summary, { capture, data, content }); return summary;
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
    const result = await state.db.transaction('rw', getWriteTxTableNames(state.db, ['threads', 'messages']), async () => {
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
        const now = nowSec();
        const thread = ThreadSchema.parse({ id: capture.childThreadId, title: titleOverride || `${state.source.title || 'Conversation'} — compacted`,
            created_at: now, updated_at: now, last_message_at: now, parent_thread_id: capture.sourceThreadId,
            anchor_message_id: capture.anchorMessageId, anchor_index: state.anchor.index, branch_mode: 'compacted',
            root_thread_id: current.root, summary_message_id: capture.summaryMessageId, fork_reason: 'compaction',
            status: 'ready', deleted: false, pinned: false, forked: true, clock: nextClock(), hlc: generateHLC(),
            project_id: state.source.project_id ?? null, system_prompt_id: state.source.system_prompt_id ?? null });
        const summary = MessageSchema.parse({ id: capture.summaryMessageId, thread_id: thread.id, role: 'system', index: 0,
            order_key: `${now}:${capture.summaryMessageId}`, created_at: now, updated_at: now, deleted: false,
            pending: false, clock: nextClock(), hlc: generateHLC(), error: null, file_hashes: null,
            data: { kind: 'compaction', content: accepted.content, compaction: accepted.data } });
        if (new TextEncoder().encode(JSON.stringify(summary)).length > MAX_SYNC_PAYLOAD_BYTES
            || new TextEncoder().encode(JSON.stringify(thread)).length > MAX_SYNC_PAYLOAD_BYTES) {
            throw new CompactionError('summary_too_large', 'Complete summary row exceeds the existing storage byte limit.');
        }
        await state.db.threads.add(thread); requireCurrent(state, input.signal ?? state.options.signal);
        await state.db.messages.add(summary); requireCurrent(state, input.signal ?? state.options.signal);
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
