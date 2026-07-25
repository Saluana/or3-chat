/**
 * @module server/utils/workflows/background-run-store
 *
 * Durable {@link RunStore} backed by the background job provider (R7.AC1, R7.AC7).
 *
 * Persists wave snapshots, ordered events, tool intents, and receipts alongside the job's
 * workflow_state. Long-term memory remains separate (MemoryAdapter / chat
 * history) — this store only covers per-run durability for restart-safe resume.
 */

import type {
    PersistedRunEvent,
    RunSnapshot,
    RunStore,
    ToolIntent,
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
    intents: ToolIntent[];
    receipts: ToolReceipt[];
}

export type WorkflowStateWithJournal = WorkflowMessageData & {
    runJournal?: WorkflowRunJournal;
};

function emptyJournal(): WorkflowRunJournal {
    return { nextSequence: 0, events: [], intents: [], receipts: [] };
}

function normalizeJournal(
    journal: WorkflowRunJournal
): WorkflowRunJournal {
    return {
        ...emptyJournal(),
        ...journal,
        events: journal.events ?? [],
        intents: journal.intents ?? [],
        receipts: journal.receipts ?? [],
    };
}

/**
 * In-process cache + job-provider persistence for one background workflow job.
 *
 * Reads hydrate from `initialState.runJournal` (for process-restart resume).
 * Writes update the in-memory journal and flush via `persist`.
 */
export class BackgroundJobRunStore implements RunStore {
    private journal: WorkflowRunJournal;
    private readonly fallbackState: WorkflowStateWithJournal | null;
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly jobId: string,
        private readonly provider: BackgroundJobProvider,
        initialState?: WorkflowStateWithJournal | null,
        private readonly onJournalUpdate?: (
            journal: WorkflowRunJournal
        ) => void | Promise<void>
    ) {
        this.fallbackState = initialState
            ? structuredClone(initialState)
            : null;
        this.journal = initialState?.runJournal
            ? normalizeJournal(structuredClone(initialState.runJournal))
            : emptyJournal();
    }

    /** Current journal snapshot (for embedding into workflow_state). */
    getJournal(): WorkflowRunJournal {
        return structuredClone(this.journal);
    }

    private async flush(): Promise<void> {
        const journal = this.getJournal();
        if (this.onJournalUpdate) {
            await this.onJournalUpdate(journal);
            return;
        }
        if (!this.fallbackState) {
            throw new Error(
                'BackgroundJobRunStore requires initial workflow state or an async persistence callback'
            );
        }
        this.fallbackState.runJournal = journal;
        await this.provider.updateJob(this.jobId, {
            workflow_state: structuredClone(this.fallbackState),
        });
    }

    private enqueueMutation<T>(mutate: () => T): Promise<T> {
        const run = async (): Promise<T> => {
            const previous = structuredClone(this.journal);
            try {
                const result = mutate();
                await this.flush();
                return result;
            } catch (error) {
                this.journal = previous;
                throw error;
            }
        };
        const queued = this.mutationQueue.then(run, run);
        this.mutationQueue = queued.then(
            () => undefined,
            () => undefined
        );
        return queued;
    }

    async append(
        event: Omit<PersistedRunEvent, 'sequence'>,
        expectedSequence: number
    ): Promise<number> {
        return this.enqueueMutation(() => {
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
            return sequence;
        });
    }

    async saveSnapshot(
        snapshot: RunSnapshot,
        expectedSequence: number
    ): Promise<void> {
        await this.enqueueMutation(() => {
            if (expectedSequence !== this.journal.nextSequence) {
                throw new ConcurrentRunWriterError(
                    snapshot.runId,
                    expectedSequence,
                    this.journal.nextSequence
                );
            }
            this.journal.snapshot = structuredClone(snapshot);
        });
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

    async getToolReceiptByIdempotencyKey(
        runId: string,
        idempotencyKey: string
    ): Promise<ToolReceipt | null> {
        return (
            this.journal.receipts.find(
                (receipt) =>
                    receipt.runId === runId &&
                    receipt.idempotencyKey === idempotencyKey
            ) ?? null
        );
    }

    async listToolReceipts(runId: string): Promise<ToolReceipt[]> {
        return structuredClone(
            this.journal.receipts.filter(
                (receipt) => receipt.runId === runId
            )
        );
    }

    async putToolReceipt(receipt: ToolReceipt): Promise<void> {
        await this.enqueueMutation(() => {
            const idx = this.journal.receipts.findIndex(
                (r) => r.runId === receipt.runId && r.callId === receipt.callId
            );
            if (idx >= 0) {
                this.journal.receipts[idx] = structuredClone(receipt);
            } else {
                this.journal.receipts.push(structuredClone(receipt));
            }
        });
    }

    async getToolIntent(
        runId: string,
        callId: string
    ): Promise<ToolIntent | null> {
        return (
            this.journal.intents.find(
                (intent) =>
                    intent.runId === runId && intent.callId === callId
            ) ?? null
        );
    }

    async listToolIntents(runId: string): Promise<ToolIntent[]> {
        return structuredClone(
            this.journal.intents.filter(
                (intent) => intent.runId === runId
            )
        );
    }

    async putToolIntent(intent: ToolIntent): Promise<void> {
        await this.enqueueMutation(() => {
            const index = this.journal.intents.findIndex(
                (stored) =>
                    stored.runId === intent.runId &&
                    stored.callId === intent.callId
            );
            if (index >= 0) {
                this.journal.intents[index] = structuredClone(intent);
            } else {
                this.journal.intents.push(structuredClone(intent));
            }
        });
    }
}
