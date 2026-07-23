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
                        <h3 class="font-bold text-base">Saved Presets</h3>
                        <p class="text-sm opacity-70">
                            Save the current agent draft and execution target as a reusable local preset for this workspace.
                        </p>
                    </div>
                    <UButton
                        class="retro-btn"
                        :disabled="presetsPending"
                        @click="refreshPresets"
                    >
                        {{ presetsPending ? 'Refreshing…' : 'Refresh Presets' }}
                    </UButton>
                </div>
            </template>

            <div class="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] text-sm">
                <div class="flex flex-col gap-2">
                    <p v-if="!presets.length" class="opacity-70">
                        No saved presets yet.
                    </p>
                    <div
                        v-for="preset in presets"
                        :key="preset.name"
                        class="flex flex-wrap items-center justify-between gap-3 rounded-none border-2 border-(--md-border-color) bg-(--md-surface) p-3"
                    >
                        <div class="min-w-0 flex flex-col gap-1">
                            <div class="font-medium break-all">{{ preset.name }}</div>
                            <div class="text-xs opacity-70">
                                {{ preset.execution_target }} · {{ preset.host_url || 'No host recorded' }}
                            </div>
                            <div class="text-xs opacity-70">
                                {{ formatPresetSummary(preset) }}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <UButton
                                :data-testid="`or3-net-preset-apply-${preset.name}`"
                                class="retro-btn"
                                :disabled="presetsPending"
                                @click="applyPreset(preset)"
                            >
                                Apply
                            </UButton>
                            <UButton
                                :data-testid="`or3-net-preset-delete-${preset.name}`"
                                class="retro-btn"
                                :disabled="presetsPending"
                                @click="deletePreset(preset.name)"
                            >
                                Delete
                            </UButton>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-3">
                    <label class="flex flex-col gap-1 max-w-sm">
                        <span class="opacity-70">Preset Name</span>
                        <input
                            v-model="presetName"
                            data-testid="or3-net-preset-name"
                            class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                            :disabled="presetsPending"
                            placeholder="Daily local agent"
                        />
                    </label>

                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            data-testid="or3-net-preset-save"
                            class="retro-btn"
                            :disabled="presetsPending"
                            @click="saveCurrentPreset"
                        >
                            {{ presetsPending ? 'Saving…' : 'Save Current Preset' }}
                        </UButton>
                        <span class="text-xs opacity-70">
                            Captures the current agent editor draft and execution target locally in this workspace DB.
                        </span>
                    </div>

                    <p v-if="presetActionMessage" class="text-xs opacity-70">
                        {{ presetActionMessage }}
                    </p>
                    <p v-if="presetActionError" class="text-sm text-(--md-error)">
                        {{ presetActionError }}
                    </p>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h3 class="font-bold text-base">Agents</h3>
                        <p class="text-sm opacity-70">
                            Manage reusable OR3 Net agent definitions for this workspace. Job submission stays freeform in the current slice.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <UButton
                            class="retro-btn"
                            :disabled="agentsPending"
                            @click="refreshAgents"
                        >
                            {{ agentsPending ? 'Refreshing…' : 'Refresh Agents' }}
                        </UButton>
                        <UButton
                            data-testid="or3-net-agent-new"
                            class="retro-btn"
                            :disabled="agentSavePending || agentDeletePending"
                            @click="startNewAgent"
                        >
                            New Agent
                        </UButton>
                    </div>
                </div>
            </template>

            <div class="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div class="flex flex-col gap-2 text-sm">
                    <p v-if="agentsError" class="text-sm text-(--md-error)">
                        {{ agentsError }}
                    </p>
                    <p v-else-if="agentsPending && !agents.length" class="opacity-70">
                        Loading agents…
                    </p>
                    <p v-else-if="!agents.length" class="opacity-70">
                        No saved agents yet. Create one to store instructions, tool policy, and node preferences in OR3 Net.
                    </p>
                    <button
                        v-for="agent in agents"
                        :key="agent.agent_id"
                        :data-testid="`or3-net-agent-select-${agent.agent_id}`"
                        type="button"
                        class="w-full rounded-none border-2 border-(--md-border-color) px-3 py-2 text-left shadow-[2px_2px_0_0_var(--md-border-color)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
                        :class="selectedAgentId === agent.agent_id ? 'bg-(--md-primary-container)' : 'bg-(--md-surface)'"
                        @click="selectAgent(agent.agent_id)"
                    >
                        <div class="flex items-center justify-between gap-3 text-sm">
                            <span class="font-medium truncate">{{ agent.name }}</span>
                            <span class="uppercase text-xs opacity-70">{{ agent.tool_policy.mode }}</span>
                        </div>
                        <div class="mt-1 text-xs opacity-70 break-all">
                            {{ agent.agent_id }}
                        </div>
                        <div class="mt-1 text-xs opacity-70">
                            {{ formatAgentSummary(agent) }}
                        </div>
                    </button>
                </div>

                <div class="flex flex-col gap-3 text-sm">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Agent ID</span>
                            <input
                                v-model="agentDraft.agent_id"
                                data-testid="or3-net-agent-id"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="selectedAgentId !== null || agentSavePending || agentDeletePending"
                                placeholder="agent_writer"
                            />
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Name</span>
                            <input
                                v-model="agentDraft.name"
                                data-testid="or3-net-agent-name"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                                placeholder="Writer Agent"
                            />
                        </label>
                    </div>

                    <label class="flex flex-col gap-1">
                        <span class="opacity-70">Instructions</span>
                        <textarea
                            v-model="agentDraft.instructions"
                            data-testid="or3-net-agent-instructions"
                            class="min-h-32 rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                            :disabled="agentSavePending || agentDeletePending"
                            placeholder="Describe the agent's role and constraints."
                        />
                    </label>

                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Tool Policy</span>
                            <select
                                v-model="agentDraft.tool_policy_mode"
                                data-testid="or3-net-agent-tool-mode"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                            >
                                <option v-for="mode in agentToolPolicyModes" :key="mode" :value="mode">
                                    {{ mode }}
                                </option>
                            </select>
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Adapter Kind</span>
                            <select
                                v-model="agentDraft.adapter_kind"
                                data-testid="or3-net-agent-adapter-kind"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                            >
                                <option value="">Any</option>
                                <option v-for="adapterKind in agentAdapterKinds" :key="adapterKind" :value="adapterKind">
                                    {{ adapterKind }}
                                </option>
                            </select>
                        </label>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Allowed Tools</span>
                            <input
                                v-model="agentDraft.allowed_tools_text"
                                data-testid="or3-net-agent-allowed-tools"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                                placeholder="read_file, grep_search"
                            />
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Blocked Tools</span>
                            <input
                                v-model="agentDraft.blocked_tools_text"
                                data-testid="or3-net-agent-blocked-tools"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                                placeholder="run_in_terminal"
                            />
                        </label>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Required Capabilities</span>
                            <input
                                v-model="agentDraft.capabilities_text"
                                data-testid="or3-net-agent-capabilities"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                                placeholder="exec, service:openclaw"
                            />
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="opacity-70">Preferred Node IDs</span>
                            <input
                                v-model="agentDraft.preferred_node_ids_text"
                                data-testid="or3-net-agent-preferred-nodes"
                                class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                                :disabled="agentSavePending || agentDeletePending"
                                placeholder="node-a, node-b"
                            />
                        </label>
                    </div>

                    <label class="flex flex-col gap-1 max-w-sm">
                        <span class="opacity-70">Isolation Class</span>
                        <input
                            v-model="agentDraft.isolation_class"
                            data-testid="or3-net-agent-isolation-class"
                            class="rounded-none border-2 border-(--md-border-color) bg-(--md-surface) px-3 py-2 text-sm outline-none focus:outline-2 focus:outline-(--md-primary)"
                            :disabled="agentSavePending || agentDeletePending"
                            placeholder="workspace"
                        />
                    </label>

                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            data-testid="or3-net-agent-save"
                            class="retro-btn"
                            :disabled="agentSavePending || agentDeletePending"
                            @click="saveAgent"
                        >
                            {{ agentSavePending ? 'Saving…' : (selectedAgentId ? 'Save Agent' : 'Create Agent') }}
                        </UButton>
                        <UButton
                            v-if="selectedAgentId"
                            data-testid="or3-net-agent-delete"
                            class="retro-btn"
                            :disabled="agentSavePending || agentDeletePending"
                            @click="deleteSelectedAgent"
                        >
                            {{ agentDeletePending ? 'Deleting…' : 'Delete Agent' }}
                        </UButton>
                        <span class="text-xs opacity-70">
                            {{ selectedAgentId ? 'Editing a saved workspace agent.' : 'New agents are created in the active workspace.' }}
                        </span>
                    </div>

                    <p v-if="agentActionMessage" class="text-xs opacity-70">
                        {{ agentActionMessage }}
                    </p>
                    <p v-if="agentActionError" class="text-sm text-(--md-error)">
                        {{ agentActionError }}
                    </p>
                </div>
            </div>
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
                        data-testid="or3-net-job-message"
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
                        data-testid="or3-net-submit-job"
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
import { useOr3NetworkPage } from '~/composables/or3-net/useOr3NetworkPage';

const {
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
} = useOr3NetworkPage();
</script>
