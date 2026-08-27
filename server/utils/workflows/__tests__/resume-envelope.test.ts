import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundWorkflowParams } from '../background-execution';

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        admin: { auth: { jwtSecret: 'stable-resume-test-secret' } },
        webhooks: { encryptionKey: '' },
    }),
}));

const {
    createWorkflowResumeEnvelope,
    publicWorkflowState,
    readWorkflowResumeEnvelope,
} = await import('../resume-envelope');

describe('workflow resume envelope', () => {
    let params: BackgroundWorkflowParams;

    beforeEach(() => {
        params = {
            workflow: { id: 'workflow-1', nodes: [], edges: [] } as never,
            workflowId: 'workflow-1',
            workflowName: 'Test workflow',
            prompt: 'Continue safely',
            conversationHistory: [{ role: 'user', content: 'hello' }],
            apiKey: 'sk-secret-value',
            userId: 'user-1',
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            messageId: 'message-1',
        };
    });

    it('round-trips restart inputs without storing the API key as plaintext', () => {
        const envelope = createWorkflowResumeEnvelope(params);

        expect(envelope.encryptedParams).not.toContain(params.apiKey);
        expect(
            readWorkflowResumeEnvelope({
                type: 'workflow-execution',
                workflowId: params.workflowId,
                workflowName: params.workflowName,
                prompt: params.prompt,
                executionState: 'running',
                nodeStates: {},
                executionOrder: [],
                currentNodeId: null,
                finalOutput: '',
                serverResume: envelope,
            })
        ).toEqual(params);
    });

    it('removes server-only resume data from client snapshots', () => {
        const state = {
            type: 'workflow-execution' as const,
            workflowId: params.workflowId,
            workflowName: params.workflowName,
            prompt: params.prompt,
            executionState: 'running' as const,
            nodeStates: {},
            executionOrder: [],
            currentNodeId: null,
            finalOutput: '',
            serverResume: createWorkflowResumeEnvelope(params),
        };

        expect(publicWorkflowState(state)).not.toHaveProperty('serverResume');
        expect(state).toHaveProperty('serverResume');
    });
});
