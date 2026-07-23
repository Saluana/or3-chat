import { computed, ref, watch } from 'vue';
import { useRuntimeConfig } from '#imports';

import { useOr3NetAuth } from '~/composables/or3-net/useOr3NetAuth';
import { useOr3NetClient } from '~/composables/or3-net/useOr3NetClient';
import { useOr3NetJobStream } from '~/composables/or3-net/useOr3NetJobStream';
import { useOr3NetPresets } from '~/composables/or3-net/useOr3NetPresets';
import { useOr3NetPreviewPaneState } from '~/composables/or3-net/useOr3NetPreviewPaneState';
import { useOr3NetSession } from '~/composables/or3-net/useOr3NetSession';
import { formatOr3NetUiError } from '~/composables/or3-net/ui-errors';
import type {
    Or3NetAgent,
    Or3NetAgentDraftSnapshot,
    Or3NetJobDetail,
    Or3NetJobSummary,
    Or3NetNodeRecord,
    Or3NetPreset,
    Or3NetPreviewDescriptor,
    Or3NetNodeService,
    Or3NetToolPolicyMode,
} from '~/composables/or3-net/types';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

type Or3NetAgentDraft = Or3NetAgentDraftSnapshot;

export function useOr3NetworkPage() {
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            or3Net?: {
                hostUrl?: string;
            };
        };
    };

    const { activeWorkspaceId } = useWorkspaceManager();
    const auth = useOr3NetAuth();
    const client = useOr3NetClient();
    const presetsStore = useOr3NetPresets();
    const session = useOr3NetSession();
    const stream = useOr3NetJobStream();
    const previewPaneState = useOr3NetPreviewPaneState();

    const hostUrl = computed(() => runtimeConfig.public.or3Net?.hostUrl ?? '');
    const pending = computed(() => auth.pending.value);
    const expiresAt = computed(() => auth.expiresAt.value);
    const connectionError = computed(() => auth.error.value);
    const activeClientSessionId = computed(() => session.activeClientSessionId.value);
    const networkSessionId = computed(() => session.networkSessionId.value);
    const sessionError = computed(() => session.error.value);
    const presets = computed(() => presetsStore.presets.value);

    const agentToolPolicyModes: Or3NetToolPolicyMode[] = [
        'allow_all',
        'deny_all',
        'allow_list',
        'deny_list',
    ];
    const agentAdapterKinds = ['local', 'remote', 'sandbox'] as const;

    const agents = ref<Or3NetAgent[]>([]);
    const agentsPending = ref(false);
    const agentsError = ref<string | null>(null);
    const selectedAgentId = ref<string | null>(null);
    const agentDraft = ref<Or3NetAgentDraft>(createEmptyAgentDraft(null));
    const agentSavePending = ref(false);
    const agentDeletePending = ref(false);
    const agentActionMessage = ref<string | null>(null);
    const agentActionError = ref<string | null>(null);
    const agentEditorInitialized = ref(false);
    const presetName = ref('');
    const presetsPending = ref(false);
    const presetActionMessage = ref<string | null>(null);
    const presetActionError = ref<string | null>(null);

    const draftMessage = ref('');
    const executionTarget = ref<'local' | 'remote'>('local');
    const submitPending = ref(false);
    const submitError = ref<string | null>(null);

    const jobs = ref<Or3NetJobSummary[]>([]);
    const jobsPending = ref(false);
    const jobsError = ref<string | null>(null);
    const selectedJobId = ref<string | null>(null);
    const selectedJob = ref<Or3NetJobDetail | null>(null);
    const selectedJobPending = ref(false);
    const selectedJobError = ref<string | null>(null);
    const abortPending = ref(false);
    const nodes = ref<Or3NetNodeRecord[]>([]);
    const nodesPending = ref(false);
    const nodesError = ref<string | null>(null);
    const servicesByNodeId = ref<Record<string, Or3NetNodeService[]>>({});
    const serviceActionPendingKey = ref<string | null>(null);
    const serviceActionMessage = ref<string | null>(null);
    const serviceActionError = ref<string | null>(null);
    const previews = ref<Or3NetPreviewDescriptor[]>([]);
    const previewsPending = ref(false);
    const previewsError = ref<string | null>(null);
    const previewActionPendingKey = ref<string | null>(null);
    const previewActionMessage = ref<string | null>(null);
    const previewActionError = ref<string | null>(null);
    const refreshGeneration = {
        agents: 0,
        jobs: 0,
        nodes: 0,
        previews: 0,
    };
    let selectedJobGeneration = 0;

    const statusLabel = computed(() => {
        if (!hostUrl.value) return 'Disabled';
        if (pending.value) return 'Connecting';
        if (connectionError.value) return 'Error';
        if (session.pending.value) return 'Resolving Session';
        if (auth.token.value) return 'Connected';
        return 'Idle';
    });

    const sessionScopeLabel = computed(() => {
        if (networkSessionId.value) {
            return `Bound to ${networkSessionId.value}`;
        }
        if (activeClientSessionId.value) {
            return `Using thread ${activeClientSessionId.value}`;
        }
        return 'No chat thread available';
    });

    const jobsScopeLabel = computed(() => {
        if (networkSessionId.value) {
            return 'Showing jobs for the current OR3 Net session.';
        }
        if (activeClientSessionId.value) {
            return 'Showing recent workspace jobs until this thread creates or reuses a session binding.';
        }
        return 'Open a chat thread to bind jobs to the current conversation.';
    });

    const emptyJobsLabel = computed(() => {
        if (networkSessionId.value) {
            return 'No jobs recorded for the current session yet.';
        }
        if (activeClientSessionId.value) {
            return 'No recent jobs found for this workspace yet.';
        }
        return 'No active chat thread is available for OR3 Net job binding.';
    });

    const submitDisabled = computed(() => {
        return (
            submitPending.value ||
            !activeWorkspaceId.value ||
            !hostUrl.value ||
            (!networkSessionId.value && !activeClientSessionId.value) ||
            draftMessage.value.trim().length === 0
        );
    });

    const submitHint = computed(() => {
        if (networkSessionId.value) {
            return 'Submits into the existing network session.';
        }
        if (activeClientSessionId.value) {
            return 'First submit creates or reuses a binding for this chat thread.';
        }
        return 'Open a chat thread first.';
    });

    const displayedJobStatus = computed(() => {
        return stream.activeJobId.value === selectedJobId.value && stream.status.value
            ? stream.status.value
            : selectedJob.value?.status ?? 'unknown';
    });

    const showAbortButton = computed(() => {
        return ['pending', 'scheduled', 'running'].includes(displayedJobStatus.value);
    });

    const streamStatusLabel = computed(() => {
        if (!selectedJobId.value) return 'No job selected';
        if (stream.pending.value) return 'Connecting';
        if (stream.connected.value) return 'Live';
        if (stream.isTerminal.value) return 'Complete';
        if (stream.error.value) return 'Recovering';
        return 'Idle';
    });

    const connectionErrorMessage = computed(() =>
        connectionError.value ? formatOr3NetUiError(connectionError.value) : null
    );

    const sessionErrorMessage = computed(() =>
        sessionError.value ? formatOr3NetUiError(sessionError.value) : null
    );

    watch(
        [activeWorkspaceId, networkSessionId],
        () => {
            void refreshAgents();
            void refreshJobs();
            void refreshNodes();
            void refreshPreviews();
        },
        { immediate: true }
    );

    watch(
        activeWorkspaceId,
        () => {
            void refreshPresets();
        },
        { immediate: true }
    );

    watch(
        activeWorkspaceId,
        (nextWorkspaceId, previousWorkspaceId) => {
            if (!previousWorkspaceId || nextWorkspaceId === previousWorkspaceId) {
                return;
            }

            stream.detach();
            selectedJobId.value = null;
            selectedJob.value = null;
            selectedJobError.value = null;
            previewPaneState.clearWorkspace(previousWorkspaceId);
            serviceActionPendingKey.value = null;
            serviceActionMessage.value = null;
            serviceActionError.value = null;
            previewActionPendingKey.value = null;
            previewActionMessage.value = null;
            previewActionError.value = null;
            agentEditorInitialized.value = false;
            presetActionMessage.value = null;
            presetActionError.value = null;
            presetName.value = '';
            startNewAgent();
        }
    );

    watch(
        selectedJobId,
        (jobId) => {
            if (!jobId) {
                selectedJobGeneration++;
                selectedJob.value = null;
                selectedJobError.value = null;
                stream.detach();
                return;
            }

            void loadSelectedJob(jobId);
            void stream.attach(jobId);
        },
        { immediate: true }
    );

    watch(
        () => stream.isTerminal.value,
        (isTerminal) => {
            if (!isTerminal || !selectedJobId.value) {
                return;
            }

            void Promise.all([
                loadSelectedJob(selectedJobId.value),
                refreshJobs(),
            ]).catch(() => undefined);
        }
    );

    async function refreshConnection(): Promise<void> {
        try {
            await auth.refresh();
            await session.refresh({ force: true });
            await Promise.all([refreshAgents(), refreshPresets(), refreshJobs(), refreshNodes(), refreshPreviews()]);
        } catch {
            return;
        }
    }

    async function refreshPresets(): Promise<void> {
        presetsPending.value = true;
        presetActionError.value = null;
        try {
            await presetsStore.ensureLoaded();
        } catch (cause) {
            presetActionError.value = formatOr3NetUiError(cause);
        } finally {
            presetsPending.value = false;
        }
    }

    async function refreshAgents(): Promise<void> {
        const generation = ++refreshGeneration.agents;
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId || !auth.isConfigured.value) {
            agents.value = [];
            if (agentDraft.value.agent_id || agentDraft.value.name || agentDraft.value.instructions) {
                return;
            }
            startNewAgent();
            return;
        }

        agentsPending.value = true;
        agentsError.value = null;
        try {
            const response = await client.listAgents(workspaceId);
            if (
                generation !== refreshGeneration.agents ||
                activeWorkspaceId.value !== workspaceId
            ) return;
            agents.value = response.items;

            if (selectedAgentId.value) {
                const selectedAgent = response.items.find(
                    (item) => item.agent_id === selectedAgentId.value
                );
                if (!selectedAgent) {
                    agentEditorInitialized.value = false;
                    startNewAgent();
                }
                return;
            }

            if (!agentEditorInitialized.value && response.items[0]) {
                selectAgent(response.items[0].agent_id);
                agentEditorInitialized.value = true;
            }
        } catch (cause) {
            if (generation !== refreshGeneration.agents) return;
            agents.value = [];
            agentsError.value = formatOr3NetUiError(cause);
        } finally {
            if (generation === refreshGeneration.agents) {
                agentsPending.value = false;
            }
        }
    }

    async function refreshNodes(): Promise<void> {
        const generation = ++refreshGeneration.nodes;
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId || !auth.isConfigured.value) {
            nodes.value = [];
            servicesByNodeId.value = {};
            return;
        }

        nodesPending.value = true;
        nodesError.value = null;
        serviceActionError.value = null;
        try {
            const response = await client.listNodes(workspaceId);
            const servicesEntries = await Promise.all(
                response.items.map(async (node) => {
                    const services = await client.listNodeServices(
                        workspaceId,
                        node.manifest.node_id
                    );
                    return [node.manifest.node_id, services.items] as const;
                })
            );
            if (
                generation !== refreshGeneration.nodes ||
                activeWorkspaceId.value !== workspaceId
            ) return;
            nodes.value = response.items;
            servicesByNodeId.value = Object.fromEntries(servicesEntries);
        } catch (cause) {
            if (generation !== refreshGeneration.nodes) return;
            nodes.value = [];
            servicesByNodeId.value = {};
            nodesError.value = formatOr3NetUiError(cause);
        } finally {
            if (generation === refreshGeneration.nodes) {
                nodesPending.value = false;
            }
        }
    }

    async function refreshPreviews(): Promise<void> {
        const generation = ++refreshGeneration.previews;
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId || !auth.isConfigured.value) {
            previews.value = [];
            return;
        }

        previewsPending.value = true;
        previewsError.value = null;
        try {
            const response = await client.listPreviews(workspaceId);
            if (
                generation !== refreshGeneration.previews ||
                activeWorkspaceId.value !== workspaceId
            ) return;
            previews.value = response.items;
        } catch (cause) {
            if (generation !== refreshGeneration.previews) return;
            previews.value = [];
            previewsError.value = formatOr3NetUiError(cause);
        } finally {
            if (generation === refreshGeneration.previews) {
                previewsPending.value = false;
            }
        }
    }

    async function refreshJobs(): Promise<void> {
        const generation = ++refreshGeneration.jobs;
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId || !auth.isConfigured.value) {
            jobs.value = [];
            selectedJobId.value = null;
            return;
        }

        jobsPending.value = true;
        jobsError.value = null;
        try {
            if (activeClientSessionId.value) {
                await session.refresh();
            }

            const query = new URLSearchParams({ limit: '20' });
            if (session.networkSessionId.value) {
                query.set('network_session_id', session.networkSessionId.value);
            }

            const response = await client.listJobs(workspaceId, query);
            if (
                generation !== refreshGeneration.jobs ||
                activeWorkspaceId.value !== workspaceId
            ) return;
            jobs.value = response.items;
            if (
                selectedJobId.value &&
                response.items.some((item) => item.job_id === selectedJobId.value)
            ) {
                return;
            }
            selectedJobId.value = response.items[0]?.job_id ?? null;
        } catch (cause) {
            if (generation !== refreshGeneration.jobs) return;
            jobs.value = [];
            selectedJobId.value = null;
            jobsError.value = formatOr3NetUiError(cause);
        } finally {
            if (generation === refreshGeneration.jobs) {
                jobsPending.value = false;
            }
        }
    }

    function selectAgent(agentId: string): void {
        const agent = agents.value.find((item) => item.agent_id === agentId);
        if (!agent) {
            return;
        }

        selectedAgentId.value = agent.agent_id;
        agentDraft.value = createDraftFromAgent(agent);
        agentActionMessage.value = null;
        agentActionError.value = null;
        agentEditorInitialized.value = true;
    }

    function startNewAgent(): void {
        selectedAgentId.value = null;
        agentDraft.value = createEmptyAgentDraft(activeWorkspaceId.value);
        agentActionMessage.value = null;
        agentActionError.value = null;
    }

    async function saveAgent(): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        agentSavePending.value = true;
        agentActionMessage.value = null;
        agentActionError.value = null;
        try {
            const payload = buildAgentInput(workspaceId, agentDraft.value);
            const response = selectedAgentId.value
                ? await client.updateAgent(workspaceId, selectedAgentId.value, payload)
                : await client.createAgent(workspaceId, payload);
            const savedAgent = response.agent;
            selectedAgentId.value = savedAgent.agent_id;
            agentDraft.value = createDraftFromAgent(savedAgent);
            agentActionMessage.value = `${savedAgent.name} saved.`;
            agentEditorInitialized.value = true;
            await refreshAgents();
        } catch (cause) {
            agentActionError.value = formatOr3NetUiError(cause);
        } finally {
            agentSavePending.value = false;
        }
    }

    async function deleteSelectedAgent(): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        const agentId = selectedAgentId.value;
        if (!workspaceId || !agentId) {
            return;
        }

        agentDeletePending.value = true;
        agentActionMessage.value = null;
        agentActionError.value = null;
        try {
            await client.deleteAgent(workspaceId, agentId);
            agentActionMessage.value = `${agentId} deleted.`;
            agentEditorInitialized.value = false;
            startNewAgent();
            await refreshAgents();
        } catch (cause) {
            agentActionError.value = formatOr3NetUiError(cause);
        } finally {
            agentDeletePending.value = false;
        }
    }

    async function saveCurrentPreset(): Promise<void> {
        const trimmedName = presetName.value.trim();
        if (!trimmedName) {
            presetActionError.value = 'Preset name is required';
            return;
        }

        presetsPending.value = true;
        presetActionError.value = null;
        presetActionMessage.value = null;
        try {
            await presetsStore.savePreset({
                name: trimmedName,
                host_url: hostUrl.value || null,
                execution_target: executionTarget.value,
                agent_draft: { ...agentDraft.value },
                created_at: Date.now(),
                updated_at: Date.now(),
            });
            presetActionMessage.value = `${trimmedName} saved.`;
            presetName.value = '';
        } catch (cause) {
            presetActionError.value = formatOr3NetUiError(cause);
        } finally {
            presetsPending.value = false;
        }
    }

    function applyPreset(preset: Or3NetPreset): void {
        selectedAgentId.value = null;
        agentDraft.value = { ...preset.agent_draft };
        executionTarget.value = preset.execution_target;
        presetActionError.value = null;
        presetActionMessage.value = `${preset.name} applied to the editor.`;
    }

    async function deletePreset(name: string): Promise<void> {
        presetsPending.value = true;
        presetActionError.value = null;
        presetActionMessage.value = null;
        try {
            await presetsStore.deletePreset(name);
            presetActionMessage.value = `${name} deleted.`;
        } catch (cause) {
            presetActionError.value = formatOr3NetUiError(cause);
        } finally {
            presetsPending.value = false;
        }
    }

    async function loadSelectedJob(jobId: string): Promise<void> {
        const generation = ++selectedJobGeneration;
        selectedJobPending.value = true;
        selectedJobError.value = null;
        try {
            const job = await client.getJob(jobId);
            if (
                generation !== selectedJobGeneration ||
                selectedJobId.value !== jobId
            ) return;
            selectedJob.value = job;
        } catch (cause) {
            if (generation !== selectedJobGeneration) return;
            selectedJob.value = null;
            selectedJobError.value = formatOr3NetUiError(cause);
        } finally {
            if (generation === selectedJobGeneration) {
                selectedJobPending.value = false;
            }
        }
    }

    async function submitJob(): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        const message = draftMessage.value.trim();
        if (!workspaceId || !message) {
            return;
        }

        submitPending.value = true;
        submitError.value = null;
        try {
            const created = await client.createJob(workspaceId, {
                ...(networkSessionId.value
                    ? { network_session_id: networkSessionId.value }
                    : {
                          client_kind: 'chat',
                          client_session_id: activeClientSessionId.value ?? undefined,
                      }),
                message,
                execution_target: executionTarget.value,
            });

            draftMessage.value = '';
            await session.refresh({ force: true });
            await refreshJobs();
            selectedJobId.value = created.job_id;
        } catch (cause) {
            submitError.value = formatOr3NetUiError(cause);
        } finally {
            submitPending.value = false;
        }
    }

    async function abortSelectedJob(): Promise<void> {
        if (!selectedJob.value) {
            return;
        }

        abortPending.value = true;
        selectedJobError.value = null;
        try {
            await client.abortJob(selectedJob.value.job_id);
            await Promise.all([
                loadSelectedJob(selectedJob.value.job_id),
                refreshJobs(),
            ]);
        } catch (cause) {
            selectedJobError.value = formatOr3NetUiError(cause);
        } finally {
            abortPending.value = false;
        }
    }

    async function launchService(nodeId: string, serviceId: string): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        serviceActionPendingKey.value = `${nodeId}:${serviceId}:launch`;
        serviceActionError.value = null;
        serviceActionMessage.value = null;
        try {
            const launch = await client.launchNodeService(workspaceId, nodeId, serviceId);
            const safeUrl = resolveSafeBrowserUrl(launch.launch_url);
            if (!safeUrl) {
                throw new Error('Blocked non-HTTP launch URL returned by OR3 Net');
            }
            window.open(safeUrl, '_blank', 'noopener,noreferrer');
            serviceActionMessage.value = `Opened ${serviceId}. Expires ${formatTimestamp(launch.expires_at)}.`;
        } catch (cause) {
            serviceActionError.value = formatOr3NetUiError(cause);
        } finally {
            serviceActionPendingKey.value = null;
        }
    }

    async function restartService(nodeId: string, serviceId: string): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        serviceActionPendingKey.value = `${nodeId}:${serviceId}:restart`;
        serviceActionError.value = null;
        serviceActionMessage.value = null;
        try {
            await client.restartNodeService(workspaceId, nodeId, serviceId);
            serviceActionMessage.value = `Restarted ${serviceId}.`;
            await refreshNodes();
        } catch (cause) {
            serviceActionError.value = formatOr3NetUiError(cause);
        } finally {
            serviceActionPendingKey.value = null;
        }
    }

    async function revokeService(nodeId: string, serviceId: string): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        serviceActionPendingKey.value = `${nodeId}:${serviceId}:revoke`;
        serviceActionError.value = null;
        serviceActionMessage.value = null;
        try {
            const result = await client.revokeNodeService(workspaceId, nodeId, serviceId);
            serviceActionMessage.value = `Revoked ${result.revoked} launch grant${result.revoked === 1 ? '' : 's'} for ${serviceId}.`;
        } catch (cause) {
            serviceActionError.value = formatOr3NetUiError(cause);
        } finally {
            serviceActionPendingKey.value = null;
        }
    }

    async function openPreview(preview: Or3NetPreviewDescriptor): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        previewActionPendingKey.value = `${preview.preview_id}:open`;
        previewActionError.value = null;
        previewActionMessage.value = null;
        try {
            const launch = await client.launchPreview(workspaceId, preview.preview_id, {
                launch_mode_hint: preview.supports_iframe ? 'pane' : 'new_tab',
            });

            const safeLaunchUrl = resolveSafeBrowserUrl(launch.launch_url);
            if (!safeLaunchUrl) {
                throw new Error('Blocked non-HTTP preview launch URL returned by OR3 Net');
            }

            if (launch.supports_iframe) {
                const multiPane = getGlobalMultiPaneApi();
                if (!multiPane) {
                    throw new Error('Multi-pane API unavailable for embedded preview launch');
                }

                const paneRecord = previewPaneState.remember({ preview, launch });
                try {
                    await multiPane.newPaneForApp('or3-net-preview', {
                        initialRecordId: paneRecord.id,
                    });
                } catch (cause) {
                    previewPaneState.remove(paneRecord.id);
                    throw cause;
                }
                previewActionMessage.value = `Opened ${preview.preview_id} in a pane.`;
                return;
            }

            window.open(safeLaunchUrl, '_blank', 'noopener,noreferrer');
            previewActionMessage.value = `Opened ${preview.preview_id} in a new tab.`;
        } catch (cause) {
            previewActionError.value = formatOr3NetUiError(cause);
        } finally {
            previewActionPendingKey.value = null;
        }
    }

    async function openPreviewExternal(preview: Or3NetPreviewDescriptor): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        previewActionPendingKey.value = `${preview.preview_id}:external`;
        previewActionError.value = null;
        previewActionMessage.value = null;
        try {
            const launch = await client.launchPreview(workspaceId, preview.preview_id, {
                launch_mode_hint: 'new_tab',
            });
            const safeLaunchUrl = resolveSafeBrowserUrl(launch.launch_url);
            if (!safeLaunchUrl) {
                throw new Error('Blocked non-HTTP preview launch URL returned by OR3 Net');
            }
            window.open(safeLaunchUrl, '_blank', 'noopener,noreferrer');
            previewActionMessage.value = `Opened ${preview.preview_id} in a new tab.`;
        } catch (cause) {
            previewActionError.value = formatOr3NetUiError(cause);
        } finally {
            previewActionPendingKey.value = null;
        }
    }

    async function revokePreview(preview: Or3NetPreviewDescriptor): Promise<void> {
        const workspaceId = activeWorkspaceId.value;
        if (!workspaceId) {
            return;
        }

        previewActionPendingKey.value = `${preview.preview_id}:revoke`;
        previewActionError.value = null;
        previewActionMessage.value = null;
        try {
            await client.revokePreview(workspaceId, preview.preview_id);
            previewActionMessage.value = `Revoked ${preview.preview_id}.`;
            await refreshPreviews();
        } catch (cause) {
            previewActionError.value = formatOr3NetUiError(cause);
        } finally {
            previewActionPendingKey.value = null;
        }
    }

    function resolveSafeBrowserUrl(value: string | null): string | null {
        if (!value) {
            return null;
        }

        try {
            const url = new URL(value);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return null;
            }
            return url.toString();
        } catch {
            return null;
        }
    }

    function createEmptyAgentDraft(workspaceId: string | null): Or3NetAgentDraft {
        void workspaceId;
        return {
            agent_id: '',
            name: '',
            instructions: '',
            tool_policy_mode: 'allow_all',
            allowed_tools_text: '',
            blocked_tools_text: '',
            adapter_kind: '',
            capabilities_text: '',
            isolation_class: '',
            preferred_node_ids_text: '',
        };
    }

    function createDraftFromAgent(agent: Or3NetAgent): Or3NetAgentDraft {
        return {
            agent_id: agent.agent_id,
            name: agent.name,
            instructions: agent.instructions,
            tool_policy_mode: agent.tool_policy.mode,
            allowed_tools_text: agent.tool_policy.allowed_tools.join(', '),
            blocked_tools_text: agent.tool_policy.blocked_tools.join(', '),
            adapter_kind: agent.node_requirements.adapter_kind ?? '',
            capabilities_text: agent.node_requirements.capabilities.join(', '),
            isolation_class: agent.node_requirements.isolation_class ?? '',
            preferred_node_ids_text: agent.node_requirements.preferred_node_ids.join(', '),
        };
    }

    function buildAgentInput(workspaceId: string, draft: Or3NetAgentDraft): Or3NetAgent {
        const agent_id = draft.agent_id.trim();
        const name = draft.name.trim();
        const instructions = draft.instructions.trim();
        const allowed_tools = parseCsvList(draft.allowed_tools_text);
        const blocked_tools = parseCsvList(draft.blocked_tools_text);

        if (!agent_id) {
            throw new Error('Agent ID is required');
        }
        if (!name) {
            throw new Error('Agent name is required');
        }
        if (!instructions) {
            throw new Error('Agent instructions are required');
        }
        if (draft.tool_policy_mode === 'allow_list' && allowed_tools.length === 0) {
            throw new Error('allow_list policies require at least one allowed tool');
        }
        if (draft.tool_policy_mode === 'deny_list' && blocked_tools.length === 0) {
            throw new Error('deny_list policies require at least one blocked tool');
        }

        return {
            agent_id,
            workspace_id: workspaceId,
            name,
            instructions,
            tool_policy: {
                mode: draft.tool_policy_mode,
                allowed_tools,
                blocked_tools,
            },
            node_requirements: {
                ...(draft.adapter_kind ? { adapter_kind: draft.adapter_kind } : {}),
                capabilities: parseCsvList(draft.capabilities_text),
                ...(draft.isolation_class.trim()
                    ? { isolation_class: draft.isolation_class.trim() }
                    : {}),
                preferred_node_ids: parseCsvList(draft.preferred_node_ids_text),
            },
        };
    }

    function parseCsvList(value: string): string[] {
        const seen = new Set<string>();
        const items: string[] = [];
        for (const part of value.split(',')) {
            const trimmed = part.trim();
            if (!trimmed || seen.has(trimmed)) {
                continue;
            }
            seen.add(trimmed);
            items.push(trimmed);
        }
        return items;
    }

    function formatAgentSummary(agent: Or3NetAgent): string {
        const parts = [
            `${agent.node_requirements.capabilities.length} cap${agent.node_requirements.capabilities.length === 1 ? '' : 's'}`,
            `${agent.node_requirements.preferred_node_ids.length} preferred node${agent.node_requirements.preferred_node_ids.length === 1 ? '' : 's'}`,
        ];

        if (agent.node_requirements.adapter_kind) {
            parts.unshift(agent.node_requirements.adapter_kind);
        }

        return parts.join(' · ');
    }

    function formatPresetSummary(preset: Or3NetPreset): string {
        const capabilities = parseCsvList(preset.agent_draft.capabilities_text).length;
        const preferredNodes = parseCsvList(
            preset.agent_draft.preferred_node_ids_text
        ).length;
        return `${preset.agent_draft.tool_policy_mode} · ${capabilities} cap${capabilities === 1 ? '' : 's'} · ${preferredNodes} preferred node${preferredNodes === 1 ? '' : 's'}`;
    }

    function formatTimestamp(value: string | null | undefined): string {
        if (!value) return 'Unavailable';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    }

    function formatJson(value: unknown): string {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    return {
        activeWorkspaceId, stream,
        hostUrl, pending, expiresAt, connectionError,
        activeClientSessionId, networkSessionId, sessionError, presets,
        agentToolPolicyModes, agentAdapterKinds, agents, agentsPending,
        agentsError, selectedAgentId, agentDraft, agentSavePending,
        agentDeletePending, agentActionMessage, agentActionError, presetName,
        presetsPending, presetActionMessage, presetActionError, draftMessage,
        executionTarget, submitPending, submitError, jobs,
        jobsPending, jobsError, selectedJobId, selectedJob,
        selectedJobPending, selectedJobError, abortPending, nodes,
        nodesPending, nodesError, servicesByNodeId, serviceActionPendingKey,
        serviceActionMessage, serviceActionError, previews, previewsPending,
        previewsError, previewActionPendingKey, previewActionMessage, previewActionError,
        statusLabel, sessionScopeLabel, jobsScopeLabel, emptyJobsLabel,
        submitDisabled, submitHint, displayedJobStatus, showAbortButton,
        streamStatusLabel, refreshConnection, refreshPresets, refreshAgents,
        refreshNodes, refreshPreviews, refreshJobs, selectAgent,
        startNewAgent, saveAgent, deleteSelectedAgent, saveCurrentPreset,
        applyPreset, deletePreset, submitJob, abortSelectedJob,
        launchService, restartService, revokeService, openPreview,
        openPreviewExternal, revokePreview, formatAgentSummary, formatPresetSummary,
        formatTimestamp, formatJson,
    };
}
