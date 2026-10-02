import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import type { BackgroundJobTracker, StoredMessage } from '../types';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { RequestUsage } from '~~/shared/chat/compaction';
import { projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { normalizeTerminalWorkflowState, persistBackgroundJobUpdate, persistBackgroundTrackingInterruption } from '../backgroundJobPersistence';

const beforePatch = vi.hoisted(() => vi.fn());
const measurement = (iteration = 1, prompt = 180000): RequestUsage => ({
    prompt_tokens: prompt, completion_tokens: 42, model: 'mock',
    request_id: `request-${iteration}`, iteration, measured_at: iteration,
    prefix_message_count: iteration + 2, prefix_hash: `prefix-${iteration}`,
    configuration_hash: 'configuration', input_estimate_tokens: prompt,
});

function trackerFor(db: Or3DB): BackgroundJobTracker {
    return {
        jobId: 'job', userId: 'user', threadId: 'thread', messageId: 'assistant',
        generationId: 'generation', originDb: db, status: 'streaming', active: true,
        lastWorkflowVersion: -1, lastAttempt: 1, lastContent: '', lastReasoning: '', lastPersistedLength: 0,
        lastPersistedReasoningLength: 0, lastPersistAt: Date.now(), polling: false, streaming: false,
        subscribers: new Set(), completion: new Promise(() => {}), resolveCompletion: () => {},
    };
}

function statusFor(usage?: unknown, status: BackgroundJobStatus['status'] = 'streaming'): BackgroundJobStatus {
    return {
        id: 'job', threadId: 'thread', messageId: 'assistant', model: 'mock',
        status, chunksReceived: 1, startedAt: 1, attempt: 1,
        ...(usage === undefined ? {} : { usage }),
    } as BackgroundJobStatus;
}
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

    it.each(['complete', 'error', 'aborted'] as const)('retains the last measured request through a %s actual-DB merge and canonical reload', async (terminal) => {
        const toolCalls = [{ id: 'tool-1', name: 'search', status: 'complete',
            result: 'Found', label: 'Search files', runtime: 'client', completedAt: 123 }];
        await db.messages.put({
            id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1,
            created_at: 1, updated_at: 1, clock: 7, pending: true, deleted: false,
            data: { content: 'answer', reasoning_text: 'reasoning', tool_calls: toolCalls,
                background_job_id: 'job', generation_id: 'generation',
                plugin_receipt: { version: 1 }, compaction_marker: 'keep' },
        });
        const tracker = trackerFor(db);
        tracker.canonicalHistory = true;
        tracker.lastPersistedLength = 6;
        const writes = vi.spyOn(db.messages, 'put');

        await persistBackgroundJobUpdate(tracker, statusFor(measurement()), 'answer');
        expect((await db.messages.get('assistant'))?.data).toMatchObject({ usage: measurement() });
        expect(writes).toHaveBeenCalledTimes(1);
        await persistBackgroundJobUpdate(tracker, statusFor(measurement()), 'answer');
        expect(writes).toHaveBeenCalledTimes(1);

        const row = (await db.messages.get('assistant'))! as StoredMessage;
        await db.messages.update('assistant', { data: { ...row.data, plugin_receipt: { version: 2 } } });
        await persistBackgroundJobUpdate(tracker, statusFor(measurement(2, 210000)), 'answer');
        await persistBackgroundJobUpdate(tracker, statusFor(measurement(1, 99000)), 'answer');
        await persistBackgroundJobUpdate(tracker, statusFor({ ...measurement(3), prompt_tokens: -1 }), 'answer');
        await persistBackgroundJobUpdate(tracker, statusFor(undefined, terminal), 'answer');
        db.close();
        await db.open();
        const reloaded = (await db.messages.get('assistant'))!;
        expect(reloaded).toMatchObject({ pending: false, clock: 7, data: {
            content: 'answer', reasoning_text: 'reasoning', tool_calls: toolCalls,
            generation_id: 'generation', background_job_status: terminal,
            plugin_receipt: { version: 2 }, compaction_marker: 'keep', usage: measurement(2, 210000),
        } });
        expect(projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript([reloaded]))[0]?.data?.usage)
            .toEqual(measurement(2, 210000));
    });

    it('keeps missing usage absent and accepts genuine zero counters without erasing them with incomplete usage', async () => {
        await db.messages.put({ id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1,
            created_at: 1, updated_at: 1, clock: 1, pending: true, deleted: false, data: { content: '' } });
        const tracker = trackerFor(db);
        await persistBackgroundJobUpdate(tracker, statusFor(), 'text');
        expect((await db.messages.get('assistant'))?.data).not.toHaveProperty('usage');
        const zero = { ...measurement(), prompt_tokens: 0, completion_tokens: 0 };
        await persistBackgroundJobUpdate(tracker, statusFor(zero), 'text');
        await persistBackgroundJobUpdate(tracker, statusFor({ prompt_tokens: 10 }, 'complete'), 'done');
        expect((await db.messages.get('assistant'))?.data).toMatchObject({ content: 'done', usage: zero });
    });

    it.each([
        { attempt: 2, status: 'streaming' as const },
        { attempt: 1, content_reset: true, status: 'streaming' as const },
        { attempt: 2, content_reset: true, status: 'complete' as const },
    ])('removes usage from discarded attempt output when recovery supplies no valid measurement: %j', async (reset) => {
        await db.messages.put({ id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1,
            created_at: 1, updated_at: 1, clock: 1, pending: true, deleted: false,
            data: { content: 'partial', background_job_id: 'job', generation_id: 'generation',
                background_job_attempt: 1, usage: measurement(), plugin_receipt: 'retained' } });
        const tracker = trackerFor(db);
        const content = reset.status === 'complete' ? 'new' : 'recovered';
        const result = await persistBackgroundJobUpdate(tracker, { ...statusFor(), ...reset }, content, true);
        expect(result.persisted).toBe(true);
        db.close();
        await db.open();
        const stored = (await db.messages.get('assistant'))!;
        expect(stored.pending).toBe(reset.status === 'streaming');
        expect(stored.data).not.toHaveProperty('usage');
        expect(stored.data).toMatchObject({ content, plugin_receipt: 'retained',
            background_job_attempt: reset.attempt, background_job_status: reset.status, generation_id: 'generation' });
        expect(projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript([stored]))[0]?.data?.usage).toBeUndefined();
    });

    it('accepts a measured recovery checkpoint even when its iteration precedes the discarded attempt', async () => {
        await db.messages.put({ id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1,
            created_at: 1, updated_at: 1, clock: 1, pending: true, deleted: false,
            data: { content: 'partial', background_job_id: 'job', generation_id: 'generation',
                background_job_attempt: 1, usage: measurement(2), plugin_receipt: 'retained' } });
        await persistBackgroundJobUpdate(trackerFor(db), { ...statusFor(measurement(1)), attempt: 2 }, 'checkpoint', true);
        expect((await db.messages.get('assistant'))?.data).toMatchObject({ usage: measurement(1), plugin_receipt: 'retained' });
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
                background_job_id: 'job', generation_id: 'generation', background_job_attempt: 1, usage: measurement(2), ...data },
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
            ...statusFor(measurement(1)), status: 'complete', chunksReceived: 1, startedAt: 1, completedAt: 2, attempt: 1,
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
