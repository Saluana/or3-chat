<template>
    <div
        :class="containerClasses"
        :data-context="depth > 0 ? 'subflow' : 'workflow'"
    >
        <!-- Header -->
        <div :class="headerClasses" @click="toggleCollapse">
            <div class="flex items-center gap-2">
                <UIcon
                    :name="statusIcon"
                    class="w-5 h-5"
                    :class="statusColorClass"
                />
                <span :class="headerTextClass">{{ workflowTitle }}</span>
                <span
                    v-if="depth > 0"
                    class="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]"
                >
                    Subflow
                </span>
                <span :class="statusTextClass">({{ statusText }})</span>
            </div>
            <div class="flex items-center gap-2">
                <button
                    v-if="hasPendingHitl"
                    type="button"
                    class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--md-extended-color-warning-color-container)] text-[var(--md-extended-color-warning-on-color-container)] hover:shadow-sm transition-shadow"
                    :title="pendingHitlContextLabel"
                    @click.stop="focusFirstPendingHitl"
                >
                    <UIcon
                        :name="useIcon('ui.warning').value"
                        class="w-3 h-3 shrink-0"
                    />
                    {{ pendingHitlBadgeText }}
                </button>
                <UIcon
                    :name="collapsed ? expandIcon : collapseIcon"
                    class="w-4 h-4 opacity-70"
                />
            </div>
        </div>

        <!-- Content -->
        <div v-if="!collapsed" :class="contentClasses">
            <div
                v-if="hasAttachments"
                class="rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface)] p-2 space-y-2"
            >
                <div
                    class="text-[11px] font-semibold uppercase tracking-wide opacity-70"
                >
                    Attachments
                </div>
                <div class="flex flex-wrap gap-2">
                    <!-- Image attachments -->
                    <div
                        v-for="attachment in imageAttachments"
                        :key="attachment.id"
                        class="w-12 h-12 rounded-md overflow-hidden border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]"
                    >
                        <img
                            :src="attachment.url"
                            :alt="attachment.name"
                            class="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </div>
                    <!-- File attachments (PDFs, etc.) -->
                    <div
                        v-for="attachment in fileAttachments"
                        :key="attachment.id"
                        class="w-12 h-12 rounded-md overflow-hidden border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] flex flex-col items-center justify-center gap-0.5 p-1"
                        :title="attachment.name"
                    >
                        <span
                            class="text-[8px] font-bold uppercase tracking-wide bg-black text-white px-1 py-0.5 rounded"
                        >
                            {{
                                attachment.mimeType === 'application/pdf'
                                    ? 'PDF'
                                    : 'FILE'
                            }}
                        </span>
                        <span
                            class="text-[7px] text-center line-clamp-2 leading-tight opacity-70"
                        >
                            {{ attachment.name }}
                        </span>
                    </div>
                </div>

                <div
                    v-if="imageCaption"
                    class="rounded border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-2"
                >
                    <div
                        class="text-[10px] font-semibold uppercase tracking-wide opacity-70"
                    >
                        Auto caption
                    </div>
                    <div class="text-xs whitespace-pre-wrap">
                        {{ imageCaption }}
                    </div>
                </div>
            </div>

            <!-- Node List -->
            <div
                v-for="nodeId in props.workflowState.executionOrder || []"
                :key="nodeId"
                class="node-item"
            >
                <details
                    class="group"
                    :open="isNodeOpen(nodeId)"
                    @toggle="handleNodeToggle(nodeId, $event)"
                >
                    <summary
                        class="flex items-center gap-2 cursor-pointer list-none py-1 hover:bg-[var(--md-surface-container-high)] rounded px-1 transition-colors"
                    >
                        <UIcon
                            :name="getNodeStatusIcon(nodeId)"
                            class="w-4 h-4 shrink-0"
                            :class="getNodeStatusColor(nodeId)"
                        />
                        <span class="text-sm font-medium truncate">{{
                            getNodeLabel(nodeId)
                        }}</span>
                        <span
                            v-if="getNodeAttachmentBadge(nodeId)"
                            class="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            :class="
                                getNodeAttachmentBadge(nodeId)?.variant ===
                                'image'
                                    ? 'bg-[var(--md-extended-color-info-color-container)] text-[var(--md-extended-color-info-on-color-container)]'
                                    : 'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]'
                            "
                        >
                            {{ getNodeAttachmentBadge(nodeId)?.label }}
                        </span>
                        <span class="text-xs opacity-50 ml-auto shrink-0">{{
                            getNodeType(nodeId)
                        }}</span>
                        <span
                            v-if="getNodePendingHitlCount(nodeId) > 0"
                            class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--md-extended-color-warning-color-container)] text-[var(--md-extended-color-warning-on-color-container)]"
                        >
                            Approval needed
                        </span>
                        <UIcon
                            name="i-heroicons-chevron-right"
                            class="w-3 h-3 transition-transform group-open:rotate-90 opacity-50 shrink-0"
                        />
                    </summary>

                    <div
                        class="pl-2 mt-1 text-sm border-l-2 border-[var(--md-outline-variant)] ml-2"
                    >
                        <!-- Error Banner -->
                        <div
                            v-if="getNodeError(nodeId)"
                            class="bg-[var(--md-error-container)] text-[var(--md-on-error-container)] p-2 rounded mb-2 text-xs flex items-start gap-2"
                        >
                            <UIcon
                                :name="useIcon('ui.warning').value"
                                class="w-4 h-4 shrink-0 mt-0.5"
                            />
                            <span class="whitespace-pre-wrap">{{
                                getNodeError(nodeId)
                            }}</span>
                        </div>

                        <!-- HITL Requests -->
                        <div
                            v-if="getNodeHitlRequests(nodeId).length"
                            class="space-y-2 mb-2 pl-2"
                        >
                            <div
                                v-for="request in getNodeHitlRequests(nodeId)"
                                :key="request.id"
                                class="rounded border border-[var(--md-extended-color-warning-color)] bg-[var(--md-extended-color-warning-color-container)] p-2 text-[var(--md-extended-color-warning-on-color-container)]"
                            >
                                <div class="flex items-start gap-2">
                                    <UIcon
                                        :name="useIcon('ui.warning').value"
                                        class="w-4 h-4 shrink-0 mt-0.5"
                                    />
                                    <div class="flex-1">
                                        <div
                                            class="text-[11px] font-semibold uppercase tracking-wide opacity-90"
                                        >
                                            {{ getHitlHeading(request) }}
                                        </div>
                                        <div class="text-sm font-medium">
                                            {{ request.prompt }}
                                        </div>
                                        <div class="mt-2">
                                            <div
                                                class="text-[11px] font-semibold uppercase tracking-wide opacity-90"
                                            >
                                                {{ getHitlInputLabel(request) }}
                                            </div>
                                            <div
                                                class="mt-1 text-xs font-mono whitespace-pre-wrap bg-[var(--md-surface)] text-[var(--md-on-surface)] p-2 rounded border border-[var(--md-outline-variant)] max-h-32 overflow-y-auto"
                                            >
                                                {{
                                                    getHitlInputDisplay(request)
                                                }}
                                            </div>
                                        </div>
                                        <div
                                            v-if="
                                                request.mode === 'review' ||
                                                request.context?.output
                                            "
                                            class="mt-2"
                                        >
                                            <div
                                                class="text-[11px] font-semibold uppercase tracking-wide opacity-90"
                                            >
                                                Output to review
                                            </div>
                                            <div
                                                class="mt-1 text-xs font-mono whitespace-pre-wrap bg-[var(--md-surface)] text-[var(--md-on-surface)] p-2 rounded border border-[var(--md-outline-variant)] max-h-32 overflow-y-auto"
                                            >
                                                {{
                                                    getHitlOutputDisplay(
                                                        request
                                                    )
                                                }}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div
                                    class="mt-2 flex flex-wrap items-center gap-2"
                                >
                                    <button
                                        v-for="action in getHitlActions(
                                            request
                                        )"
                                        :key="action.key"
                                        type="button"
                                        class="text-xs font-semibold px-3 py-1.5 rounded transition-shadow"
                                        :class="
                                            action.primary
                                                ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)] shadow-sm'
                                                : 'border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] text-[var(--md-on-surface)]'
                                        "
                                        @click.stop="
                                            handleHitlAction(
                                                request,
                                                action.action,
                                                action.label,
                                                action.requiresInput
                                            )
                                        "
                                    >
                                        {{ action.label }}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Tool Calls -->
                        <div
                            v-if="getNodeToolCalls(nodeId).length"
                            class="space-y-1 mb-2 pl-2"
                        >
                            <div
                                v-for="tool in getNodeToolCalls(nodeId)"
                                :key="tool.id"
                                class="flex flex-col gap-0.5"
                            >
                                <div class="flex items-center gap-2 text-xs">
                                    <UIcon
                                        :name="getToolStatusIcon(tool)"
                                        class="w-3 h-3 shrink-0"
                                        :class="getToolStatusColor(tool)"
                                    />
                                    <span class="font-medium truncate">{{
                                        tool.name
                                    }}</span>
                                    <span class="ml-auto opacity-60">{{
                                        getToolStatusText(tool.status)
                                    }}</span>
                                </div>
                                <div
                                    v-if="tool.error"
                                    class="pl-5 text-[11px] text-[var(--md-error)]"
                                >
                                    {{ tool.error }}
                                </div>
                            </div>
                        </div>

                        <!-- Branches (if any) -->
                        <div
                            v-if="hasBranches(nodeId)"
                            class="space-y-2 mb-2 pl-2"
                        >
                            <details
                                v-for="branch in getBranches(nodeId)"
                                :key="branch.id"
                                class="branch-item group"
                            >
                                <summary
                                    class="flex items-center gap-2 text-xs opacity-80 mb-1 cursor-pointer list-none hover:bg-(--md-surface-container-high) rounded px-1 py-1 transition-colors"
                                >
                                    <UIcon
                                        :name="getBranchStatusIcon(branch)"
                                        class="w-3 h-3 shrink-0"
                                        :class="getBranchStatusColor(branch)"
                                    />
                                    <span class="font-medium">{{
                                        getBranchLabel(branch)
                                    }}</span>
                                    <UIcon
                                        name="i-heroicons-chevron-right"
                                        class="w-3 h-3 transition-transform group-open:rotate-90 opacity-50 shrink-0 ml-auto"
                                    />
                                </summary>
                                <div
                                    v-if="getBranchToolCalls(branch).length"
                                    class="space-y-1 mb-2 pl-5"
                                >
                                    <div
                                        v-for="tool in getBranchToolCalls(
                                            branch
                                        )"
                                        :key="tool.id"
                                        class="flex flex-col gap-0.5"
                                    >
                                        <div
                                            class="flex items-center gap-2 text-xs"
                                        >
                                            <UIcon
                                                :name="getToolStatusIcon(tool)"
                                                class="w-3 h-3 shrink-0"
                                                :class="
                                                    getToolStatusColor(tool)
                                                "
                                            />
                                            <span
                                                class="font-medium truncate"
                                                >{{ tool.name }}</span
                                            >
                                            <span class="ml-auto opacity-60">{{
                                                getToolStatusText(tool.status)
                                            }}</span>
                                        </div>
                                        <div
                                            v-if="tool.error"
                                            class="pl-5 text-[11px] text-[var(--md-error)]"
                                        >
                                            {{ tool.error }}
                                        </div>
                                    </div>
                                </div>
                                <div
                                    v-if="getBranchContent(branch)"
                                    class="pl-5 text-xs opacity-70 font-mono whitespace-pre-wrap bg-(--md-surface) p-1 rounded border border-(--md-outline-variant) max-h-48 overflow-y-auto"
                                >
                                    {{ getBranchContent(branch) }}
                                </div>
                            </details>
                        </div>

                        <!-- Node Output -->
                        <div
                            class="node-output overflow-x-auto pl-2 max-h-68 overflow-y-auto"
                        >
                            <template v-if="getNodeOutput(nodeId)">
                                <pre
                                    v-if="isNodeStreaming(nodeId)"
                                    class="streaming-plain font-mono text-xs whitespace-pre-wrap bg-(--md-surface) p-2 rounded border border-(--md-outline-variant) leading-normal"
                                >
                                    {{ getNodeOutput(nodeId) }}
                                </pre>
                                <StreamMarkdown
                                    v-else
                                    :content="getNodeOutput(nodeId)"
                                    :shiki-theme="currentShikiTheme"
                                    class="cm-markdown-assistant prose max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 w-full min-w-full or3-prose prose-pre:max-w-full prose-pre:overflow-x-auto leading-normal prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] dark:text-white/95 dark:prose-headings:text-white/95! prose-pre:bg-(--md-surface-container)/80 prose-pre:border-(--md-border-color) prose-pre:text-(--md-on-surface) prose-pre:font-[inherit] prose-code:text-(--md-on-surface) prose-code:font-[inherit]"
                                />
                            </template>
                            <div v-else class="text-xs opacity-50 italic py-1">
                                {{
                                    getNodeStatus(nodeId) === 'active'
                                        ? 'Executing...'
                                        : getNodeStatus(nodeId) === 'waiting'
                                        ? getNodeWaitingText(nodeId)
                                        : 'No output'
                                }}
                            </div>
                        </div>

                        <div v-if="getNodeSubflowState(nodeId)" class="mt-3">
                            <WorkflowExecutionStatus
                                :workflow-state="
                                    getNodeSubflowState(nodeId)!
                                "
                                :depth="depth + 1"
                                :focus-path="getChildFocusPath(nodeId)"
                            />
                        </div>
                    </div>
                </details>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import {
    type UiWorkflowState,
    type NodeState,
    type BranchState,
    type ToolCallState,
    type HitlRequestState,
    type HitlAction,
    MERGE_BRANCH_ID,
    MERGE_BRANCH_LABEL,
} from '~/utils/chat/workflow-types';
import { modelRegistry } from 'or3-workflow-core';
import { useIcon } from '~/composables/useIcon';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import { useNuxtApp } from '#app';
import type { ThemePlugin } from '~/theme/_shared/types';
import { useToast } from '#imports';

defineOptions({ name: 'WorkflowExecutionStatus' });

const props = defineProps<{
    workflowState: UiWorkflowState;
    depth?: number;
    focusPath?: string[];
}>();

const depth = computed(() => props.depth ?? 0);
const collapsed = ref(depth.value === 0);
const openNodes = ref<Record<string, boolean>>({});
const focusNodeId = ref<string | null>(null);
const focusNodePath = ref<string[] | null>(null);
function toggleCollapse() {
    collapsed.value = !collapsed.value;
}

const workflowTitle = computed(
    () => props.workflowState.workflowName || 'Workflow'
);
const containerClasses = computed(() =>
    [
        'workflow-execution-status border rounded-md overflow-hidden border-[var(--md-outline-variant)]',
        depth.value > 0
            ? 'bg-[var(--md-surface-container-low)] ml-2'
            : 'bg-[var(--md-surface-container-lowest)]',
    ].join(' ')
);
const headerClasses = computed(() =>
    [
        'flex items-center justify-between cursor-pointer select-none transition-colors',
        depth.value > 0
            ? 'px-2 py-1 bg-[var(--md-surface-container-high)] hover:bg-[var(--md-surface-container)]'
            : 'px-3 py-2 bg-[var(--md-surface-container)] hover:bg-[var(--md-surface-container-high)]',
    ].join(' ')
);
const contentClasses = computed(() =>
    depth.value > 0 ? 'p-2 space-y-2' : 'p-3 space-y-2'
);
const headerTextClass = computed(() =>
    ['font-medium', depth.value > 0 ? 'text-xs' : 'text-sm'].join(' ')
);
const statusTextClass = computed(() =>
    [depth.value > 0 ? 'text-[10px]' : 'text-xs', 'opacity-70'].join(' ')
);

function buildAttachmentUrl(attachment: {
    url?: string;
    content?: string;
    mimeType?: string;
}): string | null {
    if (attachment.url) return attachment.url;
    if (attachment.content && attachment.mimeType) {
        return `data:${attachment.mimeType};base64,${attachment.content}`;
    }
    return null;
}

const imageAttachments = computed(() => {
    const attachments = props.workflowState.attachments || [];
    return attachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => {
            const url = buildAttachmentUrl(attachment);
            if (!url) return null;
            return {
                id: attachment.id,
                url,
                name: attachment.name || 'Image',
            };
        })
        .filter(
            (
                attachment
            ): attachment is { id: string; url: string; name: string } =>
                Boolean(attachment)
        );
});

const fileAttachments = computed(() => {
    const attachments = props.workflowState.attachments || [];
    return attachments
        .filter((attachment) => attachment.type === 'file')
        .map((attachment) => ({
            id: attachment.id,
            name: attachment.name || 'File',
            mimeType: attachment.mimeType || 'application/octet-stream',
        }));
});

const hasAttachments = computed(
    () => imageAttachments.value.length > 0 || fileAttachments.value.length > 0
);
const imageCaption = computed(() => props.workflowState.imageCaption || '');

type PendingHitlEntry = {
    request: HitlRequestState;
    path: string[];
    workflowName: string;
};

function collectPendingHitl(
    state: UiWorkflowState,
    path: string[] = []
): PendingHitlEntry[] {
    const entries: PendingHitlEntry[] = [];
    if (state.hitlRequests) {
        for (const request of Object.values(state.hitlRequests)) {
            entries.push({
                request,
                path,
                workflowName: state.workflowName,
            });
        }
    }

    for (const [nodeId, node] of Object.entries(state.nodeStates)) {
        if (node.subflowState) {
            entries.push(
                ...collectPendingHitl(node.subflowState, [...path, nodeId])
            );
        }
    }

    return entries;
}

const pendingHitlRequests = computed(() =>
    collectPendingHitl(props.workflowState)
);
const pendingHitlCount = computed(() => pendingHitlRequests.value.length);
const hasPendingHitl = computed(() => pendingHitlCount.value > 0);
const pendingHitlBadge = computed(() => {
    if (!hasPendingHitl.value) return '';
    const modes = new Set(
        pendingHitlRequests.value.map((entry) => entry.request.mode)
    );
    if (modes.size === 1) {
        const mode = [...modes][0];
        if (mode === 'approval') return 'Approval needed';
        if (mode === 'input') return 'Input needed';
        if (mode === 'review') return 'Review needed';
    }
    return 'Action required';
});
const pendingHitlBadgeText = computed(() => {
    if (!hasPendingHitl.value) return '';
    if (pendingHitlCount.value > 1) {
        return `${pendingHitlBadge.value} (${pendingHitlCount.value})`;
    }
    return pendingHitlBadge.value;
});
const pendingHitlStatusText = computed(() => {
    if (!hasPendingHitl.value) return '';
    const modes = new Set(
        pendingHitlRequests.value.map((entry) => entry.request.mode)
    );
    if (modes.size === 1) {
        const mode = [...modes][0];
        if (mode === 'approval') return 'Awaiting approval';
        if (mode === 'input') return 'Awaiting input';
        if (mode === 'review') return 'Awaiting review';
    }
    return 'Action required';
});

const toast = useToast();
const seenHitlRequests = new Set<string>();

watch(
    pendingHitlRequests,
    (next) => {
        if (depth.value !== 0 || !import.meta.client) return;
        for (const entry of next) {
            if (seenHitlRequests.has(entry.request.id)) continue;
            seenHitlRequests.add(entry.request.id);
            toast.add({
                id: `hitl-${entry.request.id}`,
                title: pendingHitlBadge.value || 'Approval needed',
                description: getPendingHitlContextLabel(entry),
                color: 'warning',
                icon: useIcon('ui.warning').value,
                actions: [
                    {
                        label: 'Review',
                        size: 'sm',
                        variant: 'soft',
                        color: 'warning',
                        class: 'whitespace-nowrap w-auto px-3',
                        onClick: () => {
                            focusHitlPath(buildFocusPath(entry));
                        },
                    },
                ],
            });
        }
    },
    { immediate: true, deep: true }
);

watch(
    () => props.focusPath,
    (path) => {
        if (!path || path.length === 0) return;
        focusHitlPath(path);
    },
    { immediate: true }
);

// Icons
const expandIcon = useIcon('shell.expand');
const collapseIcon = useIcon('shell.collapse');

const statusIcon = computed(() => {
    if (hasPendingHitl.value) {
        return useIcon('workflow.status.pending').value;
    }
    switch (props.workflowState.executionState) {
        case 'running':
            return useIcon('workflow.status.running').value;
        case 'completed':
            return useIcon('workflow.status.completed').value;
        case 'error':
            return useIcon('workflow.status.error').value;
        case 'stopped':
        case 'interrupted':
            return useIcon('workflow.status.stopped').value;
        default:
            return useIcon('workflow.status.pending').value;
    }
});

const statusColorClass = computed(() => {
    if (hasPendingHitl.value) {
        return 'text-[var(--md-extended-color-warning-color)] animate-pulse';
    }
    switch (props.workflowState.executionState) {
        case 'running':
            return 'text-[var(--md-primary)] animate-spin';
        case 'completed':
            return 'text-[var(--md-primary)]';
        case 'error':
            return 'text-[var(--md-error)]';
        case 'stopped':
        case 'interrupted':
            return 'text-[var(--md-outline)]';
        default:
            return 'text-[var(--md-outline)]';
    }
});

const statusText = computed(() => {
    if (hasPendingHitl.value) {
        return pendingHitlStatusText.value;
    }
    const state = props.workflowState.executionState;
    if (!state) return 'Unknown';
    return state.charAt(0).toUpperCase() + state.slice(1);
});

// Node Helpers
function getNode(nodeId: string): NodeState | undefined {
    return props.workflowState.nodeStates[nodeId];
}

function getNodeSubflowState(nodeId: string): UiWorkflowState | undefined {
    return getNode(nodeId)?.subflowState;
}

function getNodeLabel(nodeId: string): string {
    const node = getNode(nodeId);
    return node?.label || node?.type || nodeId;
}

function getNodeType(nodeId: string): string {
    return getNode(nodeId)?.type || '';
}

function getNodeModelId(nodeId: string): string | undefined {
    return getNode(nodeId)?.modelId;
}

function nodeSupportsImages(modelId?: string): boolean {
    if (!modelId) return false;
    try {
        return modelRegistry.supportsInputModality(modelId, 'image');
    } catch {
        return false;
    }
}

function getNodeAttachmentBadge(
    nodeId: string
): { label: string; variant: 'image' | 'caption' } | null {
    if (!hasAttachments.value) return null;
    const modelId = getNodeModelId(nodeId);
    if (!modelId) return null;
    if (nodeSupportsImages(modelId)) {
        return { label: 'Images', variant: 'image' };
    }
    if (imageCaption.value) {
        return { label: 'Caption', variant: 'caption' };
    }
    return null;
}

function getNodeStatus(nodeId: string) {
    return getNode(nodeId)?.status || 'pending';
}

function getNodeStatusIcon(nodeId: string) {
    const status = getNodeStatus(nodeId);
    const execState = props.workflowState.executionState;
    // If workflow is interrupted/stopped/error but node still shows active, treat as stopped
    if (
        status === 'active' &&
        (execState === 'interrupted' ||
            execState === 'stopped' ||
            execState === 'error')
    ) {
        return useIcon('workflow.status.stopped').value;
    }
    switch (status) {
        case 'active':
            return useIcon('workflow.status.running').value;
        case 'waiting':
            return useIcon('workflow.status.pending').value;
        case 'completed':
            return useIcon('workflow.status.completed').value;
        case 'error':
            return useIcon('workflow.status.error').value;
        default:
            return useIcon('workflow.status.pending').value;
    }
}

function getNodeStatusColor(nodeId: string) {
    const status = getNodeStatus(nodeId);
    const execState = props.workflowState.executionState;
    // If workflow is interrupted/stopped/error but node still shows active, treat as stopped
    if (
        status === 'active' &&
        (execState === 'interrupted' ||
            execState === 'stopped' ||
            execState === 'error')
    ) {
        return 'text-[var(--md-outline)]';
    }
    switch (status) {
        case 'active':
            return 'text-[var(--md-primary)] animate-spin';
        case 'waiting':
            return 'text-[var(--md-extended-color-warning-color)] animate-pulse';
        case 'completed':
            return 'text-[var(--md-primary)]';
        case 'error':
            return 'text-[var(--md-error)]';
        default:
            return 'text-[var(--md-outline)] opacity-50';
    }
}

function getNodeOutput(nodeId: string): string {
    const node = getNode(nodeId);
    return node?.streamingText || node?.output || '';
}

function isNodeStreaming(nodeId: string): boolean {
    const node = getNode(nodeId);
    // A node is streaming if it has streamingText and status is active
    return !!(node?.streamingText && node.status === 'active');
}

function getNodeError(nodeId: string): string | undefined {
    return getNode(nodeId)?.error;
}

function getNodeToolCalls(nodeId: string): ToolCallState[] {
    return getNode(nodeId)?.toolCalls || [];
}

function getNodeHitlRequests(nodeId: string): HitlRequestState[] {
    const requests = props.workflowState.hitlRequests;
    if (!requests) return [];
    return Object.values(requests).filter((req) => req.nodeId === nodeId);
}

function getNodePendingHitlCount(nodeId: string): number {
    const localCount = getNodeHitlRequests(nodeId).length;
    const subflowState = getNodeSubflowState(nodeId);
    const nestedCount = subflowState
        ? collectPendingHitl(subflowState).length
        : 0;
    return localCount + nestedCount;
}

function isNodeOpen(nodeId: string): boolean {
    const stored = openNodes.value[nodeId];
    if (stored !== undefined) return stored;
    const status = getNodeStatus(nodeId);
    return status === 'waiting' || status === 'active';
}

function handleNodeToggle(nodeId: string, event: Event) {
    const target = event.target as HTMLDetailsElement | null;
    if (!target) return;
    openNodes.value = { ...openNodes.value, [nodeId]: target.open };
}

function getNodeWaitingText(nodeId: string): string {
    const requests = getNodeHitlRequests(nodeId);
    if (!requests.length) return 'Waiting for input...';
    const modes = new Set(requests.map((req) => req.mode));
    if (modes.size === 1) {
        const mode = [...modes][0];
        if (mode === 'approval') return 'Waiting for approval...';
        if (mode === 'input') return 'Waiting for input...';
        if (mode === 'review') return 'Waiting for review...';
    }
    return 'Waiting for action...';
}

function buildFocusPath(entry: PendingHitlEntry): string[] {
    return [...entry.path, entry.request.nodeId];
}

function focusHitlPath(path: string[]) {
    if (!path.length) return;
    collapsed.value = false;
    const [nodeId, ...rest] = path;
    if (!nodeId) return;
    openNodes.value = { ...openNodes.value, [nodeId]: true };
    focusNodeId.value = nodeId;
    focusNodePath.value = rest.length ? rest : null;
}

function focusFirstPendingHitl() {
    const entry = pendingHitlRequests.value[0];
    if (!entry) return;
    focusHitlPath(buildFocusPath(entry));
}

function getChildFocusPath(nodeId: string): string[] | undefined {
    if (focusNodeId.value !== nodeId || !focusNodePath.value) return;
    return focusNodePath.value;
}

function getPendingHitlContextLabel(entry: PendingHitlEntry): string {
    const labels: string[] = [];
    let current = props.workflowState;
    for (const segment of entry.path) {
        const node = current.nodeStates[segment];
        labels.push(node?.label || segment);
        if (node?.subflowState) {
            current = node.subflowState;
        }
    }
    labels.push(entry.request.nodeLabel || entry.request.nodeId);
    return labels.join(' › ');
}

const pendingHitlContextLabel = computed(() => {
    const entry = pendingHitlRequests.value[0];
    if (!entry) return '';
    return getPendingHitlContextLabel(entry);
});

// Branch Helpers
function hasBranches(nodeId: string): boolean {
    if (!props.workflowState.branches) return false;
    // Check if any branch key starts with nodeId + ':'
    return Object.keys(props.workflowState.branches || {}).some((k) =>
        k.startsWith(nodeId + ':')
    );
}

function getBranches(nodeId: string): BranchState[] {
    if (!props.workflowState.branches) return [];
    return Object.entries(props.workflowState.branches)
        .filter(([k]) => k.startsWith(nodeId + ':'))
        .map(([_, v]) => v)
        .filter((b) => b.id !== MERGE_BRANCH_ID);
}

function getBranchLabel(branch: BranchState): string {
    if (branch.id === MERGE_BRANCH_ID) {
        return branch.status === 'completed' ? 'Merge' : MERGE_BRANCH_LABEL;
    }
    return branch.label;
}

function getBranchContent(branch: BranchState): string {
    if (branch.id === MERGE_BRANCH_ID) return '';
    // Prefer output when present, otherwise show streaming text
    return branch.output || branch.streamingText || '';
}

function getBranchStatusIcon(branch: BranchState) {
    switch (branch.status) {
        case 'active':
            return useIcon('workflow.status.running').value;
        case 'completed':
            return useIcon('workflow.status.completed').value;
        default:
            return useIcon('workflow.status.pending').value;
    }
}

function getBranchStatusColor(branch: BranchState) {
    switch (branch.status) {
        case 'active':
            return 'text-[var(--md-primary)] animate-spin';
        case 'completed':
            return 'text-[var(--md-primary)]';
        default:
            return 'text-[var(--md-outline)] opacity-50';
    }
}

function getBranchToolCalls(branch: BranchState): ToolCallState[] {
    return branch.toolCalls || [];
}

function getToolStatusIcon(tool: ToolCallState) {
    switch (tool.status) {
        case 'active':
            return useIcon('workflow.status.running').value;
        case 'completed':
            return useIcon('workflow.status.completed').value;
        case 'error':
            return useIcon('workflow.status.error').value;
        default:
            return useIcon('workflow.status.pending').value;
    }
}

function getToolStatusColor(tool: ToolCallState) {
    switch (tool.status) {
        case 'active':
            return 'text-[var(--md-primary)] animate-spin';
        case 'completed':
            return 'text-[var(--md-primary)]';
        case 'error':
            return 'text-[var(--md-error)]';
        default:
            return 'text-[var(--md-outline)] opacity-50';
    }
}

function getToolStatusText(status: ToolCallState['status']): string {
    switch (status) {
        case 'active':
            return 'Running';
        case 'completed':
            return 'Succeeded';
        case 'error':
            return 'Failed';
        default:
            return 'Pending';
    }
}

type HitlActionDescriptor = {
    key: string;
    label: string;
    action: HitlAction;
    requiresInput?: boolean;
    primary?: boolean;
};

function getHitlHeading(request: HitlRequestState): string {
    switch (request.mode) {
        case 'approval':
            return 'Approval Required';
        case 'input':
            return 'Input Required';
        case 'review':
            return 'Review Required';
        default:
            return 'Action Required';
    }
}

function getHitlActions(request: HitlRequestState): HitlActionDescriptor[] {
    if (request.mode === 'input') {
        const actions: HitlActionDescriptor[] = [
            {
                key: `${request.id}-submit`,
                label: 'Provide Input',
                action: 'submit',
                requiresInput: true,
                primary: true,
            },
            {
                key: `${request.id}-skip`,
                label: 'Skip',
                action: 'skip',
            },
        ];
        return actions;
    }

    if (request.mode === 'review') {
        const actions: HitlActionDescriptor[] = [
            {
                key: `${request.id}-approve`,
                label: 'Review & Approve',
                action: 'approve',
                primary: true,
            },
            {
                key: `${request.id}-modify`,
                label: 'Edit Output',
                action: 'modify',
                requiresInput: true,
            },
        ];
        return actions;
    }

    const options: HitlActionDescriptor[] = request.options?.length
        ? request.options.map(
              (option): HitlActionDescriptor => ({
                  key: `${request.id}-${option.id}`,
                  label:
                      option.action === 'approve'
                          ? 'Review & Approve'
                          : option.action === 'reject'
                          ? 'Reject & Stop'
                          : option.label,
                  action: option.action,
                  primary: option.action === 'approve',
                  requiresInput: option.action === 'custom',
              })
          )
        : [
              {
                  key: `${request.id}-approve`,
                  label: 'Review & Approve',
                  action: 'approve',
                  primary: true,
              },
              {
                  key: `${request.id}-reject`,
                  label: 'Reject & Stop',
                  action: 'reject',
              },
          ];

    return options;
}

function getHitlInputDisplay(request: HitlRequestState): string {
    const input = request.context?.input ?? props.workflowState.prompt ?? '';
    if (typeof input === 'string' && input.trim().length > 0) {
        return input;
    }
    return '(no input provided)';
}

function getHitlOutputDisplay(request: HitlRequestState): string {
    const output = request.context?.output;
    if (typeof output === 'string' && output.trim().length > 0) {
        return output;
    }
    return '(no output provided)';
}

function getHitlInputLabel(request: HitlRequestState): string {
    switch (request.mode) {
        case 'approval':
            return 'Input to approve';
        case 'input':
            return 'Input provided';
        case 'review':
            return 'Input context';
        default:
            return 'Input';
    }
}

function handleHitlAction(
    request: HitlRequestState,
    action: HitlAction,
    label: string,
    requiresInput?: boolean
) {
    const workflowSlash = nuxtApp.$workflowSlash;

    if (!workflowSlash?.respondHitl) return;

    if (
        requiresInput ||
        action === 'submit' ||
        action === 'modify' ||
        action === 'custom'
    ) {
        if (typeof window === 'undefined') return;
        const defaultValue =
            request.mode === 'review'
                ? request.context?.output
                : request.context?.input;
        const promptLabel = label || request.prompt;
        const response = window.prompt(promptLabel, defaultValue || '');
        if (response === null) return;
        workflowSlash.respondHitl(request.id, action, response);
        return;
    }

    workflowSlash.respondHitl(request.id, action);
}

// Theme
const nuxtApp = useNuxtApp();
const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
const currentShikiTheme = computed(() => {
    const themeObj = themePlugin.value;
    const themeName = themeObj.current?.value ?? themeObj.get();
    return String(themeName).startsWith('dark')
        ? 'github-dark'
        : 'github-light';
});

onMounted(async () => {
    // Preload shiki themes for code highlighting
    await useShikiHighlighter();
});
</script>

<style scoped>
@import '~/assets/css/or3-prose.css';
/* Remove default details marker */
details > summary {
    list-style: none;
}
details > summary::-webkit-details-marker {
    display: none;
}
</style>
