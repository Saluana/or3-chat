import { describe, expect, it } from 'vitest';
import { DelegationActivitySchema, DelegationLiveActivitySchema, DelegationDispatchSchema, DelegationWaitSchema } from '../delegation-checkpoint';
import { delegationChildIdentities } from '../delegation-identities';

function checkpoint() {
    return { version: 1, revision: 0, callId: 'call', argumentFingerprint: `sha256:v1:${'a'.repeat(64)}`,
        deadlineAt: 200, nextCheckAt: 100, children: [
            { kind: 'prepared', index: 0, admissionId: 'admission', threadId: 'thread',
                userMessageId: 'user', assistantMessageId: 'assistant',
                admissionFingerprint: `sha256:v1:${'c'.repeat(64)}`,
                admission: { body: { model: 'test/model', messages: [{ role: 'user', content: 'Research' }] },
                    history: { version: 1, kind: 'new-turn', admissionId: 'admission', generationId: 'generation',
                        workspaceId: 'workspace', threadId: 'thread', messageId: 'assistant',
                        thread: { id: 'thread', clock: 1 }, userMessage: { id: 'user', clock: 1, thread_id: 'thread', role: 'user' },
                        assistantMessage: { id: 'assistant', clock: 1, thread_id: 'thread', role: 'assistant' } } },
                request: { task: 'Research', model: 'test/model', variant: 'nitro' } },
            { kind: 'rejected', index: 1, settlement: { kind: 'unavailable', code: 'unsupported' } },
        ] };
}

describe('durable delegation checkpoint contract', () => {
    it('derives stable, distinct child identities scoped to authority, generation and batch position', () => {
        const scope = { userId: 'user', workspaceId: 'workspace', parentGenerationId: 'generation', callId: 'call', index: 0 };
        const ids = delegationChildIdentities(scope);
        expect(delegationChildIdentities({ ...scope })).toEqual(ids);
        expect(new Set(Object.values(ids)).size).toBe(5);
        for (const changed of [{ userId: 'other' }, { workspaceId: 'other' }, { parentGenerationId: 'other' },
            { callId: 'other' }, { index: 1 }]) {
            expect(delegationChildIdentities({ ...scope, ...changed }).admissionId).not.toBe(ids.admissionId);
        }
        expect(() => delegationChildIdentities({ ...scope, index: 4 })).toThrow('Invalid delegation child index');
    });

    it('accepts an ordered batch and exact completed child identity', () => {
        const wait = checkpoint();
        Object.assign(wait.children[0]!, { jobId: 'job', settlement: {
            kind: 'complete', assistantMessageId: 'assistant', result: { kind: 'inline', value: 'answer' },
        } });
        expect(DelegationWaitSchema.safeParse(wait).success).toBe(true);
        expect(DelegationDispatchSchema.safeParse({ version: 1, sequence: 1, state: 'started' }).success).toBe(true);
    });

    it('rejects unknown versions, duplicated identities and a different completed message', () => {
        const unknown = checkpoint(); unknown.version = 2;
        expect(DelegationWaitSchema.safeParse(unknown).success).toBe(false);
        const duplicate = checkpoint(); duplicate.children[0]!.threadId = 'admission';
        expect(DelegationWaitSchema.safeParse(duplicate).success).toBe(false);
        const wrong = checkpoint();
        Object.assign(wrong.children[0]!, { jobId: 'job', settlement: {
            kind: 'complete', assistantMessageId: 'another-message', result: { kind: 'inline', value: 'answer' },
        } });
        expect(DelegationWaitSchema.safeParse(wrong).success).toBe(false);
        expect(DelegationDispatchSchema.safeParse({ version: 2, sequence: 1, state: 'started' }).success).toBe(false);
    });

    it('rejects oversized checkpoints, unordered children and secret-bearing extra fields', () => {
        const big = checkpoint();
        Object.assign(big.children[0]!, { jobId: 'job', settlement: {
            kind: 'complete', assistantMessageId: 'assistant', result: { kind: 'inline', value: '🙂'.repeat(70_000) },
        } });
        expect(DelegationWaitSchema.safeParse(big).success).toBe(false);
        const unordered = checkpoint(); unordered.children[1]!.index = 3;
        expect(DelegationWaitSchema.safeParse(unordered).success).toBe(false);
        const extra = checkpoint(); Object.assign(extra.children[0]!.request!, { apiKey: 'secret' });
        expect(DelegationWaitSchema.safeParse(extra).success).toBe(false);
    });

    it('limits canonical activity to ordered, credential-free child outcomes', () => {
        const activity = { version: 1, callId: 'call', children: [
            { index: 0, threadId: 'child', modelName: 'Terra', outcome: 'complete' },
            { index: 1, outcome: 'unavailable' },
        ] };
        expect(DelegationActivitySchema.safeParse(activity).success).toBe(true);
        expect(DelegationActivitySchema.safeParse({ ...activity, apiKey: 'secret' }).success).toBe(false);
        expect(DelegationActivitySchema.safeParse({ ...activity, children: [{ index: 0, outcome: 'complete' }] }).success).toBe(false);
        expect(DelegationActivitySchema.safeParse({ ...activity, children: [{ index: 0, outcome: 'unavailable', executionUncertain: true }] }).success).toBe(true);
        expect(DelegationActivitySchema.safeParse({ ...activity, children: [{ index: 0, outcome: 'failed', executionUncertain: true }] }).success).toBe(false);
        const live = { version: 2, callId: 'call', children: [{ index: 0, outcome: 'waiting' },
            { index: 1, threadId: 'child', outcome: 'working' }] };
        expect(DelegationLiveActivitySchema.safeParse(live).success).toBe(true);
        expect(DelegationActivitySchema.safeParse(live).success).toBe(false);
        expect(DelegationLiveActivitySchema.safeParse({ ...live, credential: 'secret' }).success).toBe(false);
        const saving = { ...live, version: 3, children: [{ index: 0, threadId: 'child', outcome: 'saving' }] };
        expect(DelegationLiveActivitySchema.safeParse(saving).success).toBe(true);
        expect(DelegationLiveActivitySchema.safeParse({ ...saving, version: 2 }).success).toBe(false);
        expect(DelegationActivitySchema.safeParse(saving).success).toBe(false);
    });
});
