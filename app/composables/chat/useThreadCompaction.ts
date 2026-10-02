import { computed, shallowRef, shallowReactive, toValue, watch, getCurrentScope, onScopeDispose, type MaybeRefOrGetter } from 'vue';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { captureCompaction, createCompactedFork, CompactionError } from '~/db/compaction';
import { generateCompactionSummary } from '~/utils/chat/compaction/summary';
import { resolveThreadProjection, CompactionHistoryError } from '~/utils/chat/compaction/history';
import { newId } from '~/db/util';
import type { ContextModelMetadata } from '~~/shared/chat/context-budget';

type Committed = Awaited<ReturnType<typeof createCompactedFork>>;
type ErrorCode = CompactionError['code'] | 'generation_failed';
export type ThreadCompactionState =
    | { status: 'idle' }
    | { status: 'capturing' | 'generating' | 'correcting' | 'committing'; operation_id: string; source_thread_id: string; model: string }
    | { status: 'failed'; code: ErrorCode; message: string }
    | { status: 'complete'; thread_id: string; summary_message_id: string; discarded_landmarks: number; warning?: string };
export type ThreadCompactionResult =
    | { ok: true; thread_id: string; summary_message_id: string; discarded_landmarks: number; warning?: string }
    | { ok: false; code: ErrorCode; message: string };
export type ThreadCompactionEligibility =
    | { eligible: true; source_thread_id: string; anchor_message_id: string; model: string }
    | { eligible: false; code: ErrorCode; message: string };
interface ControllerOptions {
    threadId: MaybeRefOrGetter<string | undefined>;
    model: MaybeRefOrGetter<string>;
    isBusy: MaybeRefOrGetter<boolean>;
    apiKey?: MaybeRefOrGetter<string | null | undefined>;
    isCurrent?: () => boolean;
    getPreferences: () => Promise<{ maxContextTokens: number | null; masterSystemPrompt?: string }>;
    resolveModelMetadata: (model: string) => Promise<ContextModelMetadata | undefined>;
    getTaskSystemPrompt?: (threadId: string) => Promise<string | null>;
    onCommitted?: (result: Committed) => Promise<void> | void;
}
// Workspace-scoped ephemeral ownership, following the existing document store's
// captured-DB pattern. This stores locks only, never an unregistered global service.
const sourceLocks = new WeakMap<Or3DB, Map<string, string>>();
function getSourceLocks(db: Or3DB): Map<string, string> {
    let locks = sourceLocks.get(db);
    if (!locks) { locks = shallowReactive(new Map<string, string>()); sourceLocks.set(db, locks); }
    return locks;
}
async function prepareCapture(options: Omit<Parameters<typeof captureCompaction>[0], 'anchorMessageId'> & { anchorMessageId?: string }) {
    const projection = options.anchorMessageId ? undefined : await resolveThreadProjection(options.sourceThreadId, options.db);
    if (options.signal?.aborted) throw new CompactionError('cancelled', 'Compaction was cancelled.');
    if (options.isCurrent?.() === false) throw new CompactionError('stale_source', 'The initiating conversation, model or workspace changed.');
    const anchor = options.anchorMessageId ?? projection?.segments.find((segment) => segment.thread.id === options.sourceThreadId)?.visible.at(-1)?.id;
    if (!anchor) throw new CompactionError('not_eligible', 'This conversation has no local persisted anchor. Open the original conversation for inherited-only history.');
    return captureCompaction({ ...options, anchorMessageId: anchor });
}
function boundaryError(error: unknown): { code: ErrorCode; message: string } {
    const code = error instanceof CompactionError ? error.code : error instanceof CompactionHistoryError ? 'scope_incomplete' : 'generation_failed';
    // Provider/DB errors can contain request bodies or credentials. Only
    // host-authored finite boundary errors may supply display text.
    const message = error instanceof CompactionError || error instanceof CompactionHistoryError
        ? error.message : 'Unable to prepare a compaction summary. Retry explicitly when the source and model are available.';
    return { code, message };
}
export function useThreadCompaction(options: ControllerOptions) {
    const state = shallowRef<ThreadCompactionState>({ status: 'idle' });
    const active = computed(() => ['capturing', 'generating', 'correcting', 'committing'].includes(state.value.status));
    const workspaceRevision = shallowRef(getWorkspaceGeneration());
    let viewRevision = 0;
    let inspectionSequence = 0;
    let operation: { controller: AbortController; generation: number; source: string; model: string; committed: boolean; reason?: ErrorCode } | undefined;
    let disposed = false;
    // Disposal may change while a database read is awaiting its result.
    const isDisposed = () => disposed;
    function cancel(reason: ErrorCode = 'cancelled') {
        if (!operation || operation.committed) return;
        operation.reason = reason; operation.controller.abort();
    }
    const unsubscribe = subscribeActiveWorkspaceDb(() => { workspaceRevision.value = getWorkspaceGeneration(); viewRevision += 1; cancel('stale_source'); });
    const stopViewWatch = watch([() => toValue(options.threadId), () => toValue(options.model), () => toValue(options.isBusy)], () => {
        viewRevision += 1;
        if (operation && (toValue(options.threadId) !== operation.source || toValue(options.model) !== operation.model || options.isCurrent && !options.isCurrent())) cancel('stale_source');
        else if (operation && toValue(options.isBusy)) cancel('source_busy');
    }, { flush: 'sync' });
    function dispose() { if (disposed) return; disposed = true; cancel(); unsubscribe(); stopViewWatch(); }
    if (getCurrentScope()) onScopeDispose(dispose);
    const blockedReason = computed(() => {
        if (!toValue(options.threadId) || !toValue(options.model)) return 'Open a persisted conversation and choose its model first.';
        if (toValue(options.isBusy)) return 'Wait for chat generation and tools to settle.';
        if (active.value || getSourceLocks(getDb()).has(`${workspaceRevision.value}:${toValue(options.threadId)}`)) return 'A compaction is already active for this conversation.';
        return undefined;
    });
    function failure(code: ErrorCode, message: string, publish = true): ThreadCompactionResult {
        if (publish) state.value = { status: 'failed', code, message }; return { ok: false, code, message };
    }
    /** Explicit read-only eligibility query; does not fetch models, infer, save or consume a draft. */
    async function inspect(anchorMessageId?: string): Promise<ThreadCompactionEligibility> {
        if (isDisposed()) return { eligible: false, code: 'cancelled', message: 'The initiating pane is no longer available.' };
        const source = toValue(options.threadId); const model = toValue(options.model);
        if (!source || !model) return { eligible: false, code: 'not_eligible', message: 'Open a persisted conversation and choose its model first.' };
        const db = getDb(); const generation = getWorkspaceGeneration(); const revision = viewRevision; const sequence = ++inspectionSequence;
        const isBusy = () => toValue(options.isBusy) || active.value || getSourceLocks(db).has(`${generation}:${source}`);
        if (isBusy()) return { eligible: false, code: 'source_busy', message: 'Wait for chat generation, tools and active compaction to settle.' };
        const sameView = () => !disposed && getDb() === db && getWorkspaceGeneration() === generation && revision === viewRevision && sequence === inspectionSequence
            && toValue(options.threadId) === source && toValue(options.model) === model && (!options.isCurrent || options.isCurrent());
        const current = () => sameView() && !isBusy();
        try {
            const capture = await prepareCapture({ sourceThreadId: source, model, db, anchorMessageId, isCurrent: current });
            if (!current()) throw new CompactionError('stale_source', 'Compaction eligibility changed while checking the source.');
            return { eligible: true, source_thread_id: source, anchor_message_id: capture.anchorMessageId, model };
        } catch (error) {
            if (!sameView()) return { eligible: false, code: disposed ? 'cancelled' : 'stale_source', message: 'Compaction eligibility changed while checking the source.' };
            if (isBusy()) return { eligible: false, code: 'source_busy', message: 'Wait for chat generation, tools and active compaction to settle.' };
            return { eligible: false, ...boundaryError(error) };
        }
    }
    async function start(anchorMessageId?: string): Promise<ThreadCompactionResult> {
        if (operation) return failure('source_busy', 'A compaction is already active for this pane.', false);
        if (disposed) return failure('cancelled', 'The initiating pane is no longer available.');
        const source = toValue(options.threadId); const model = toValue(options.model);
        if (!source || !model) return failure('not_eligible', 'Open a persisted conversation and choose its model first.');
        if (toValue(options.isBusy)) return failure('source_busy', 'Wait for chat generation and tools to settle.');
        const db = getDb(); const generation = getWorkspaceGeneration(); const key = `${generation}:${source}`;
        const locks = getSourceLocks(db);
        if (locks.has(key)) return failure('source_busy', 'A compaction is already active for this conversation.');
        const token = newId(); locks.set(key, token);
        const owned = { controller: new AbortController(), generation, source, model, committed: false, reason: undefined as ErrorCode | undefined };
        operation = owned; const apiKey = toValue(options.apiKey);
        const current = () => !disposed && getDb() === db && getWorkspaceGeneration() === generation && toValue(options.threadId) === source
            && toValue(options.model) === model && !toValue(options.isBusy) && (!options.isCurrent || options.isCurrent());
        const ensure = () => { if (!current() || owned.controller.signal.aborted) throw new CompactionError(owned.reason === 'source_busy' ? 'source_busy' : owned.reason === 'cancelled' ? 'cancelled' : 'stale_source', 'The compaction source, model or workspace changed, or the operation was cancelled.'); };
        const progress = (status: 'capturing' | 'generating' | 'correcting' | 'committing', operationId = token) => {
            state.value = { status, operation_id: operationId, source_thread_id: source, model };
        };
        progress('capturing');
        try {
            const preferences = { ...await options.getPreferences() }; ensure();
            const capture = await prepareCapture({ sourceThreadId: source, anchorMessageId, model, db, signal: owned.controller.signal, isCurrent: current }); ensure();
            progress('capturing', capture.operationId);
            const [metadata, prompt] = await Promise.all([options.resolveModelMetadata(model), options.getTaskSystemPrompt?.(source) ?? Promise.resolve(null)]); ensure();
            const summary = await generateCompactionSummary(capture, { modelMetadata: metadata, userMaxContextTokens: preferences.maxContextTokens, apiKey,
                taskSystemPrompt: [preferences.masterSystemPrompt, prompt].filter(Boolean).join('\n\n') || null,
                signal: owned.controller.signal, isCurrent: current, onPhase: (phase) => progress(phase, capture.operationId) }); ensure();
            progress('committing', capture.operationId);
            const committed = await createCompactedFork({ capture, summary, signal: owned.controller.signal });
            owned.committed = true;
            let warning: string | undefined;
            if (current() && !owned.controller.signal.aborted && options.onCommitted) {
                try { await options.onCommitted(committed); } catch { warning = 'The compacted conversation was saved, but could not be opened. It remains available in history.'; }
            }
            const result = { ok: true as const, thread_id: committed.thread.id, summary_message_id: committed.summary.id,
                discarded_landmarks: summary.discardedLandmarks, ...(warning ? { warning } : {}) };
            state.value = { status: 'complete', ...result }; return result;
        } catch (error) {
            const errorResult = boundaryError(error);
            return failure(owned.reason ?? errorResult.code, errorResult.message);
        } finally {
            if (locks.get(key) === token) locks.delete(key);
            if (operation === owned) operation = undefined;
        }
    }
    return { state: computed(() => state.value), active, blockedReason, inspect, start, cancel: () => cancel(), dispose };
}
