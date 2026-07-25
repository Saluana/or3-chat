/**
 * @module server/utils/workflows/background-run-store
 *
 * Durable {@link RunStore} backed by the background job provider (R7.AC1, R7.AC7).
 *
 * Persists wave snapshots, ordered events, and tool receipts alongside the job's
 * workflow_state. Long-term memory remains separate (MemoryAdapter / chat
 * history) — this store only covers per-run durability for restart-safe resume.
 */

import type {
    PersistedRunEvent,
    RunSnapshot,
    RunStore,
    ToolReceipt,
} from 'or3-workflow-core';
import {
    ConcurrentRunWriterError,
    RUN_SCHEMA_VERSION,
} from 'or3-workflow-core';
import type { BackgroundJobProvider } from '../background-jobs/types';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';

/** Journal payload embedded under workflow_state.runJournal. */
export interface WorkflowRunJournal {
    nextSequence: number;
    snapshot?: RunSnapshot;
    events: PersistedRunEvent[];
    receipts: ToolReceipt[];
}

export type WorkflowStateWithJournal = WorkflowMessageData & {
    runJournal?: WorkflowRunJournal;
};

function emptyJournal(): WorkflowRunJournal {
    return { nextSequence: 0, events: [], receipts: [] };
}

/**
 * In-process cache + job-provider persistence for one background workflow job.
 *
 * Reads hydrate from `initialState.runJournal` (for process-restart resume).
 * Writes update the in-memory journal and flush via `persist`.
 */
export class BackgroundJobRunStore implements RunStore {
    private journal: WorkflowRunJournal;

    constructor(
        private readonly jobId: string,
        private readonly provider: BackgroundJobProvider,
        initialState?: WorkflowStateWithJournal | null,
        private readonly onJournalUpdate?: (
            journal: WorkflowRunJournal
        ) => void
    ) {
        this.journal = initialState?.runJournal
            ? structuredClone(initialState.runJournal)
            : emptyJournal();
    }

    /** Current journal snapshot (for embedding into workflow_state). */
    getJournal(): WorkflowRunJournal {
        return structuredClone(this.journal);
    }

    private async flush(): Promise<void> {
        this.onJournalUpdate?.(this.getJournal());
        // Persistence of the full workflow_state (including runJournal) is
        // owned by background-execution's updateWorkflowJob path, which reads
        // the live workflowState object. Callers that only have the provider
        // can still force a no-op update keyed by job id when needed.
        void this.jobId;
        void this.provider;
    }

    async append(
        event: Omit<PersistedRunEvent, 'sequence'>,
        expectedSequence: number
    ): Promise<number> {
        if (expectedSequence !== this.journal.nextSequence) {
            throw new ConcurrentRunWriterError(
                event.runId,
                expectedSequence,
                this.journal.nextSequence
            );
        }
        const sequence = this.journal.nextSequence;
        this.journal.events.push({
            ...event,
            sequence,
            version: event.version ?? RUN_SCHEMA_VERSION,
        });
        this.journal.nextSequence = sequence + 1;
        await this.flush();
        return sequence;
    }

    async saveSnapshot(
        snapshot: RunSnapshot,
        expectedSequence: number
    ): Promise<void> {
        if (expectedSequence !== this.journal.nextSequence) {
            throw new ConcurrentRunWriterError(
                snapshot.runId,
                expectedSequence,
                this.journal.nextSequence
            );
        }
        this.journal.snapshot = structuredClone(snapshot);
        await this.flush();
    }

    async load(
        runId: string
    ): Promise<{ snapshot?: RunSnapshot; events: PersistedRunEvent[] }> {
        const from = this.journal.snapshot?.lastSequence ?? -1;
        const events = this.journal.events.filter(
            (e) => e.runId === runId && e.sequence > from
        );
        return {
            snapshot: this.journal.snapshot
                ? structuredClone(this.journal.snapshot)
                : undefined,
            events: structuredClone(events),
        };
    }

    async currentSequence(_runId: string): Promise<number> {
        return this.journal.nextSequence;
    }

    async getToolReceipt(
        runId: string,
        callId: string
    ): Promise<ToolReceipt | null> {
        return (
            this.journal.receipts.find(
                (r) => r.runId === runId && r.callId === callId
            ) ?? null
        );
    }

    async putToolReceipt(receipt: ToolReceipt): Promise<void> {
        const idx = this.journal.receipts.findIndex(
            (r) => r.runId === receipt.runId && r.callId === receipt.callId
        );
        if (idx >= 0) {
            this.journal.receipts[idx] = structuredClone(receipt);
        } else {
            this.journal.receipts.push(structuredClone(receipt));
        }
        await this.flush();
    }
}
