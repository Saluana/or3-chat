import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { testRuntimeConfig } from '~~/tests/setup';

const invalidateMock = vi.fn();
const getAccessTokenMock = vi.fn();

vi.mock('../useOr3NetAuth', () => ({
    useOr3NetAuth: () => ({
        isConfigured: computed(() => true),
        getAccessToken: getAccessTokenMock,
        invalidate: invalidateMock,
    }),
}));

describe('useOr3NetClient', () => {
    beforeEach(() => {
        vi.resetModules();
        invalidateMock.mockReset();
        getAccessTokenMock.mockReset();
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                or3Net: {
                    enabled: true,
                    hostUrl: 'https://net.test',
                },
            },
        };
    });

    it('retries once on 401 with a fresh token', async () => {
        getAccessTokenMock
            .mockResolvedValueOnce('token-a')
            .mockResolvedValueOnce('token-b');

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'expired' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            );
        vi.stubGlobal('fetch', fetchMock);

        const { useOr3NetClient } = await import('../useOr3NetClient');
        const client = useOr3NetClient();
        const response = await client.request<{ ok: boolean }>('/v1/ping');

        expect(response).toEqual({ ok: true });
        expect(invalidateMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://net.test/v1/ping',
            expect.objectContaining({
                headers: expect.any(Headers),
            })
        );
        const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
        const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
        expect(firstHeaders.get('Authorization')).toBe('Bearer token-a');
        expect(secondHeaders.get('Authorization')).toBe('Bearer token-b');
    });

    it('surfaces canonical error metadata', async () => {
        getAccessTokenMock.mockResolvedValue('token-a');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        error: 'Too many requests',
                        code: 'rate_limited',
                        retry_after_ms: 1500,
                        request_id: 'req-1',
                    }),
                    {
                        status: 429,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            )
        );

        const { useOr3NetClient } = await import('../useOr3NetClient');
        const client = useOr3NetClient();

        await expect(client.request('/v1/ping')).rejects.toMatchObject({
            status: 429,
            code: 'rate_limited',
            retryAfterMs: 1500,
            requestId: 'req-1',
        });
    });

    it('builds node service routes with the correct workspace and node ids', async () => {
        getAccessTokenMock.mockResolvedValue('token-a');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        preview_id: 'prev-1',
                        workspace_id: 'ws 1',
                        launch_url: 'https://launch.test',
                        delivery_mode: 'external',
                        supports_iframe: false,
                        supports_new_tab: true,
                        reused_tunnel: false,
                        service_status: 'ready',
                        expires_at: '2026-04-01T12:00:00.000Z',
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            );
        vi.stubGlobal('fetch', fetchMock);

        const { useOr3NetClient } = await import('../useOr3NetClient');
        const client = useOr3NetClient();

        await client.listNodes('ws 1');
        await client.listNodeServices('ws 1', 'node/a');
        await client.launchNodeService('ws 1', 'node/a', 'openclaw');

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/nodes'
        );
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/nodes/node%2Fa/services'
        );
        expect(fetchMock.mock.calls[2]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/nodes/node%2Fa/services/openclaw/launch'
        );
        expect(fetchMock.mock.calls[2]?.[1]).toEqual(
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('builds preview routes with pane launch hints', async () => {
        getAccessTokenMock.mockResolvedValue('token-a');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        preview_id: 'prev-1',
                        workspace_id: 'ws-1',
                        launch_url: 'https://preview.test',
                        embed_url: 'https://preview.test/embed',
                        delivery_mode: 'embedded',
                        supports_iframe: true,
                        supports_new_tab: true,
                        reused_tunnel: false,
                        service_status: 'ready',
                        expires_at: '2026-04-01T12:00:00.000Z',
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            );
        vi.stubGlobal('fetch', fetchMock);

        const { useOr3NetClient } = await import('../useOr3NetClient');
        const client = useOr3NetClient();

        await client.listPreviews('ws-1');
        await client.launchPreview('ws-1', 'prev-1', {
            launch_mode_hint: 'pane',
        });

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws-1/previews'
        );
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws-1/previews/prev-1/launch'
        );
        expect(fetchMock.mock.calls[1]?.[1]).toEqual(
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ launch_mode_hint: 'pane' }),
            })
        );
    });

    it('builds agent CRUD routes with the correct workspace and agent ids', async () => {
        getAccessTokenMock.mockResolvedValue('token-a');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ agent: { agent_id: 'agent-1' } }), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ agent: { agent_id: 'agent-1' } }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);

        const { useOr3NetClient } = await import('../useOr3NetClient');
        const client = useOr3NetClient();
        const payload = {
            agent_id: 'agent-1',
            workspace_id: 'ws 1',
            name: 'Agent One',
            instructions: 'Help carefully',
            tool_policy: {
                mode: 'allow_all' as const,
                allowed_tools: [],
                blocked_tools: [],
            },
            node_requirements: {
                capabilities: [],
                preferred_node_ids: [],
            },
        };

        await client.listAgents('ws 1');
        await client.createAgent('ws 1', payload);
        await client.updateAgent('ws 1', 'agent/1', payload);
        await client.deleteAgent('ws 1', 'agent/1');

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/agents'
        );
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/agents'
        );
        expect(fetchMock.mock.calls[1]?.[1]).toEqual(
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify(payload),
            })
        );
        expect(fetchMock.mock.calls[2]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/agents/agent%2F1'
        );
        expect(fetchMock.mock.calls[2]?.[1]).toEqual(
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify(payload),
            })
        );
        expect(fetchMock.mock.calls[3]?.[0]).toBe(
            'https://net.test/v1/workspaces/ws%201/agents/agent%2F1'
        );
        expect(fetchMock.mock.calls[3]?.[1]).toEqual(
            expect.objectContaining({ method: 'DELETE' })
        );
    });
});
