import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { testRuntimeConfig } from '~~/tests/setup';

function mountPage(component: any) {
    return mount(component.default, {
        global: {
            stubs: {
                UCard: {
                    template: '<div><div><slot name="header" /></div><slot /></div>',
                },
                UButton: {
                    emits: ['click'],
                    template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
                },
            },
        },
    });
}

const activeWorkspaceId = ref<string | null>('ws-1');
const authPending = ref(false);
const authError = ref<Error | null>(null);
const authToken = ref<string | null>('token-1');
const authExpiresAt = ref<string | null>('2099-01-01T00:00:00.000Z');
const sessionPending = ref(false);
const sessionError = ref<Error | null>(null);
const activeClientSessionId = ref<string | null>('thread-1');
const networkSessionId = ref<string | null>('sess-1');
const sessionRecord = ref<any>({
    network_session_id: 'sess-1',
    workspace_id: 'ws-1',
    client_kind: 'chat',
    client_session_id: 'thread-1',
    intern_session_key: 'svc:sess-1',
    status: 'active',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    last_activity_at: '2026-04-01T00:00:00.000Z',
});

const authRefreshMock = vi.fn();
const sessionRefreshMock = vi.fn();
const sessionRememberMock = vi.fn();
const presetsEnsureLoadedMock = vi.fn();
const presetsSaveMock = vi.fn();
const presetsDeleteMock = vi.fn();
const presetItems = ref<any[]>([]);
const listAgentsMock = vi.fn();
const createAgentMock = vi.fn();
const updateAgentMock = vi.fn();
const deleteAgentMock = vi.fn();
const listJobsMock = vi.fn();
const getJobMock = vi.fn();
const createJobMock = vi.fn();
const abortJobMock = vi.fn();
const listNodesMock = vi.fn();
const listNodeServicesMock = vi.fn();
const launchNodeServiceMock = vi.fn();
const restartNodeServiceMock = vi.fn();
const revokeNodeServiceMock = vi.fn();
const listPreviewsMock = vi.fn();
const launchPreviewMock = vi.fn();
const revokePreviewMock = vi.fn();
const streamAttachMock = vi.fn();
const streamDetachMock = vi.fn();
const previewRememberMock = vi.fn();
const previewClearWorkspaceMock = vi.fn();
const newPaneForAppMock = vi.fn();
const streamPending = ref(false);
const streamConnected = ref(false);
const streamError = ref<Error | null>(null);
const streamStatus = ref<any>(null);
const streamContent = ref('');
const streamEvents = ref<any[]>([]);
const streamResult = ref<unknown>(undefined);
const streamFailure = ref<Record<string, unknown> | null>(null);
const streamIsTerminal = ref(false);
const streamActiveJobId = ref<string | null>(null);

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId }),
}));

vi.mock('~/composables/or3-net/useOr3NetAuth', () => ({
    useOr3NetAuth: () => ({
        pending: authPending,
        error: authError,
        token: authToken,
        expiresAt: authExpiresAt,
        isConfigured: computed(() => true),
        refresh: authRefreshMock,
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetSession', () => ({
    useOr3NetSession: () => ({
        pending: sessionPending,
        error: sessionError,
        session: sessionRecord,
        networkSessionId: networkSessionId,
        activeClientSessionId: activeClientSessionId,
        hasBoundSession: computed(() => sessionRecord.value !== null),
        refresh: sessionRefreshMock,
        remember: sessionRememberMock,
        invalidate: vi.fn(),
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetPresets', () => ({
    useOr3NetPresets: () => ({
        presets: presetItems,
        ensureLoaded: presetsEnsureLoadedMock,
        savePreset: presetsSaveMock,
        deletePreset: presetsDeleteMock,
        hydrate: computed(() => true),
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetClient', () => ({
    useOr3NetClient: () => ({
        listAgents: listAgentsMock,
        createAgent: createAgentMock,
        updateAgent: updateAgentMock,
        deleteAgent: deleteAgentMock,
        listJobs: listJobsMock,
        getJob: getJobMock,
        createJob: createJobMock,
        abortJob: abortJobMock,
        listNodes: listNodesMock,
        listNodeServices: listNodeServicesMock,
        launchNodeService: launchNodeServiceMock,
        restartNodeService: restartNodeServiceMock,
        revokeNodeService: revokeNodeServiceMock,
        listPreviews: listPreviewsMock,
        launchPreview: launchPreviewMock,
        revokePreview: revokePreviewMock,
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetPreviewPaneState', () => ({
    useOr3NetPreviewPaneState: () => ({
        remember: previewRememberMock,
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        clearWorkspace: previewClearWorkspaceMock,
    }),
}));

vi.mock('~/utils/multiPaneApi', () => ({
    getGlobalMultiPaneApi: () => ({
        newPaneForApp: newPaneForAppMock,
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetJobStream', () => ({
    useOr3NetJobStream: () => ({
        activeJobId: streamActiveJobId,
        pending: streamPending,
        connected: streamConnected,
        error: streamError,
        status: streamStatus,
        content: streamContent,
        events: streamEvents,
        result: streamResult,
        failure: streamFailure,
        isTerminal: streamIsTerminal,
        attach: streamAttachMock,
        detach: streamDetachMock,
    }),
}));

describe('Or3NetworkPage', () => {
    beforeEach(() => {
        vi.resetModules();
        authRefreshMock.mockReset();
        sessionRefreshMock.mockReset().mockResolvedValue(sessionRecord.value);
        sessionRememberMock.mockReset();
        presetsEnsureLoadedMock.mockReset().mockResolvedValue(undefined);
        presetsSaveMock.mockReset().mockResolvedValue(undefined);
        presetsDeleteMock.mockReset().mockResolvedValue(undefined);
        presetItems.value = [];
        listAgentsMock.mockReset().mockResolvedValue({ items: [] });
        createAgentMock.mockReset();
        updateAgentMock.mockReset();
        deleteAgentMock.mockReset().mockResolvedValue(null);
        listJobsMock.mockReset();
        getJobMock.mockReset();
        createJobMock.mockReset();
        abortJobMock.mockReset();
        listNodesMock.mockReset().mockResolvedValue({ items: [] });
        listNodeServicesMock.mockReset().mockResolvedValue({ items: [] });
        launchNodeServiceMock.mockReset();
        restartNodeServiceMock.mockReset();
        revokeNodeServiceMock.mockReset();
        listPreviewsMock.mockReset().mockResolvedValue({ items: [] });
        launchPreviewMock.mockReset();
        revokePreviewMock.mockReset();
        previewRememberMock.mockReset().mockReturnValue({ id: 'pane-prev-1' });
        previewClearWorkspaceMock.mockReset();
        newPaneForAppMock.mockReset();
        streamAttachMock.mockReset();
        streamDetachMock.mockReset();
        streamPending.value = false;
        streamConnected.value = false;
        streamError.value = null;
        streamStatus.value = null;
        streamContent.value = '';
        streamEvents.value = [];
        streamResult.value = undefined;
        streamFailure.value = null;
        streamIsTerminal.value = false;
        streamActiveJobId.value = null;
        activeWorkspaceId.value = 'ws-1';
        activeClientSessionId.value = 'thread-1';
        networkSessionId.value = 'sess-1';
        sessionRecord.value = {
            network_session_id: 'sess-1',
            workspace_id: 'ws-1',
            client_kind: 'chat',
            client_session_id: 'thread-1',
            intern_session_key: 'svc:sess-1',
            status: 'active',
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
            last_activity_at: '2026-04-01T00:00:00.000Z',
        };
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

    it('loads jobs for the current network session and fetches selected job detail', async () => {
        listJobsMock.mockResolvedValue({
            items: [
                {
                    job_id: 'job-1',
                    status: 'running',
                    node_id: 'node-1',
                    created_at: '2026-04-01T10:00:00.000Z',
                    started_at: '2026-04-01T10:01:00.000Z',
                    completed_at: null,
                    network_session_id: 'sess-1',
                },
            ],
        });
        getJobMock.mockResolvedValue({
            job_id: 'job-1',
            workspace_id: 'ws-1',
            status: 'running',
            created_at: '2026-04-01T10:00:00.000Z',
            result: { output: 'hello' },
        });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(listJobsMock).toHaveBeenCalledWith(
            'ws-1',
            expect.any(URLSearchParams)
        );
        const query = listJobsMock.mock.calls[0]?.[1] as URLSearchParams;
        expect(query.get('network_session_id')).toBe('sess-1');
        expect(getJobMock).toHaveBeenCalledWith('job-1');
        expect(streamAttachMock).toHaveBeenCalledWith('job-1');
        expect(wrapper.text()).toContain('job-1');
        expect(wrapper.text()).toContain('running');
    });

    it('loads, creates, updates, and deletes workspace agents', async () => {
        let agentItems = [
            {
                agent_id: 'agent-1',
                workspace_id: 'ws-1',
                name: 'Agent One',
                instructions: 'Initial instructions',
                tool_policy: {
                    mode: 'allow_all',
                    allowed_tools: [],
                    blocked_tools: [],
                },
                node_requirements: {
                    capabilities: ['exec'],
                    preferred_node_ids: [],
                },
            },
        ];
        listAgentsMock.mockImplementation(async () => ({ items: agentItems }));
        createAgentMock.mockImplementation(async (_workspaceId, payload) => {
            agentItems = [payload];
            return { agent: payload };
        });
        updateAgentMock.mockImplementation(async (_workspaceId, _agentId, payload) => {
            agentItems = [payload];
            return { agent: payload };
        });
        deleteAgentMock.mockImplementation(async () => {
            agentItems = [];
            return null;
        });
        listJobsMock.mockResolvedValue({ items: [] });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(listAgentsMock).toHaveBeenCalledWith('ws-1');
        expect(wrapper.text()).toContain('Agent One');

        await wrapper.get('[data-testid="or3-net-agent-name"]').setValue('Agent One Updated');
        await wrapper.get('[data-testid="or3-net-agent-save"]').trigger('click');
        await flushPromises();

        expect(updateAgentMock).toHaveBeenCalledWith('ws-1', 'agent-1', {
            agent_id: 'agent-1',
            workspace_id: 'ws-1',
            name: 'Agent One Updated',
            instructions: 'Initial instructions',
            tool_policy: {
                mode: 'allow_all',
                allowed_tools: [],
                blocked_tools: [],
            },
            node_requirements: {
                capabilities: ['exec'],
                preferred_node_ids: [],
            },
        });

        await wrapper.get('[data-testid="or3-net-agent-new"]').trigger('click');
        await wrapper.get('[data-testid="or3-net-agent-id"]').setValue('agent-2');
        await wrapper.get('[data-testid="or3-net-agent-name"]').setValue('Agent Two');
        await wrapper.get('[data-testid="or3-net-agent-instructions"]').setValue('Second instructions');
        await wrapper.get('[data-testid="or3-net-agent-tool-mode"]').setValue('allow_list');
        await wrapper.get('[data-testid="or3-net-agent-allowed-tools"]').setValue('read_file, grep_search');
        await wrapper.get('[data-testid="or3-net-agent-save"]').trigger('click');
        await flushPromises();

        expect(createAgentMock).toHaveBeenCalledWith('ws-1', {
            agent_id: 'agent-2',
            workspace_id: 'ws-1',
            name: 'Agent Two',
            instructions: 'Second instructions',
            tool_policy: {
                mode: 'allow_list',
                allowed_tools: ['read_file', 'grep_search'],
                blocked_tools: [],
            },
            node_requirements: {
                capabilities: [],
                preferred_node_ids: [],
            },
        });

        await wrapper.get('[data-testid="or3-net-agent-delete"]').trigger('click');
        await flushPromises();

        expect(deleteAgentMock).toHaveBeenCalledWith('ws-1', 'agent-2');
    });

    it('saves, applies, and deletes local presets', async () => {
        presetItems.value = [
            {
                name: 'Preset One',
                host_url: 'https://net.test',
                execution_target: 'remote',
                agent_draft: {
                    agent_id: 'agent-preset',
                    name: 'Preset Agent',
                    instructions: 'Preset instructions',
                    tool_policy_mode: 'allow_list',
                    allowed_tools_text: 'read_file',
                    blocked_tools_text: '',
                    adapter_kind: 'remote',
                    capabilities_text: 'exec',
                    isolation_class: 'workspace',
                    preferred_node_ids_text: 'node-a',
                },
                created_at: 1,
                updated_at: 1,
            },
        ];
        listJobsMock.mockResolvedValue({ items: [] });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        await wrapper.get('[data-testid="or3-net-preset-name"]').setValue('Preset Two');
        await wrapper.get('[data-testid="or3-net-preset-save"]').trigger('click');
        await flushPromises();

        expect(presetsSaveMock).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Preset Two',
                host_url: 'https://net.test',
                execution_target: 'local',
            })
        );

        await wrapper.get('[data-testid="or3-net-preset-apply-Preset One"]').trigger('click');
        await flushPromises();

        expect((wrapper.get('[data-testid="or3-net-agent-name"]').element as HTMLInputElement).value).toBe('Preset Agent');
        expect((wrapper.get('[data-testid="or3-net-agent-tool-mode"]').element as HTMLSelectElement).value).toBe('allow_list');

        await wrapper.get('[data-testid="or3-net-preset-delete-Preset One"]').trigger('click');
        await flushPromises();

        expect(presetsDeleteMock).toHaveBeenCalledWith('Preset One');
    });

    it('submits the first job using the active chat thread when no session is bound', async () => {
        networkSessionId.value = null;
        sessionRecord.value = null;
        sessionRefreshMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                network_session_id: 'sess-1',
                workspace_id: 'ws-1',
                client_kind: 'chat',
                client_session_id: 'thread-1',
                intern_session_key: 'svc:sess-1',
                status: 'active',
                created_at: '2026-04-01T00:00:00.000Z',
                updated_at: '2026-04-01T00:00:00.000Z',
                last_activity_at: '2026-04-01T00:00:00.000Z',
            });
        listJobsMock
            .mockResolvedValueOnce({ items: [] })
            .mockResolvedValueOnce({
                items: [
                    {
                        job_id: 'job-2',
                        status: 'pending',
                        node_id: null,
                        created_at: '2026-04-01T11:00:00.000Z',
                        started_at: null,
                        completed_at: null,
                        network_session_id: 'sess-1',
                    },
                ],
            });
        getJobMock.mockResolvedValue({
            job_id: 'job-2',
            workspace_id: 'ws-1',
            status: 'pending',
            created_at: '2026-04-01T11:00:00.000Z',
        });
        createJobMock.mockResolvedValue({
            job_id: 'job-2',
            status: 'pending',
            workspace_id: 'ws-1',
        });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();

        await wrapper.get('[data-testid="or3-net-job-message"]').setValue('run the first network job');
        await wrapper.get('[data-testid="or3-net-submit-job"]').trigger('click');
        await flushPromises();
        await flushPromises();

        expect(createJobMock).toHaveBeenCalledWith('ws-1', {
            client_kind: 'chat',
            client_session_id: 'thread-1',
            message: 'run the first network job',
            execution_target: 'local',
        });
    });

    it('shows live stream state and aborts the selected running job', async () => {
        listJobsMock.mockResolvedValue({
            items: [
                {
                    job_id: 'job-1',
                    status: 'running',
                    node_id: 'node-1',
                    created_at: '2026-04-01T10:00:00.000Z',
                    started_at: '2026-04-01T10:01:00.000Z',
                    completed_at: null,
                    network_session_id: 'sess-1',
                },
            ],
        });
        getJobMock.mockResolvedValue({
            job_id: 'job-1',
            workspace_id: 'ws-1',
            status: 'running',
            created_at: '2026-04-01T10:00:00.000Z',
        });
        abortJobMock.mockResolvedValue({ ok: true, job_id: 'job-1' });
        streamActiveJobId.value = 'job-1';
        streamConnected.value = true;
        streamStatus.value = 'running';
        streamContent.value = 'hello from stream';
        streamEvents.value = [{ event: 'text.delta', data: { text: 'hello from stream' } }];

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(wrapper.text()).toContain('hello from stream');
        await wrapper.get('[data-testid="or3-net-abort-job"]').trigger('click');
        await flushPromises();

        expect(abortJobMock).toHaveBeenCalledWith('job-1');
    });

    it('loads nodes and launches the advertised dashboard service', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        listJobsMock.mockResolvedValue({ items: [] });
        listNodesMock.mockResolvedValue({
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
                            memory_mb: 8192,
                            disk_mb: 20480,
                        },
                    },
                    pubkey_fingerprint: 'fp-1',
                    status: 'approved',
                    health_status: 'healthy',
                    approved_at: '2026-04-01T00:00:00.000Z',
                    revoked_at: null,
                    last_seen_at: '2026-04-01T11:58:00.000Z',
                    last_error: null,
                    created_at: '2026-04-01T00:00:00.000Z',
                },
            ],
        });
        listNodeServicesMock.mockResolvedValue({
            items: [
                {
                    service_id: 'openclaw',
                    label: 'OpenClaw',
                    status: 'ready',
                    launchable: true,
                    target_port: 3001,
                },
            ],
        });
        launchNodeServiceMock.mockResolvedValue({
            preview_id: 'prev-1',
            workspace_id: 'ws-1',
            launch_url: 'https://launch.test/openclaw',
            delivery_mode: 'external',
            supports_iframe: false,
            supports_new_tab: true,
            reused_tunnel: false,
            service_status: 'ready',
            expires_at: '2026-04-01T12:30:00.000Z',
        });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(listNodesMock).toHaveBeenCalledWith('ws-1');
        expect(listNodeServicesMock).toHaveBeenCalledWith('ws-1', 'node-1');
        expect(wrapper.text()).toContain('OpenClaw');

        await wrapper
            .get('[data-testid="or3-net-launch-node-1-openclaw"]')
            .trigger('click');
        await flushPromises();

        expect(launchNodeServiceMock).toHaveBeenCalledWith(
            'ws-1',
            'node-1',
            'openclaw'
        );
        expect(openSpy).toHaveBeenCalledWith(
            'https://launch.test/openclaw',
            '_blank',
            'noopener,noreferrer'
        );
        openSpy.mockRestore();
    });

    it('opens embeddable previews in a pane and falls back to new-tab launch', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        listJobsMock.mockResolvedValue({ items: [] });
        listPreviewsMock.mockResolvedValue({
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
                {
                    preview_id: 'prev-2',
                    workspace_id: 'ws-1',
                    kind: 'dashboard',
                    delivery_mode: 'external',
                    source_type: 'live-service',
                    service_id: 'openclaw',
                    status: 'ready',
                    supports_iframe: false,
                    supports_new_tab: true,
                },
            ],
        });
        launchPreviewMock
            .mockResolvedValueOnce({
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
            })
            .mockResolvedValueOnce({
                preview_id: 'prev-2',
                workspace_id: 'ws-1',
                launch_url: 'https://preview.test/prev-2',
                delivery_mode: 'external',
                supports_iframe: false,
                supports_new_tab: true,
                reused_tunnel: false,
                service_status: 'ready',
                expires_at: '2026-04-01T13:00:00.000Z',
            });

        const component = await import('../Or3NetworkPage.vue');
        const wrapper = mountPage(component);
        await flushPromises();
        await flushPromises();

        expect(wrapper.text()).toContain('/index.html');

        await wrapper
            .get('[data-testid="or3-net-preview-open-prev-1"]')
            .trigger('click');
        await flushPromises();

        expect(launchPreviewMock).toHaveBeenNthCalledWith(1, 'ws-1', 'prev-1', {
            launch_mode_hint: 'pane',
        });
        expect(previewRememberMock).toHaveBeenCalled();
        expect(newPaneForAppMock).toHaveBeenCalledWith('or3-net-preview', {
            initialRecordId: 'pane-prev-1',
        });

        await wrapper
            .get('[data-testid="or3-net-preview-open-prev-2"]')
            .trigger('click');
        await flushPromises();

        expect(launchPreviewMock).toHaveBeenNthCalledWith(2, 'ws-1', 'prev-2', {
            launch_mode_hint: 'new_tab',
        });
        expect(openSpy).toHaveBeenCalledWith(
            'https://preview.test/prev-2',
            '_blank',
            'noopener,noreferrer'
        );
        openSpy.mockRestore();
    });

    it('clears preview pane state when the workspace changes', async () => {
        listJobsMock.mockResolvedValue({ items: [] });
        listPreviewsMock.mockResolvedValue({ items: [] });

        const component = await import('../Or3NetworkPage.vue');
        mountPage(component);
        await flushPromises();

        activeWorkspaceId.value = 'ws-2';
        await flushPromises();

        expect(previewClearWorkspaceMock).toHaveBeenCalledWith('ws-1');
    });
});
