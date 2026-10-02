import { computed, shallowRef, toValue, watch, getCurrentScope, onScopeDispose, type MaybeRefOrGetter } from 'vue';
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
export function useThreadCompaction(options: ControllerOptions) {
    const state = shallowRef<ThreadCompactionState>({ status: 'idle' });
    let operation: { controller: AbortController; generation: number; source: string; model: string; committed: boolean; reason?: ErrorCode } | undefined;
    let disposed = false;
    function cancel(reason: ErrorCode = 'cancelled') {
        if (!operation || operation.committed) return;
        operation.reason = reason; operation.controller.abort();
    }
    const unsubscribe = subscribeActiveWorkspaceDb(() => cancel('stale_source'));
    const stopViewWatch = watch([() => toValue(options.threadId), () => toValue(options.model), () => toValue(options.isBusy)], () => {
        if (operation && (toValue(options.threadId) !== operation.source || toValue(options.model) !== operation.model || options.isCurrent && !options.isCurrent())) cancel('stale_source');
        else if (operation && toValue(options.isBusy)) cancel('source_busy');
    }, { flush: 'sync' });
    function dispose() { if (disposed) return; disposed = true; cancel(); unsubscribe(); stopViewWatch(); }
    if (getCurrentScope()) onScopeDispose(dispose);
    function failure(code: ErrorCode, message: string, publish = true): ThreadCompactionResult {
        if (publish) state.value = { status: 'failed', code, message }; return { ok: false, code, message };
    }
    async function start(anchorMessageId?: string): Promise<ThreadCompactionResult> {
        if (operation) return failure('source_busy', 'A compaction is already active for this pane.', false);
        if (disposed) return failure('cancelled', 'The initiating pane is no longer available.');
        const source = toValue(options.threadId); const model = toValue(options.model);
        if (!source || !model) return failure('not_eligible', 'Open a persisted conversation and choose its model first.');
        if (toValue(options.isBusy)) return failure('source_busy', 'Wait for chat generation and tools to settle.');
        const db = getDb(); const generation = getWorkspaceGeneration(); const key = `${generation}:${source}`;
        let locks = sourceLocks.get(db); if (!locks) { locks = new Map(); sourceLocks.set(db, locks); }
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
            const projection = anchorMessageId ? undefined : await resolveThreadProjection(source, db); ensure();
            const anchor = anchorMessageId ?? projection?.segments.find((segment) => segment.thread.id === source)?.visible.at(-1)?.id;
            if (!anchor) throw new CompactionError('not_eligible', 'This conversation has no local persisted anchor. Open the original conversation for inherited-only history.');
            const capture = await captureCompaction({ sourceThreadId: source, anchorMessageId: anchor, model, db, signal: owned.controller.signal, isCurrent: current }); ensure();
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
            const code = owned.reason ?? (error instanceof CompactionError ? error.code
                : error instanceof CompactionHistoryError ? 'scope_incomplete' : 'generation_failed');
            // Provider/DB errors can contain request bodies or credentials. Only
            // host-authored finite boundary errors may supply display text.
            const message = error instanceof CompactionError || error instanceof CompactionHistoryError
                ? error.message : 'Unable to generate a compaction summary. Retry explicitly when the model is available.';
            return failure(code, message);
        } finally {
            if (locks.get(key) === token) locks.delete(key);
            if (operation === owned) operation = undefined;
        }
    }
    return { state: computed(() => state.value), active: computed(() => ['capturing', 'generating', 'correcting', 'committing'].includes(state.value.status)), start, cancel: () => cancel(), dispose };
}
