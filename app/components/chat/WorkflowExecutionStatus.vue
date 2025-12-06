<template>
    <div
        class="workflow-execution-status border rounded-md overflow-hidden bg-[var(--md-surface-container-lowest)] border-[var(--md-outline-variant)]"
    >
        <!-- Header -->
        <div
            class="flex items-center justify-between px-3 py-2 bg-[var(--md-surface-container)] cursor-pointer select-none hover:bg-[var(--md-surface-container-high)] transition-colors"
            @click="toggleCollapse"
        >
            <div class="flex items-center gap-2">
                <UIcon
                    :name="statusIcon"
                    class="w-5 h-5"
                    :class="statusColorClass"
                />
                <span class="font-medium text-sm">{{
                    props.workflowState.workflowName
                }}</span>
                <span class="text-xs opacity-70">({{ statusText }})</span>
            </div>
            <UIcon
                :name="collapsed ? expandIcon : collapseIcon"
                class="w-4 h-4 opacity-70"
            />
        </div>

        <!-- Content -->
        <div v-if="!collapsed" class="p-3 space-y-2">
            <!-- Node List -->
            <div
                v-for="nodeId in props.workflowState.executionOrder"
                :key="nodeId"
                class="node-item"
            >
                <details class="group" :open="isNodeOpen(nodeId)">
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
                        <span class="text-xs opacity-50 ml-auto shrink-0">{{
                            getNodeType(nodeId)
                        }}</span>
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

                        <!-- Branches (if any) -->
                        <div
                            v-if="hasBranches(nodeId)"
                            class="space-y-2 mb-2 pl-2"
                        >
                            <div
                                v-for="branch in getBranches(nodeId)"
                                :key="branch.id"
                                class="branch-item"
                            >
                                <div
                                    class="flex items-center gap-2 text-xs opacity-80 mb-1"
                                >
                                    <UIcon
                                        :name="getBranchStatusIcon(branch)"
                                        class="w-3 h-3 shrink-0"
                                        :class="getBranchStatusColor(branch)"
                                    />
                                    <span class="font-medium">{{
                                        getBranchLabel(branch)
                                    }}</span>
                                </div>
                                <div
                                    v-if="branch.streamingText || branch.output"
                                    class="pl-5 text-xs opacity-70 font-mono whitespace-pre-wrap bg-[var(--md-surface)] p-1 rounded border border-[var(--md-outline-variant)]"
                                >
                                    {{ branch.streamingText || branch.output }}
                                </div>
                            </div>
                        </div>

                        <!-- Node Output -->
                        <div class="node-output overflow-x-auto pl-2">
                            <StreamMarkdown
                                v-if="getNodeOutput(nodeId)"
                                :content="getNodeOutput(nodeId)"
                                :shiki-theme="currentShikiTheme"
                                class="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                            />
                            <div v-else class="text-xs opacity-50 italic py-1">
                                {{
                                    getNodeStatus(nodeId) === 'active'
                                        ? 'Executing...'
                                        : 'No output'
                                }}
                            </div>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
    type UiWorkflowState,
    type NodeState,
    type BranchState,
    MERGE_BRANCH_ID,
    MERGE_BRANCH_LABEL,
} from '~/utils/chat/workflow-types';
import { useIcon } from '~/composables/useIcon';
import { StreamMarkdown } from 'streamdown-vue';
import { useNuxtApp } from '#app';
import type { ThemePlugin } from '~/plugins/90.theme.client';

const props = defineProps<{
    workflowState: UiWorkflowState;
}>();

const collapsed = ref(true);
function toggleCollapse() {
    collapsed.value = !collapsed.value;
}

// Icons
const expandIcon = useIcon('shell.expand');
const collapseIcon = useIcon('shell.collapse');

const statusIcon = computed(() => {
    switch (props.workflowState.executionState) {
        case 'running':
            return useIcon('workflow.status.running').value;
        case 'completed':
            return useIcon('workflow.status.completed').value;
        case 'error':
            return useIcon('workflow.status.error').value;
        case 'stopped':
            return useIcon('workflow.status.stopped').value;
        default:
            return useIcon('workflow.status.pending').value;
    }
});

const statusColorClass = computed(() => {
    switch (props.workflowState.executionState) {
        case 'running':
            return 'text-[var(--md-primary)] animate-spin';
        case 'completed':
            return 'text-[var(--md-primary)]';
        case 'error':
            return 'text-[var(--md-error)]';
        case 'stopped':
            return 'text-[var(--md-outline)]';
        default:
            return 'text-[var(--md-outline)]';
    }
});

const statusText = computed(() => {
    return (
        props.workflowState.executionState.charAt(0).toUpperCase() +
        props.workflowState.executionState.slice(1)
    );
});

// Node Helpers
function getNode(nodeId: string): NodeState | undefined {
    return props.workflowState.nodeStates[nodeId];
}

function getNodeLabel(nodeId: string): string {
    const node = getNode(nodeId);
    return node?.label || node?.type || nodeId;
}

function getNodeType(nodeId: string): string {
    return getNode(nodeId)?.type || '';
}

function getNodeStatus(nodeId: string) {
    return getNode(nodeId)?.status || 'pending';
}

function getNodeStatusIcon(nodeId: string) {
    const status = getNodeStatus(nodeId);
    switch (status) {
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

function getNodeStatusColor(nodeId: string) {
    const status = getNodeStatus(nodeId);
    switch (status) {
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

function getNodeOutput(nodeId: string): string {
    const node = getNode(nodeId);
    return node?.streamingText || node?.output || '';
}

function getNodeError(nodeId: string): string | undefined {
    return getNode(nodeId)?.error;
}

function isNodeOpen(nodeId: string): boolean {
    const status = getNodeStatus(nodeId);
    return (
        status === 'active' ||
        status === 'error' ||
        (status === 'completed' && nodeId === props.workflowState.currentNodeId)
    );
}

// Branch Helpers
function hasBranches(nodeId: string): boolean {
    if (!props.workflowState.branches) return false;
    // Check if any branch key starts with nodeId + ':'
    return Object.keys(props.workflowState.branches).some((k) =>
        k.startsWith(nodeId + ':')
    );
}

function getBranches(nodeId: string): BranchState[] {
    if (!props.workflowState.branches) return [];
    return Object.entries(props.workflowState.branches)
        .filter(([k]) => k.startsWith(nodeId + ':'))
        .map(([_, v]) => v);
}

function getBranchLabel(branch: BranchState): string {
    if (branch.id === MERGE_BRANCH_ID) {
        return MERGE_BRANCH_LABEL;
    }
    return branch.label;
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
</script>

<style scoped>
/* Remove default details marker */
details > summary {
    list-style: none;
}
details > summary::-webkit-details-marker {
    display: none;
}
</style>
