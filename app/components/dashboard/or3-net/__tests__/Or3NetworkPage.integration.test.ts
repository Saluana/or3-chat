import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import { testRuntimeConfig } from '~~/tests/setup';

const activeWorkspaceId = ref<string | null>('ws-1');
const route = reactive<{ params: { id: string } }>({ params: { id: 'thread-1' } });
const panes = ref<Array<{ mode: string; threadId?: string }>>([{ mode: 'chat', threadId: 'thread-1' }]);
const activePaneIndex = ref(0);
const newPaneForAppMock = vi.fn();
const exchangeMock = vi.fn();
const presetItems = ref<any[]>([]);
const presetsEnsureLoadedMock = vi.fn();
const presetsSaveMock = vi.fn();
const presetsDeleteMock = vi.fn();

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId }),
}));

vi.mock('~/utils/multiPaneApi', () => ({
    getGlobalMultiPaneApi: () => ({
        panes,
        activePaneIndex,
        newPaneForApp: newPaneForAppMock,
    }),
}));

vi.mock('#imports', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#imports')>();
    return {
        ...actual,
        useRoute: () => route,
        useRuntimeConfig: () => testRuntimeConfig.value,
    };
});

vi.mock('ofetch', () => ({
    $fetch: exchangeMock,
}));

vi.mock('~/composables/or3-net/useOr3NetPresets', () => ({
    useOr3NetPresets: () => ({
        presets: presetItems,
        ensureLoaded: presetsEnsureLoadedMock,
        savePreset: presetsSaveMock,
        deletePreset: presetsDeleteMock,
        hydrate: { value: true },
    }),
}));

function mountPage(component: { default: object }) {
    return mount(component.default, {
        global: {
            stubs: {
                UCard: {
                    template: '<div><div><slot name="header" /></div><slot /></div>',
                },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
                },
            },
        },
    });
}

function createSseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        }
    );
}

describe('Or3NetworkPage integration', () => {
    beforeEach(() => {
        vi.resetModules();
        newPaneForAppMock.mockReset();
        presetItems.value = [];
        presetsEnsureLoadedMock.mockReset().mockResolvedValue(undefined);
        presetsSaveMock.mockReset().mockResolvedValue(undefined);
        presetsDeleteMock.mockReset().mockResolvedValue(undefined);
        exchangeMock.mockReset().mockResolvedValue({
            token: 'token-1',
            workspace_id: 'ws-1',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: [
                'agents:read',
                'agents:write',
                'jobs:read',
                'jobs:write',
                'sessions:read',
                'nodes:read',
                'services:read',
                'services:write',
                'previews:read',
                'previews:write',
            ],
        });
        activeWorkspaceId.value = 'ws-1';
        route.params.id = 'thread-1';
        panes.value = [{ mode: 'chat', threadId: 'thread-1' }];
        activePaneIndex.value = 0;
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                ssrAuthEnabled: true,
                or3Net: {
                    enabled: true,
                    hostUrl: 'https://net.test',
                },
            },
        };
    });

    it('runs the chat-to-host flow through real composables and only calls OR3 Net endpoints', async () => {
        let jobCreated = false;
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const parsed = new URL(url);
            const method = init?.method ?? 'GET';

            if (parsed.origin !== 'https://net.test') {
                throw new Error(`Unexpected host call: ${url}`);
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/sessions' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                network_session_id: 'sess-1',
                                workspace_id: 'ws-1',
                                client_kind: 'chat',
                                client_session_id: 'thread-1',
                                intern_session_key: 'svc:sess-1',
                                status: 'active',
                                created_at: '2026-04-01T00:00:00.000Z',
                                updated_at: '2026-04-01T00:00:00.000Z',
                                last_activity_at: '2026-04-01T00:00:00.000Z',
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/agents' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/jobs' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: jobCreated
                            ? [
                                  {
                                      job_id: 'job-1',
                                      status: 'completed',
                                      node_id: 'node-1',
                                      created_at: '2026-04-01T10:00:00.000Z',
                                      started_at: '2026-04-01T10:00:01.000Z',
                                      completed_at: '2026-04-01T10:00:02.000Z',
                                      network_session_id: 'sess-1',
                                  },
                              ]
                            : [],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/jobs' && method === 'POST') {
                jobCreated = true;
                expect(init?.body).toBe(
                    JSON.stringify({
                        network_session_id: 'sess-1',
                        message: 'run integrated job',
                        execution_target: 'local',
                    })
                );
                return new Response(
                    JSON.stringify({
                        job_id: 'job-1',
                        status: 'pending',
                        workspace_id: 'ws-1',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/jobs/job-1' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        job_id: 'job-1',
                        workspace_id: 'ws-1',
                        status: 'completed',
                        node_id: 'node-1',
                        created_at: '2026-04-01T10:00:00.000Z',
                        started_at: '2026-04-01T10:00:01.000Z',
                        completed_at: '2026-04-01T10:00:02.000Z',
                        result: { output: 'done' },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/jobs/job-1/stream' && method === 'GET') {
                return createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: job.started\ndata: {"job_id":"job-1"}\n\n',
                    'event: text.delta\ndata: {"text":"hello integrated world"}\n\n',
                    'event: job.completed\ndata: {"job_id":"job-1","output":"done"}\n\n',
                ]);
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/nodes' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                workspace_id: 'ws-1',
                                manifest: {
                                    node_id: 'node-1',
                                    adapter_kind: 'sandbox',
                                    capabilities: ['service:openclaw'],
                                    isolation_class: 'workspace',
                                    version: '1.0.0',
                                    resource_limits: {
                                        max_concurrent_jobs: 2,
                                        cpu_cores: 4,
                                        memory_mb: 4096,
                                        disk_mb: 8192,
                                    },
                                },
                                pubkey_fingerprint: 'fp-1',
                                status: 'approved',
                                health_status: 'healthy',
                                approved_at: '2026-04-01T00:00:00.000Z',
                                revoked_at: null,
                                last_seen_at: '2026-04-01T00:00:00.000Z',
                                last_error: null,
                                created_at: '2026-04-01T00:00:00.000Z',
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/nodes/node-1/services' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                service_id: 'openclaw',
                                label: 'OpenClaw',
                                status: 'ready',
                                launchable: true,
                                target_port: 3001,
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/nodes/node-1/services/openclaw/launch' && method === 'POST') {
                return new Response(
                    JSON.stringify({
                        preview_id: 'svc-openclaw',
                        workspace_id: 'ws-1',
                        launch_url: 'https://launch.test/openclaw',
                        delivery_mode: 'external',
                        supports_iframe: false,
                        supports_new_tab: true,
                        reused_tunnel: false,
                        service_status: 'ready',
                        expires_at: '2026-04-01T12:30:00.000Z',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/previews' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                preview_id: 'prev-1',
                                workspace_id: 'ws-1',
                                kind: 'static-site',
                                delivery_mode: 'embedded',
                                source_type: 'files',
                                path: '/dist',
                                entry_path: '/index.html',
                                status: 'ready',
                                supports_iframe: true,
                                supports_new_tab: true,
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            if (parsed.pathname === '/v1/workspaces/ws-1/previews/prev-1/launch' && method === 'POST') {
                return new Response(
                    JSON.stringify({
                        preview_id: 'prev-1',
                        workspace_id: 'ws-1',
                        launch_url: 'https://preview.test/prev-1',
                        embed_url: 'https://preview.test/prev-1/embed',
                        delivery_mode: 'embedded',
                        supports_iframe: true,
                        supports_new_tab: true,
                        reused_tunnel: false,
                        service_status: 'ready',
                        expires_at: '2026-04-01T13:00:00.000Z',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }

            throw new Error(`Unhandled request: ${method} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(exchangeMock).toHaveBeenCalledWith('/api/or3-net/exchange', {
            method: 'POST',
            body: { workspace_id: 'ws-1' },
            cache: 'no-store',
        });

        expect(wrapper.text()).toContain('Saved Presets');

        await wrapper.get('[data-testid="or3-net-job-message"]').setValue('run integrated job');
        await wrapper.get('[data-testid="or3-net-submit-job"]').trigger('click');
        await flushPromises();
        await flushPromises();
        await flushPromises();

        expect(wrapper.text()).toContain('hello integrated world');
        expect(wrapper.text()).toContain('job-1');

        await wrapper.get('[data-testid="or3-net-launch-node-1-openclaw"]').trigger('click');
        await flushPromises();
        expect(openSpy).toHaveBeenCalledWith(
            'https://launch.test/openclaw',
            '_blank',
            'noopener,noreferrer'
        );

        await wrapper.get('[data-testid="or3-net-preview-open-prev-1"]').trigger('click');
        await flushPromises();
        expect(newPaneForAppMock).toHaveBeenCalledWith('or3-net-preview', {
            initialRecordId: expect.any(String),
        });

        expect(
            fetchMock.mock.calls.every(([request]) => String(request).startsWith('https://net.test/'))
        ).toBe(true);
        expect(
            fetchMock.mock.calls.some(([request]) => String(request).includes('or3-intern') || String(request).includes('or3-sandbox'))
        ).toBe(false);
        openSpy.mockRestore();
    });

    it('surfaces expired preview launch errors from the host', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const parsed = new URL(url);
            const method = init?.method ?? 'GET';

            if (parsed.pathname === '/v1/workspaces/ws-1/sessions' && method === 'GET') {
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (parsed.pathname === '/v1/workspaces/ws-1/jobs' && method === 'GET') {
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (parsed.pathname === '/v1/workspaces/ws-1/nodes' && method === 'GET') {
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (parsed.pathname === '/v1/workspaces/ws-1/previews' && method === 'GET') {
                return new Response(
                    JSON.stringify({
                        items: [
                            {
                                preview_id: 'prev-expired',
                                workspace_id: 'ws-1',
                                kind: 'static-site',
                                delivery_mode: 'external',
                                source_type: 'files',
                                path: '/dist',
                                entry_path: '/index.html',
                                status: 'expired',
                                supports_iframe: false,
                                supports_new_tab: true,
                            },
                        ],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
            if (parsed.pathname === '/v1/workspaces/ws-1/previews/prev-expired/launch' && method === 'POST') {
                return new Response(
                    JSON.stringify({
                        error: 'preview launch has expired',
                        code: 'resource.expired',
                    }),
                    { status: 410, headers: { 'Content-Type': 'application/json' } }
                );
            }
            throw new Error(`Unhandled request: ${method} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        await wrapper.get('[data-testid="or3-net-preview-open-prev-expired"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('launch expired');
    });
});
