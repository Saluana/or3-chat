<template>
    <div class="p-4 flex flex-col gap-4">
        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h2 class="font-bold text-lg">OR3 Network</h2>
                        <p class="text-sm opacity-70">
                            Provider-agnostic control plane connection for the active workspace.
                        </p>
                    </div>
                    <UButton
                        class="retro-btn"
                        :disabled="pending"
                        @click="refreshConnection"
                    >
                        {{ pending ? 'Connecting…' : 'Refresh Token' }}
                    </UButton>
                </div>
            </template>

            <div class="grid gap-3 text-sm">
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Host</span>
                    <span class="font-medium break-all text-right">{{ hostUrl || 'Not configured' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Chat Thread</span>
                    <span class="font-medium break-all text-right">{{ activeClientSessionId || 'No active chat thread' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Workspace</span>
                    <span class="font-medium">{{ activeWorkspaceId || 'No active workspace' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Network Session</span>
                    <span class="font-medium break-all text-right">{{ networkSessionId || 'Not bound yet' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Status</span>
                    <span class="font-medium">{{ statusLabel }}</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                    <span class="opacity-70">Token Expires</span>
                    <span class="font-medium">{{ expiresAt || 'Unavailable' }}</span>
                </div>
            </div>

            <p
                v-if="connectionError"
                class="mt-4 text-sm text-(--md-error)"
            >
                {{ connectionError.message }}
            </p>
            <p
                v-else-if="sessionError"
                class="mt-4 text-sm text-(--md-error)"
            >
                {{ sessionError.message }}
            </p>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h3 class="font-bold text-base">Submit Job</h3>
                        <p class="text-sm opacity-70">
                            Uses the active chat thread as the OR3 Net client session when no binding exists yet.
                        </p>
                    </div>
                    <span class="text-xs opacity-60">{{ sessionScopeLabel }}</span>
                </div>
            </template>

            <div class="flex flex-col gap-3">
                <label class="flex flex-col gap-1 text-sm">
                    <span class="opacity-70">Message</span>
                    <textarea
                        v-model="draftMessage"
                        class="min-h-28 rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                        placeholder="Describe the job you want OR3 Net to run."
                    />
                </label>

                <label class="flex flex-col gap-1 text-sm max-w-48">
                    <span class="opacity-70">Execution Target</span>
                    <select
                        v-model="executionTarget"
                        class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                    >
                        <option value="local">Local</option>
                        <option value="remote">Remote</option>
                    </select>
                </label>

                <div class="flex items-center gap-3">
                    <UButton
                        class="retro-btn"
                        :disabled="submitDisabled"
                        @click="submitJob"
                    >
                        {{ submitPending ? 'Submitting…' : 'Submit Job' }}
                    </UButton>
                    <span class="text-xs opacity-70">{{ submitHint }}</span>
                </div>

                <p v-if="submitError" class="text-sm text-(--md-error)">
                    {{ submitError }}
                </p>
            </div>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <UCard>
                <template #header>
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <h3 class="font-bold text-base">Recent Jobs</h3>
                            <p class="text-sm opacity-70">{{ jobsScopeLabel }}</p>
                        </div>
                        <UButton
                            class="retro-btn"
                            :disabled="jobsPending"
                            @click="refreshJobs"
                        >
                            {{ jobsPending ? 'Refreshing…' : 'Refresh Jobs' }}
                        </UButton>
                    </div>
                </template>

                <div class="flex flex-col gap-2">
                    <p v-if="jobsError" class="text-sm text-(--md-error)">
                        {{ jobsError }}
                    </p>
                    <p v-else-if="jobsPending && !jobs.length" class="text-sm opacity-70">
                        Loading jobs…
                    </p>
                    <p v-else-if="!jobs.length" class="text-sm opacity-70">
                        {{ emptyJobsLabel }}
                    </p>
                    <button
                        v-for="job in jobs"
                        :key="job.job_id"
                        type="button"
                        class="w-full rounded-none border-2 border-(--md-border-color) px-3 py-2 text-left shadow-[2px_2px_0_0_var(--md-border-color)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
                        :class="selectedJobId === job.job_id ? 'bg-(--md-primary-container)' : 'bg-(--md-surface)'"
                        @click="selectedJobId = job.job_id"
                    >
                        <div class="flex items-center justify-between gap-3 text-sm">
                            <span class="font-medium truncate">{{ job.job_id }}</span>
                            <span class="uppercase text-xs opacity-70">{{ job.status }}</span>
                        </div>
                        <div class="mt-1 flex items-center justify-between gap-3 text-xs opacity-70">
                            <span>{{ formatTimestamp(job.created_at) }}</span>
                            <span>{{ job.node_id || 'Unassigned' }}</span>
                        </div>
                    </button>
                </div>
            </UCard>

            <UCard>
                <template #header>
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <h3 class="font-bold text-base">Job Detail</h3>
                            <p class="text-sm opacity-70">Inspect the selected OR3 Net job payload.</p>
                        </div>
                        <UButton
                            v-if="showAbortButton"
                            data-testid="or3-net-abort-job"
                            class="retro-btn"
                            :disabled="abortPending"
                            @click="abortSelectedJob"
                        >
                            {{ abortPending ? 'Aborting…' : 'Abort Job' }}
                        </UButton>
                    </div>
                </template>

                <div v-if="selectedJobPending" class="text-sm opacity-70">
                    Loading job detail…
                </div>
                <p v-else-if="selectedJobError" class="text-sm text-(--md-error)">
                    {{ selectedJobError }}
                </p>
                <p v-else-if="!selectedJob" class="text-sm opacity-70">
                    Select a job to inspect its status, result, and error payload.
                </p>
                <div v-else class="flex flex-col gap-3 text-sm">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div class="flex flex-col gap-1">
                            <span class="opacity-70">Job ID</span>
                            <span class="font-medium break-all">{{ selectedJob.job_id }}</span>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="opacity-70">Status</span>
                            <span class="font-medium uppercase">{{ displayedJobStatus }}</span>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="opacity-70">Created</span>
                            <span class="font-medium">{{ formatTimestamp(selectedJob.created_at) }}</span>
                        </div>
                        <div class="flex flex-col gap-1">
                            <span class="opacity-70">Completed</span>
                            <span class="font-medium">{{ formatTimestamp(selectedJob.completed_at) }}</span>
                        </div>
                    </div>

                    <div v-if="selectedJob.error" class="flex flex-col gap-1">
                        <span class="opacity-70">Error</span>
                        <pre class="overflow-x-auto rounded-none border-2 border-(--md-error) bg-(--md-surface) p-3 text-xs whitespace-pre-wrap">{{ formatJson(selectedJob.error) }}</pre>
                    </div>

                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between gap-3">
                            <span class="opacity-70">Live Stream</span>
                            <span class="text-xs opacity-70">{{ streamStatusLabel }}</span>
                        </div>
                        <pre class="min-h-32 overflow-x-auto rounded-none border-2 border-(--md-border-color) bg-(--md-surface) p-3 text-xs whitespace-pre-wrap">{{ stream.content.value || 'No live output yet.' }}</pre>
                    </div>

                    <div v-if="stream.events.value.length" class="flex flex-col gap-1">
                        <span class="opacity-70">Stream Events</span>
                        <div class="flex flex-col gap-2">
                            <div
                                v-for="(event, index) in stream.events.value"
                                :key="`${event.event}-${index}`"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-xs"
                            >
                                <div class="font-medium uppercase">{{ event.event }}</div>
                                <pre class="mt-1 whitespace-pre-wrap">{{ formatJson(event.data) }}</pre>
                            </div>
                        </div>
                    </div>

                    <p v-if="stream.error.value" class="text-sm text-(--md-error)">
                        {{ stream.error.value.message }}
                    </p>

                    <div v-if="selectedJob.result !== undefined" class="flex flex-col gap-1">
                        <span class="opacity-70">Result</span>
                        <pre class="overflow-x-auto rounded-none border-2 border-(--md-border-color) bg-(--md-surface) p-3 text-xs whitespace-pre-wrap">{{ formatJson(selectedJob.result) }}</pre>
                    </div>
                </div>
            </UCard>
        </div>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h3 class="font-bold text-base">Nodes & Services</h3>
                        <p class="text-sm opacity-70">
                            Launch approved node-backed dashboards without exposing raw tunnels or tokens.
                        </p>
                    </div>
                    <UButton
                        class="retro-btn"
                        :disabled="nodesPending"
                        @click="refreshNodes"
                    >
                        {{ nodesPending ? 'Refreshing…' : 'Refresh Nodes' }}
                    </UButton>
                </div>
            </template>

            <div class="flex flex-col gap-3 text-sm">
                <p v-if="nodesError" class="text-sm text-(--md-error)">
                    {{ nodesError }}
                </p>
                <p v-else-if="nodesPending && !nodes.length" class="opacity-70">
                    Loading nodes…
                </p>
                <p v-else-if="!nodes.length" class="opacity-70">
                    No approved nodes or advertised services are available for this workspace.
                </p>
                <div
                    v-for="node in nodes"
                    :key="node.manifest.node_id"
                    class="flex flex-col gap-3 rounded-none border-2 border-(--md-border-color) bg-(--md-surface) p-3"
                >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex flex-col gap-1">
                            <div class="font-medium break-all">{{ node.manifest.node_id }}</div>
                            <div class="text-xs opacity-70">
                                {{ node.manifest.adapter_kind }} · {{ node.health_status }} · {{ node.manifest.isolation_class }}
                            </div>
                        </div>
                        <div class="text-xs opacity-70 text-right">
                            <div>Seen {{ formatTimestamp(node.last_seen_at) }}</div>
                            <div>CPU {{ node.manifest.resource_limits.cpu_cores }} · RAM {{ node.manifest.resource_limits.memory_mb }} MB</div>
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2 text-xs opacity-80">
                        <span
                            v-for="capability in node.manifest.capabilities.slice(0, 6)"
                            :key="capability"
                            class="rounded-none border-2 border-(--md-border-color) px-2 py-1"
                        >
                            {{ capability }}
                        </span>
                    </div>

                    <p v-if="node.last_error" class="text-xs text-(--md-error)">
                        {{ node.last_error }}
                    </p>

                    <div class="flex flex-col gap-2">
                        <p v-if="!servicesByNodeId[node.manifest.node_id]?.length" class="text-xs opacity-70">
                            No advertised services for this node.
                        </p>
                        <div
                            v-for="service in servicesByNodeId[node.manifest.node_id] ?? []"
                            :key="service.service_id"
                            class="flex flex-wrap items-center justify-between gap-3 rounded-none border-2 border-(--md-border-color) px-3 py-2"
                        >
                            <div class="flex flex-col gap-1">
                                <span class="font-medium">{{ service.label }}</span>
                                <span class="text-xs opacity-70">
                                    {{ service.service_id }} · port {{ service.target_port }} · {{ service.status }}
                                </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <UButton
                                    v-if="service.launchable"
                                    :data-testid="`or3-net-launch-${node.manifest.node_id}-${service.service_id}`"
                                    class="retro-btn"
                                    :disabled="serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:launch`"
                                    @click="launchService(node.manifest.node_id, service.service_id)"
                                >
                                    {{ serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:launch` ? 'Opening…' : 'Open Dashboard' }}
                                </UButton>
                                <UButton
                                    :data-testid="`or3-net-restart-${node.manifest.node_id}-${service.service_id}`"
                                    class="retro-btn"
                                    :disabled="serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:restart`"
                                    @click="restartService(node.manifest.node_id, service.service_id)"
                                >
                                    {{ serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:restart` ? 'Restarting…' : 'Restart Service' }}
                                </UButton>
                                <UButton
                                    :data-testid="`or3-net-revoke-${node.manifest.node_id}-${service.service_id}`"
                                    class="retro-btn"
                                    :disabled="serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:revoke`"
                                    @click="revokeService(node.manifest.node_id, service.service_id)"
                                >
                                    {{ serviceActionPendingKey === `${node.manifest.node_id}:${service.service_id}:revoke` ? 'Revoking…' : 'Revoke Access' }}
                                </UButton>
                            </div>
                        </div>
                    </div>
                </div>

                <p v-if="serviceActionMessage" class="text-xs opacity-70">
                    {{ serviceActionMessage }}
                </p>
                <p v-if="serviceActionError" class="text-sm text-(--md-error)">
                    {{ serviceActionError }}
                </p>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h3 class="font-bold text-base">Previews</h3>
                        <p class="text-sm opacity-70">
                            Open iframe-safe previews in a pane and fall back to a clean external launch when embed support is absent.
                        </p>
                    </div>
                    <UButton
                        class="retro-btn"
                        :disabled="previewsPending"
                        @click="refreshPreviews"
                    >
                        {{ previewsPending ? 'Refreshing…' : 'Refresh Previews' }}
                    </UButton>
                </div>
            </template>

            <div class="flex flex-col gap-3 text-sm">
                <p v-if="previewsError" class="text-sm text-(--md-error)">
                    {{ previewsError }}
                </p>
                <p v-else-if="previewsPending && !previews.length" class="opacity-70">
                    Loading previews…
                </p>
                <p v-else-if="!previews.length" class="opacity-70">
                    No previews are published for this workspace yet.
                </p>
                <div
                    v-for="preview in previews"
                    :key="preview.preview_id"
                    class="flex flex-wrap items-center justify-between gap-3 rounded-none border-2 border-(--md-border-color) bg-(--md-surface) p-3"
                >
                    <div class="min-w-0 flex flex-col gap-1">
                        <div class="font-medium break-all">{{ preview.entry_path || preview.path || preview.preview_id }}</div>
                        <div class="text-xs opacity-70">
                            {{ preview.kind }} · {{ preview.source_type }} · {{ preview.status }}
                        </div>
                        <div class="text-xs opacity-70">
                            {{ preview.supports_iframe ? 'Embeddable preview' : 'External launch only' }}
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            :data-testid="`or3-net-preview-open-${preview.preview_id}`"
                            class="retro-btn"
                            :disabled="previewActionPendingKey === `${preview.preview_id}:open`"
                            @click="openPreview(preview)"
                        >
                            {{ previewActionPendingKey === `${preview.preview_id}:open` ? 'Opening…' : (preview.supports_iframe ? 'Open in Pane' : 'Open Preview') }}
                        </UButton>
                        <UButton
                            :data-testid="`or3-net-preview-external-${preview.preview_id}`"
                            class="retro-btn"
                            :disabled="previewActionPendingKey === `${preview.preview_id}:external`"
                            @click="openPreviewExternal(preview)"
                        >
                            {{ previewActionPendingKey === `${preview.preview_id}:external` ? 'Opening…' : 'Open in New Tab' }}
                        </UButton>
                        <UButton
                            :data-testid="`or3-net-preview-revoke-${preview.preview_id}`"
                            class="retro-btn"
                            :disabled="previewActionPendingKey === `${preview.preview_id}:revoke`"
                            @click="revokePreview(preview)"
                        >
                            {{ previewActionPendingKey === `${preview.preview_id}:revoke` ? 'Revoking…' : 'Revoke' }}
                        </UButton>
                    </div>
                </div>

                <p v-if="previewActionMessage" class="text-xs opacity-70">
                    {{ previewActionMessage }}
                </p>
                <p v-if="previewActionError" class="text-sm text-(--md-error)">
                    {{ previewActionError }}
                </p>
            </div>
        </UCard>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRuntimeConfig } from '#imports';

import { useOr3NetAuth } from '~/composables/or3-net/useOr3NetAuth';
import { useOr3NetClient } from '~/composables/or3-net/useOr3NetClient';
import { useOr3NetJobStream } from '~/composables/or3-net/useOr3NetJobStream';
import { useOr3NetPreviewPaneState } from '~/composables/or3-net/useOr3NetPreviewPaneState';
import { useOr3NetSession } from '~/composables/or3-net/useOr3NetSession';
import type {
    Or3NetJobDetail,
    Or3NetJobSummary,
    Or3NetNodeRecord,
    Or3NetPreviewDescriptor,
    Or3NetNodeService,
} from '~/composables/or3-net/types';
import { useWorkspaceManager } from '~/composables/workspace/useWorkspaceManager';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

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

watch(
    [activeWorkspaceId, networkSessionId],
    () => {
        void refreshJobs();
        void refreshNodes();
        void refreshPreviews();
    },
    { immediate: true }
);

watch(
    activeWorkspaceId,
    (nextWorkspaceId, previousWorkspaceId) => {
        if (!previousWorkspaceId || nextWorkspaceId === previousWorkspaceId) {
            return;
        }

        previewPaneState.clearWorkspace(previousWorkspaceId);
        previewActionPendingKey.value = null;
        previewActionMessage.value = null;
        previewActionError.value = null;
    }
);

watch(
    selectedJobId,
    (jobId) => {
        if (!jobId) {
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
        await Promise.all([refreshJobs(), refreshNodes(), refreshPreviews()]);
    } catch {
        return;
    }
}

async function refreshNodes(): Promise<void> {
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
        nodes.value = response.items;
        const servicesEntries = await Promise.all(
            response.items.map(async (node) => {
                const services = await client.listNodeServices(
                    workspaceId,
                    node.manifest.node_id
                );
                return [node.manifest.node_id, services.items] as const;
            })
        );
        servicesByNodeId.value = Object.fromEntries(servicesEntries);
    } catch (cause) {
        nodes.value = [];
        servicesByNodeId.value = {};
        nodesError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        nodesPending.value = false;
    }
}

async function refreshPreviews(): Promise<void> {
    const workspaceId = activeWorkspaceId.value;
    if (!workspaceId || !auth.isConfigured.value) {
        previews.value = [];
        return;
    }

    previewsPending.value = true;
    previewsError.value = null;
    try {
        const response = await client.listPreviews(workspaceId);
        previews.value = response.items;
    } catch (cause) {
        previews.value = [];
        previewsError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        previewsPending.value = false;
    }
}

async function refreshJobs(): Promise<void> {
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
        jobs.value = response.items;
        if (
            selectedJobId.value &&
            response.items.some((item) => item.job_id === selectedJobId.value)
        ) {
            return;
        }
        selectedJobId.value = response.items[0]?.job_id ?? null;
    } catch (cause) {
        jobs.value = [];
        selectedJobId.value = null;
        jobsError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
        jobsPending.value = false;
    }
}

async function loadSelectedJob(jobId: string): Promise<void> {
    selectedJobPending.value = true;
    selectedJobError.value = null;
    try {
        selectedJob.value = await client.getJob(jobId);
    } catch (cause) {
        selectedJob.value = null;
        selectedJobError.value =
            cause instanceof Error ? cause.message : String(cause);
    } finally {
        selectedJobPending.value = false;
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
        submitError.value = cause instanceof Error ? cause.message : String(cause);
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
        selectedJobError.value =
            cause instanceof Error ? cause.message : String(cause);
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
        serviceActionError.value =
            cause instanceof Error ? cause.message : String(cause);
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
        serviceActionError.value =
            cause instanceof Error ? cause.message : String(cause);
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
        serviceActionError.value =
            cause instanceof Error ? cause.message : String(cause);
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
        previewActionError.value = cause instanceof Error ? cause.message : String(cause);
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
        previewActionError.value = cause instanceof Error ? cause.message : String(cause);
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
        previewActionError.value = cause instanceof Error ? cause.message : String(cause);
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
</script>
