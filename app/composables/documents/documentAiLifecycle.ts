/**
 * Pure lifecycle helpers for Document AI run/accept control.
 * Kept framework-free so abort/ownership races are unit-testable.
 */

export type DocumentAiAgentStatus =
    | 'idle'
    | 'estimating'
    | 'streaming'
    | 'preview'
    | 'error';

export function createDocumentAiRunGeneration() {
    let generation = 0;
    return {
        bump(): number {
            generation += 1;
            return generation;
        },
        current(): number {
            return generation;
        },
        isCurrent(mine: number): boolean {
            return mine === generation;
        },
    };
}

/** Whether an aborted submit may clear status back to idle. */
export function canClearStatusAfterAbort(params: {
    myGeneration: number;
    runGeneration: number;
    status: DocumentAiAgentStatus;
}): boolean {
    return params.myGeneration === params.runGeneration
        && params.status === 'streaming';
}

/** Soft-lock the editor while streaming, reviewing, or applying accepts. */
export function shouldLockDocumentAiEditor(params: {
    status: DocumentAiAgentStatus;
    accepting: boolean;
}): boolean {
    return params.status === 'streaming'
        || params.status === 'preview'
        || params.accepting;
}

export function proposalStillOwned(params: {
    proposal: { documentId: string } | null;
    current: { documentId: string };
    documentId: string;
}): boolean {
    return params.proposal === params.current
        && params.current.documentId === params.documentId;
}

/** Serialize accept work so concurrent Accept / Accept all cannot interleave. */
export function createAcceptQueue() {
    let queue: Promise<void> = Promise.resolve();
    let accepting = false;

    return {
        get accepting() {
            return accepting;
        },
        enqueue(work: () => Promise<void>): Promise<void> {
            const run = queue.then(async () => {
                accepting = true;
                try {
                    await work();
                } finally {
                    accepting = false;
                }
            });
            queue = run.catch(() => undefined);
            return run;
        },
    };
}
