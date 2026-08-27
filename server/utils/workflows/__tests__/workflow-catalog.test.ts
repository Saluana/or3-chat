import type { H3Event } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pullMock = vi.hoisted(() => vi.fn());

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: () => ({
        id: 'test',
        pull: pullMock,
    }),
}));

import {
    resetWorkflowCatalogCacheForTests,
    resolveCanonicalWorkflow,
} from '../workflow-catalog';

const event = {} as H3Event;

function workflowChange(
    serverVersion: number,
    id = 'workflow-1',
    title = 'Workflow'
) {
    return {
        serverVersion,
        tableName: 'posts',
        pk: id,
        op: 'put' as const,
        payload: {
            post_type: 'workflow-entry',
            title,
            updated_at: serverVersion,
            meta: {
                meta: {
                    id,
                    name: title,
                    version: String(serverVersion),
                },
                nodes: [],
                edges: [],
            },
        },
        stamp: {
            deviceId: 'device',
            opId: `op-${serverVersion}`,
            hlc: `${serverVersion}:0:device`,
            clock: serverVersion,
        },
    };
}

describe('workflow catalog caching', () => {
    beforeEach(() => {
        resetWorkflowCatalogCacheForTests();
        pullMock.mockReset();
        vi.restoreAllMocks();
    });

    it('uses the cache within the TTL', async () => {
        pullMock.mockResolvedValue({
            changes: [workflowChange(1)],
            nextCursor: 1,
            hasMore: false,
        });

        await resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });
        await resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });

        expect(pullMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes incrementally from the cached cursor after TTL expiry', async () => {
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValue(40_000);
        pullMock
            .mockResolvedValueOnce({
                changes: [workflowChange(1)],
                nextCursor: 1,
                hasMore: false,
            })
            .mockResolvedValueOnce({
                changes: [workflowChange(2, 'workflow-1', 'Updated')],
                nextCursor: 2,
                hasMore: false,
            });

        await resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });
        const refreshed = await resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });

        expect(pullMock.mock.calls[1]?.[1]).toMatchObject({ cursor: 1 });
        expect(refreshed.workflowName).toBe('Updated');
    });

    it('makes bounded progress through histories larger than one request budget', async () => {
        pullMock.mockImplementation(
            async (_event: H3Event, request: { cursor: number }) => ({
                changes:
                    request.cursor === 0 ? [workflowChange(1)] : [],
                nextCursor: request.cursor + 1,
                hasMore: request.cursor < 200,
            })
        );

        await expect(
            resolveCanonicalWorkflow(event, {
                workspaceId: 'ws-1',
                workflowId: 'workflow-1',
            })
        ).rejects.toMatchObject({ statusCode: 503 });

        const resolved = await resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });

        expect(pullMock.mock.calls[200]?.[1]).toMatchObject({ cursor: 200 });
        expect(resolved.workflowId).toBe('workflow-1');
    });

    it('shares one in-flight refresh across concurrent callers', async () => {
        let release: (() => void) | undefined;
        pullMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = () =>
                        resolve({
                            changes: [workflowChange(1)],
                            nextCursor: 1,
                            hasMore: false,
                        });
                })
        );

        const first = resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });
        const second = resolveCanonicalWorkflow(event, {
            workspaceId: 'ws-1',
            workflowId: 'workflow-1',
        });
        await vi.waitFor(() => expect(pullMock).toHaveBeenCalledTimes(1));
        release?.();

        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(pullMock).toHaveBeenCalledTimes(1);
    });
});
