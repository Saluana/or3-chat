import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import type { BackgroundJobTracker } from '../types';
import { normalizeTerminalWorkflowState, persistBackgroundJobUpdate, persistBackgroundTrackingInterruption } from '../backgroundJobPersistence';

const beforePatch = vi.hoisted(() => vi.fn());
vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: beforePatch,
    }),
}));

describe('background projection ownership across tabs', () => {
    let db: Or3DB;
    beforeEach(async () => {
        (globalThis as { __OR3_TEST_CLIENT?: boolean }).__OR3_TEST_CLIENT = true;
        db = new Or3DB(`background-projection-${crypto.randomUUID()}`);
        await db.open();
        beforePatch.mockReset();
        beforePatch.mockResolvedValue(undefined);
    });
    afterEach(async () => {
        (globalThis as { __OR3_TEST_CLIENT?: boolean }).__OR3_TEST_CLIENT = undefined;
        db.close();
        await db.delete();
    });

    it.each([
        { name: 'newer restart attempt', data: { background_job_attempt: 2 } },
        { name: 'replacement job', data: { background_job_id: 'replacement-job' } },
        { name: 'replacement generation', data: { generation_id: 'replacement-generation' } },
        { name: 'superseded retry turn', data: { superseded_by: 'new-user-turn', generation_state: 'superseded' } },
        { name: 'deleted row', data: {}, deleted: true },
    ])('preserves a $name against a late update from an older tab', async ({ data, deleted = false }) => {
        const stored = {
            id: 'assistant', thread_id: 'thread', role: 'assistant' as const,
            index: 1, created_at: 1, updated_at: 1, clock: 1, pending: true, deleted,
            data: { content: 'new durable answer', reasoning_text: 'new durable reasoning',
                background_job_id: 'job', generation_id: 'generation', background_job_attempt: 1, ...data },
        };
        await db.messages.put(stored);
        const tracker: BackgroundJobTracker = {
            jobId: 'job', userId: 'user', threadId: 'thread', messageId: 'assistant',
            generationId: 'generation', originDb: db, status: 'streaming', active: true,
            lastWorkflowVersion: -1, lastContent: '', lastReasoning: '', lastPersistedLength: 0,
            lastPersistedReasoningLength: 0, lastPersistAt: 0, polling: false, streaming: false,
            subscribers: new Set(), completion: new Promise(() => {}), resolveCompletion: () => {},
        };
        await persistBackgroundJobUpdate(tracker, {
            id: 'job', threadId: 'thread', messageId: 'assistant', model: 'mock',
            status: 'complete', chunksReceived: 1, startedAt: 1, completedAt: 2, attempt: 1,
        }, 'old answer', false, 'old reasoning');

        expect(await db.messages.get('assistant')).toEqual(stored);
    });

    it('does not interrupt a replacement job committed while the old lost-job patch awaits a hook', async () => {
        const stored = {
            id: 'assistant', thread_id: 'thread', role: 'assistant' as const,
            index: 1, created_at: 1, updated_at: 1, clock: 1, pending: true, deleted: false,
            data: { content: 'partial', background_job_id: 'lost-job' },
        };
        await db.messages.put(stored);
        let release!: () => void;
        beforePatch.mockImplementation((name: string) => name === 'db.messages.upsert:action:before'
            ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve());
        const interruption = persistBackgroundTrackingInterruption({
            originDb: db, messageId: 'assistant', jobId: 'lost-job',
        } as BackgroundJobTracker, { interrupt: true });
        await vi.waitFor(() => expect(beforePatch).toHaveBeenCalled());
        const replacement = { ...stored, data: { content: 'new answer', background_job_id: 'new-job' }, clock: 2 };
        await db.messages.put(replacement);
        release();
        await interruption;

        expect(await db.messages.get('assistant')).toEqual(replacement);
    });
});

describe('normalizeTerminalWorkflowState', () => {
    it('turns a terminal job error into a terminal workflow card state', () => {
        const state = normalizeTerminalWorkflowState(
            {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Workflow',
                prompt: 'run it',
                executionState: 'running',
                nodeStates: {
                    writer: {
                        status: 'active',
                        label: 'Writer',
                        type: 'agent',
                        output: '',
                    },
                },
                executionOrder: ['writer'],
                currentNodeId: 'writer',
                finalOutput: '',
                version: 4,
            },
            'error',
            'Provider request failed'
        );

        expect(state).toMatchObject({
            executionState: 'error',
            currentNodeId: null,
            failedNodeId: 'writer',
            nodeStates: {
                writer: {
                    status: 'active',
                    finishedAt: expect.any(Number),
                },
            },
            result: {
                success: false,
                error: 'Provider request failed',
            },
            version: 5,
        });
    });

    it.each([
        ['aborted', 'stopped', false],
        ['complete', 'completed', true]
    ] as const)('projects %s into %s immediately', (jobStatus, executionState, success) => {
        const state = normalizeTerminalWorkflowState(
            {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Workflow',
                prompt: 'run it',
                executionState: 'running',
                nodeStates: {},
                executionOrder: [],
                currentNodeId: 'writer',
                finalOutput: '',
                version: 2
            },
            jobStatus,
            undefined
        );

        expect(state).toMatchObject({
            executionState,
            currentNodeId: null,
            result: { success },
            version: 3
        });
    });
});
