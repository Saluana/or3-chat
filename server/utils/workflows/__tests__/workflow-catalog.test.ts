import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getAdapterMock = vi.hoisted(() => vi.fn());

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getAdapterMock,
}));

function pullResult(workspaceId: string) {
    return {
        changes: [
            {
                tableName: 'posts',
                pk: 'workflow-1',
                op: 'put' as const,
                payload: {
                    id: 'workflow-1',
                    post_type: 'workflow-entry',
                    title: `Workflow ${workspaceId}`,
                    updated_at: 1,
                    meta: {
                        nodes: [],
                        edges: [],
                        meta: { name: `Workflow ${workspaceId}` },
                    },
                },
            },
        ],
        nextCursor: 1,
        hasMore: false,
    };
}

async function loadResolver() {
    return (await import('../workflow-catalog')).resolveCanonicalWorkflow;
}

describe('workflow catalog cache', () => {
    beforeEach(() => {
        vi.resetModules();
        getAdapterMock.mockReset();
    });

    it('coalesces concurrent hydration for one workspace', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const pull = vi.fn(
            async (
                _event: H3Event,
                input: { scope: { workspaceId: string } }
            ) => {
                await gate;
                return pullResult(input.scope.workspaceId);
            }
        );
        getAdapterMock.mockReturnValue({ pull });
        const resolveCanonicalWorkflow = await loadResolver();
        const event = {} as H3Event;

        const first = resolveCanonicalWorkflow(event, {
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
        });
        const second = resolveCanonicalWorkflow(event, {
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
        });
        release();

        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(pull).toHaveBeenCalledTimes(1);
    });

    it('evicts old workspace payloads at the workspace limit', async () => {
        const pull = vi.fn(
            async (
                _event: H3Event,
                input: { scope: { workspaceId: string } }
            ) => pullResult(input.scope.workspaceId)
        );
        getAdapterMock.mockReturnValue({ pull });
        const resolveCanonicalWorkflow = await loadResolver();
        const event = {} as H3Event;

        for (let index = 0; index <= 100; index += 1) {
            await resolveCanonicalWorkflow(event, {
                workspaceId: `workspace-${index}`,
                workflowId: 'workflow-1',
            });
        }
        await resolveCanonicalWorkflow(event, {
            workspaceId: 'workspace-0',
            workflowId: 'workflow-1',
        });

        expect(pull).toHaveBeenCalledTimes(102);
    });
});
