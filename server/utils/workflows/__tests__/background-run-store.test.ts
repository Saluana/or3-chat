/**
 * Process-restart simulation for BackgroundJobRunStore (R7.AC1, R7.AC4, R7.AC7).
 */
import { describe, it, expect, vi } from 'vitest';
import {
    BackgroundJobRunStore,
    type WorkflowRunJournal,
} from '../background-run-store';
import type { BackgroundJobProvider } from '../../background-jobs/types';
import type { ToolReceipt } from 'or3-workflow-core';

function mockProvider(): BackgroundJobProvider {
    return {
        name: 'memory-test',
        createJob: vi.fn(async () => 'job-1'),
        getJob: vi.fn(async () => null),
        updateJob: vi.fn(async () => undefined),
        completeJob: vi.fn(async () => undefined),
        failJob: vi.fn(async () => undefined),
        abortJob: vi.fn(async () => false),
        cleanupExpired: vi.fn(async () => 0),
    };
}

describe('BackgroundJobRunStore (R7.AC1, R7.AC4, R7.AC7)', () => {
    it('rehydrates receipts after simulated SSR process restart', async () => {
        const provider = mockProvider();
        let persisted: WorkflowRunJournal | undefined;
        const liveState = {
            type: 'workflow-execution' as const,
            workflowId: 'wf',
            workflowName: 'WF',
            prompt: 'hi',
            executionState: 'running' as const,
            nodeStates: {},
            executionOrder: [],
            currentNodeId: null,
            finalOutput: '',
        };

        const store1 = new BackgroundJobRunStore(
            'job-1',
            provider,
            liveState,
            (journal) => {
                persisted = journal;
                (liveState as { runJournal?: WorkflowRunJournal }).runJournal =
                    journal;
            }
        );

        const receipt: ToolReceipt = {
            runId: 'job-1',
            callId: 'call-weather-1',
            toolName: 'get_weather',
            authority: 'host-server',
            status: 'succeeded',
            result: '{"temp":72}',
            idempotencyKey: 'job-1:call-weather-1',
            at: Date.now(),
        };
        await store1.putToolReceipt(receipt);
        await store1.append(
            {
                runId: 'job-1',
                version: 1,
                type: 'wave_boundary',
                at: Date.now(),
            },
            0
        );
        await store1.saveSnapshot(
            {
                runId: 'job-1',
                sequence: 0,
                version: 1,
                status: 'running',
                pendingNodes: ['agent-2'],
                scheduledNodes: [],
                completedNodes: ['start', 'agent-1'],
                nodeOutputs: { start: 'hi', 'agent-1': 'done' },
                transcript: [{ role: 'user', content: 'hi' }],
                subflowPath: [],
                lastSequence: 0,
            },
            1
        );

        expect(persisted?.receipts).toHaveLength(1);
        expect(persisted?.snapshot?.pendingNodes).toEqual(['agent-2']);

        // Simulate process restart: new store hydrates from persisted journal only.
        const store2 = new BackgroundJobRunStore('job-1', provider, {
            ...liveState,
            runJournal: structuredClone(persisted!),
        });

        const reused = await store2.getToolReceipt('job-1', 'call-weather-1');
        expect(reused?.result).toBe('{"temp":72}');
        expect(reused?.status).toBe('succeeded');

        const loaded = await store2.load('job-1');
        expect(loaded.snapshot?.pendingNodes).toEqual(['agent-2']);
        expect(loaded.snapshot?.completedNodes).toEqual(['start', 'agent-1']);
        expect(loaded.snapshot?.nodeOutputs['agent-1']).toBe('done');
    });

    it('keeps long-term memory concerns out of the run journal', async () => {
        const provider = mockProvider();
        const store = new BackgroundJobRunStore('job-2', provider, null);
        await store.append(
            { runId: 'job-2', version: 1, type: 'run_start', at: 1 },
            0
        );
        const journal = store.getJournal();
        // Journal only carries run durability fields — no memory adapter state.
        expect(Object.keys(journal).sort()).toEqual([
            'events',
            'nextSequence',
            'receipts',
        ]);
        expect(
            JSON.stringify(journal).includes('MemoryAdapter')
        ).toBe(false);
    });
});
