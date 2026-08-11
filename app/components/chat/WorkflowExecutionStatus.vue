<template>
  <section
    class="workflow-run"
    :class="{ 'is-mobile-inspector-open': mobileInspectorOpen }"
    :data-context="depth > 0 ? 'subflow' : 'workflow'"
    :data-state="props.workflowState.executionState"
  >
    <header class="run-header">
      <div class="run-title-row">
        <UIcon
          :name="statusIcon"
          class="run-status-icon"
          :class="statusColorClass"
        />
        <div class="run-title-block">
          <div class="run-title-line">
            <h3 class="run-title">{{ workflowTitle }}</h3>
            <span v-if="depth > 0" class="run-subflow-badge">Subflow</span>
          </div>
          <div class="run-meta" aria-live="polite">
            <span class="run-meta-status">{{ statusText }}</span>
            <span class="run-meta-status-separator" aria-hidden="true">·</span>
            <span
              >{{ completedNodeCount }} / {{ totalNodeCount }} complete</span
            >
            <span class="run-meta-elapsed-separator" aria-hidden="true">·</span>
            <span class="run-meta-elapsed">{{ elapsedText }} elapsed</span>
          </div>
        </div>
        <span class="run-state-badge">{{ statusText }}</span>
        <button
          v-if="canResume"
          type="button"
          class="run-resume-button"
          aria-label="Resume workflow"
          :disabled="resumeDisabled"
          @click="emit('resume')"
        >
          <UIcon :name="resumeIcon" class="size-3.5" />
          <span class="run-resume-label">Resume</span>
        </button>
        <button
          v-if="hasPendingHitl"
          type="button"
          class="run-hitl-button"
          :title="pendingHitlContextLabel"
          @click="focusFirstPendingHitl"
        >
          <UIcon :name="warningIcon" class="size-3.5" />
          {{ pendingHitlBadgeText }}
        </button>
        <button
          type="button"
          class="run-collapse-button"
          :aria-expanded="!collapsed"
          :aria-label="collapsed ? 'Show run details' : 'Hide run details'"
          @click="toggleCollapse"
        >
          <UIcon
            :name="collapsed ? runExpandIcon : runCollapseIcon"
            class="size-4"
          />
        </button>
      </div>
      <div
        v-if="!collapsed && props.workflowState.executionState !== 'completed'"
        class="run-progress"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: `${progressPercent}%` }" />
      </div>
    </header>

    <div v-if="!collapsed" class="run-body">
      <div
        class="run-layout"
        :class="{
          'is-timeline-collapsed': timelineCollapsed,
          'is-mobile-inspector': mobileInspectorOpen,
        }"
      >
        <nav class="run-timeline" aria-label="Workflow run timeline">
          <div class="timeline-content">
            <div class="timeline-heading">
              <span>Run timeline</span>
              <button
                v-if="showFollowCurrent"
                type="button"
                class="follow-current-button"
                title="Select the currently running step"
                @click="followCurrentNode"
              >
                <UIcon :name="followCurrentIcon" class="size-3" />
                <span>Follow current</span>
              </button>
            </div>
            <ol class="timeline-list">
              <li
                v-for="item in timelineItems"
                :key="item.nodeId"
                class="timeline-item"
              >
                <div v-if="item.showPhase" class="timeline-phase">
                  {{ item.phase }}
                </div>
                <button
                  type="button"
                  class="timeline-row node-item"
                  :class="{
                    'is-selected': selectedNodeId === item.nodeId,
                  }"
                  :data-status="getNodeStatus(item.nodeId)"
                  @click="selectNode(item.nodeId)"
                >
                  <UIcon
                    :name="getNodeStatusIcon(item.nodeId)"
                    class="timeline-status-icon"
                    :class="getNodeStatusColor(item.nodeId)"
                  />
                  <span class="timeline-copy">
                    <span class="timeline-label">{{
                      getNodeLabel(item.nodeId)
                    }}</span>
                    <span
                      v-if="shouldShowNodeActivity(item.nodeId)"
                      class="timeline-activity"
                    >
                      {{ getNodeTimelineText(item.nodeId) }}
                    </span>
                  </span>
                  <span
                    v-if="getNodePendingHitlCount(item.nodeId) > 0"
                    class="timeline-action-badge"
                  >
                    Action needed
                  </span>
                  <span class="timeline-duration">{{
                    getNodeDurationText(item.nodeId)
                  }}</span>
                </button>
              </li>
            </ol>
          </div>
          <button
            type="button"
            class="timeline-divider-toggle"
            :aria-label="
              timelineCollapsed
                ? 'Expand run timeline'
                : 'Collapse run timeline'
            "
            :title="
              timelineCollapsed
                ? 'Expand run timeline'
                : 'Collapse run timeline'
            "
            @click="timelineCollapsed = !timelineCollapsed"
          >
            <UIcon
              :name="
                timelineCollapsed ? timelineExpandIcon : timelineCollapseIcon
              "
              class="size-3"
            />
          </button>
        </nav>

        <article v-if="selectedNode" class="run-inspector">
          <header class="inspector-header">
            <button
              type="button"
              class="mobile-timeline-back"
              aria-label="Back to run timeline"
              @click="mobileInspectorOpen = false"
            >
              <UIcon :name="timelineCollapseIcon" class="size-4" />
              <span>Timeline</span>
            </button>
            <div class="inspector-heading-row">
              <div class="inspector-title-block">
                <h4>{{ selectedNode.label }}</h4>
                <div class="inspector-subtitle">
                  <span>{{ humanizeNodeStatus(selectedNode.status) }}</span>
                  <span v-if="selectedNode.modelId"
                    >· {{ displayModelName(selectedNode.modelId) }}</span
                  >
                  <span v-if="selectedDurationText"
                    >· {{ selectedDurationText }}</span
                  >
                </div>
              </div>
            </div>
            <div
              class="inspector-tabs"
              role="tablist"
              aria-label="Node details"
            >
              <button
                v-for="tab in inspectorTabs"
                :key="tab.id"
                type="button"
                role="tab"
                :aria-selected="selectedTab === tab.id"
                :class="{ 'is-active': selectedTab === tab.id }"
                @click="selectedTab = tab.id"
              >
                {{ tab.label }}
                <span
                  v-if="
                    tab.id === 'reasoning' &&
                    selectedNode.status === 'active' &&
                    props.workflowState.executionState === 'running'
                  "
                  class="reasoning-live-label"
                >
                  <span class="live-dot" /> Live
                </span>
              </button>
            </div>
          </header>

          <div class="inspector-content">
            <div v-if="getNodeError(selectedNodeId!)" class="inspector-error">
              <UIcon :name="warningIcon" class="size-4 shrink-0" />
              <span>{{ getNodeError(selectedNodeId!) }}</span>
            </div>

            <div
              v-for="request in getNodeHitlRequests(selectedNodeId!)"
              :key="request.id"
              class="inspector-hitl"
            >
              <div class="inspector-hitl-title">
                {{ getHitlHeading(request) }}
              </div>
              <p>{{ request.prompt }}</p>
              <details>
                <summary>
                  {{ getHitlInputLabel(request) }}
                </summary>
                <pre>{{ getHitlInputDisplay(request) }}</pre>
              </details>
              <details
                v-if="request.mode === 'review' || request.context?.output"
              >
                <summary>Output to review</summary>
                <pre>{{ getHitlOutputDisplay(request) }}</pre>
              </details>
              <div class="inspector-hitl-actions">
                <button
                  v-for="action in getHitlActions(request)"
                  :key="action.key"
                  type="button"
                  :class="{ 'is-primary': action.primary }"
                  @click="
                    handleHitlAction(
                      request,
                      action.action,
                      action.label,
                      action.requiresInput,
                    )
                  "
                >
                  {{ action.label }}
                </button>
              </div>
            </div>

            <template v-if="selectedTab === 'output'">
              <div v-if="selectedNodeOutput" class="inspector-output">
                <pre
                  v-if="isNodeStreaming(selectedNodeId!)"
                  class="streaming-plain"
                  >{{ selectedNodeOutput }}</pre
                >
                <StreamMarkdown
                  v-else
                  :content="selectedNodeOutput"
                  :shiki-theme="currentShikiTheme"
                  class="cm-markdown-assistant or3-prose prose max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                />
              </div>
              <div v-else class="inspector-empty">
                <UIcon
                  :name="getNodeStatusIcon(selectedNodeId!)"
                  class="size-4"
                  :class="getNodeStatusColor(selectedNodeId!)"
                />
                <span>{{ getNodeEmptyOutputText(selectedNodeId!) }}</span>
                <button
                  v-if="selectedNode.reasoningText"
                  type="button"
                  @click="selectedTab = 'reasoning'"
                >
                  View live reasoning
                </button>
              </div>

              <div v-if="selectedBranches.length" class="inspector-branches">
                <details v-for="branch in selectedBranches" :key="branch.id">
                  <summary>
                    <UIcon
                      :name="getBranchStatusIcon(branch)"
                      :class="getBranchStatusColor(branch)"
                    />
                    <span>{{ getBranchLabel(branch) }}</span>
                  </summary>
                  <pre v-if="getBranchContent(branch)">{{
                    getBranchContent(branch)
                  }}</pre>
                  <pre v-if="branch.reasoningText" class="branch-reasoning">{{
                    branch.reasoningText
                  }}</pre>
                </details>
              </div>

              <WorkflowExecutionStatus
                v-if="selectedNode.subflowState"
                :workflow-state="selectedNode.subflowState"
                :depth="depth + 1"
                :focus-path="getChildFocusPath(selectedNodeId!)"
              />
            </template>

            <template v-else-if="selectedTab === 'reasoning'">
              <div v-if="selectedNode.reasoningText" class="reasoning-panel">
                <div
                  v-if="selectedNode.reasoningTruncated"
                  class="trace-notice"
                >
                  Showing the latest reasoning from this step.
                </div>
                <pre>{{ selectedNode.reasoningText }}</pre>
                <div
                  v-if="
                    selectedNode.status === 'active' &&
                    props.workflowState.executionState === 'running'
                  "
                  class="reasoning-live-status"
                >
                  <span class="live-dot" /> Receiving reasoning…
                </div>
              </div>
              <div v-else class="inspector-empty">
                <UIcon
                  :name="getNodeStatusIcon(selectedNodeId!)"
                  class="size-4"
                  :class="getNodeStatusColor(selectedNodeId!)"
                />
                <span>{{
                  selectedNode.status === "active"
                    ? "Waiting for the model reasoning stream…"
                    : "No reasoning trace was provided for this step."
                }}</span>
              </div>
            </template>

            <template v-else>
              <div class="node-details-sections">
                <section
                  v-if="
                    selectedDurationText ||
                    selectedNode.tokenCount ||
                    selectedNode.route
                  "
                  class="node-details-section"
                >
                  <h5>Execution</h5>
                  <dl class="node-details-list">
                    <div v-if="selectedDurationText">
                      <dt>Duration</dt>
                      <dd>{{ selectedDurationText }}</dd>
                    </div>
                    <div v-if="selectedNode.tokenCount">
                      <dt>Stream chunks</dt>
                      <dd>
                        {{ selectedNode.tokenCount.toLocaleString() }}
                      </dd>
                    </div>
                    <div v-if="selectedNode.route">
                      <dt>Route</dt>
                      <dd>{{ selectedNode.route }}</dd>
                    </div>
                  </dl>
                </section>
                <section class="node-details-section">
                  <h5>Node</h5>
                  <dl class="node-details-list">
                    <div>
                      <dt>Type</dt>
                      <dd>
                        {{ selectedNode.type || "Node" }}
                      </dd>
                    </div>
                    <div v-if="selectedNode.modelId">
                      <dt>Model</dt>
                      <dd>{{ selectedNode.modelId }}</dd>
                    </div>
                  </dl>
                </section>
              </div>
              <div v-if="selectedToolCalls.length" class="tool-call-list">
                <h5>Tool activity</h5>
                <div
                  v-for="tool in selectedToolCalls"
                  :key="tool.id"
                  class="tool-call-row"
                >
                  <UIcon
                    :name="getToolStatusIcon(tool)"
                    :class="getToolStatusColor(tool)"
                  />
                  <span>{{ tool.name }}</span>
                  <span>{{ getToolStatusTextForWorkflow(tool) }}</span>
                  <small v-if="tool.error">{{ tool.error }}</small>
                </div>
              </div>
              <div v-if="hasAttachments" class="inspector-attachments">
                <h5>Run attachments</h5>
                <div class="attachment-grid">
                  <img
                    v-for="attachment in imageAttachments"
                    :key="attachment.id"
                    :src="attachment.url"
                    :alt="attachment.name"
                    loading="lazy"
                  />
                  <span
                    v-for="attachment in fileAttachments"
                    :key="attachment.id"
                    >{{ attachment.name }}</span
                  >
                </div>
                <p v-if="imageCaption">{{ imageCaption }}</p>
              </div>
            </template>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, watch } from "vue";
import {
  type UiWorkflowState,
  type NodeState,
  type BranchState,
  type ToolCallState,
  type HitlRequestState,
  type HitlAction,
  MERGE_BRANCH_ID,
} from "~/utils/chat/workflow-types";
import { useIcon } from "~/composables/useIcon";
import { StreamMarkdown, useShikiHighlighter } from "streamdown-vue";
import { useNuxtApp } from "#app";
import type { ThemePlugin } from "~/plugins/90.theme.client";
import { useToast } from "#imports";
import {
  branchContent,
  branchLabel,
  branchStatusIcon,
  executionStatusColor,
  executionStatusIcon,
  hitlActions as getHitlActions,
  hitlHeading as getHitlHeading,
  hitlInputLabel as getHitlInputLabel,
  nodeStatusColor,
  nodeStatusIcon,
  projectWorkflowAttachments,
  statusColor,
  toolStatusIcon,
  toolStatusText as getToolStatusText,
  type WorkflowStatusIcons,
} from "~/core/workflows/execution-presentation";
import { modelRegistry } from "or3-workflow-core";

defineOptions({ name: "WorkflowExecutionStatus" });

const props = defineProps<{
  workflowState: UiWorkflowState;
  depth?: number;
  focusPath?: string[];
  canResume?: boolean;
  resumeDisabled?: boolean;
}>();
const emit = defineEmits<{
  (event: "resume"): void;
}>();

const depth = computed(() => props.depth ?? 0);
const collapsed = ref(depth.value > 0);
const timelineCollapsed = ref(false);
const mobileInspectorOpen = ref(false);
const focusNodeId = ref<string | null>(null);
const focusNodePath = ref<string[] | null>(null);
type InspectorTab = "output" | "reasoning" | "details";
const selectedNodeId = ref<string | null>(null);
const selectedTab = ref<InspectorTab>("output");
const followingCurrent = ref(true);
const clockNow = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | undefined;

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

const workflowTitle = computed(
  () => props.workflowState.workflowName || "Workflow",
);

const displayNodeIds = computed(() => {
  const planned = props.workflowState.nodeOrder || [];
  const executed = props.workflowState.executionOrder || [];
  const stateIds = Object.keys(props.workflowState.nodeStates || {});
  return [...planned, ...executed, ...stateIds].filter(
    (nodeId, index, all) => nodeId && all.indexOf(nodeId) === index,
  );
});

const timelineItems = computed(() => {
  let currentPhase = "Setup";
  let previousPhase = "";
  return displayNodeIds.value.map((nodeId) => {
    const node = getNode(nodeId);
    const label = node?.label || nodeId;
    const match = label.match(/\b(part|chapter)\s*(\d+)\b/i);
    if (match) {
      currentPhase = `${match[1]!.charAt(0).toUpperCase()}${match[1]!.slice(1).toLowerCase()} ${match[2]}`;
    } else if (node?.type === "output") {
      currentPhase = "Finalize";
    }
    const showPhase = currentPhase !== previousPhase;
    previousPhase = currentPhase;
    return { nodeId, phase: currentPhase, showPhase };
  });
});

const totalNodeCount = computed(() => displayNodeIds.value.length);
const completedNodeCount = computed(
  () =>
    displayNodeIds.value.filter((nodeId) =>
      ["completed", "skipped"].includes(getNodeStatus(nodeId)),
    ).length,
);
const progressPercent = computed(() => {
  if (totalNodeCount.value === 0) {
    return props.workflowState.executionState === "completed" ? 100 : 0;
  }
  return Math.round((completedNodeCount.value / totalNodeCount.value) * 100);
});

const activeNodeId = computed(() => {
  const current = props.workflowState.currentNodeId;
  if (current && getNodeStatus(current) === "active") return current;
  return (
    displayNodeIds.value.find((nodeId) => getNodeStatus(nodeId) === "active") ||
    null
  );
});

const selectedNode = computed(() =>
  selectedNodeId.value ? getNode(selectedNodeId.value) : undefined,
);
const selectedNodeOutput = computed(() =>
  selectedNodeId.value ? getNodeOutput(selectedNodeId.value) : "",
);
const selectedBranches = computed(() =>
  selectedNodeId.value ? getBranches(selectedNodeId.value) : [],
);
const selectedToolCalls = computed(() =>
  selectedNodeId.value ? getNodeToolCalls(selectedNodeId.value) : [],
);
const selectedDurationText = computed(() =>
  selectedNodeId.value ? getNodeDurationText(selectedNodeId.value) : "",
);
const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "output", label: "Output" },
  { id: "reasoning", label: "Reasoning" },
  { id: "details", label: "Details" },
];
const showFollowCurrent = computed(
  () =>
    Boolean(activeNodeId.value) && selectedNodeId.value !== activeNodeId.value,
);

const workflowStartedAt = computed(() => {
  const starts = Object.values(props.workflowState.nodeStates)
    .map((node) => node.startedAt)
    .filter((value): value is number => typeof value === "number");
  return starts.length ? Math.min(...starts) : undefined;
});
const workflowFinishedAt = computed(() => {
  if (props.workflowState.executionState === "running") return undefined;
  const finishes = Object.values(props.workflowState.nodeStates)
    .map((node) => node.finishedAt)
    .filter((value): value is number => typeof value === "number");
  return finishes.length ? Math.max(...finishes) : undefined;
});
const elapsedText = computed(() => {
  const start = workflowStartedAt.value;
  if (!start) return "0s";
  return formatDurationMs(
    Math.max(0, (workflowFinishedAt.value || clockNow.value) - start),
  );
});

watch(
  activeNodeId,
  (next, previous) => {
    if (!next) {
      if (!selectedNodeId.value) {
        selectedNodeId.value =
          props.workflowState.finalNodeId ||
          props.workflowState.lastActiveNodeId ||
          displayNodeIds.value[0] ||
          null;
      }
      return;
    }
    if (
      followingCurrent.value ||
      !selectedNodeId.value ||
      selectedNodeId.value === previous
    ) {
      selectedNodeId.value = next;
      followingCurrent.value = true;
      const node = getNode(next);
      selectedTab.value =
        node?.reasoningText && !getNodeOutput(next) ? "reasoning" : "output";
    }
  },
  { immediate: true },
);

watch(
  displayNodeIds,
  (nodeIds) => {
    if (!selectedNodeId.value && nodeIds.length) {
      selectedNodeId.value =
        props.workflowState.finalNodeId ||
        props.workflowState.lastActiveNodeId ||
        nodeIds[0] ||
        null;
    }
  },
  { immediate: true },
);

watch(
  () => selectedNode.value?.reasoningText,
  (reasoning) => {
    if (
      reasoning &&
      followingCurrent.value &&
      selectedNode.value?.status === "active" &&
      !selectedNodeOutput.value &&
      selectedTab.value === "output"
    ) {
      selectedTab.value = "reasoning";
    }
  },
);

const projectedAttachments = computed(() =>
  projectWorkflowAttachments(props.workflowState),
);
const imageAttachments = computed(() => projectedAttachments.value.images);
const fileAttachments = computed(() => projectedAttachments.value.files);

const hasAttachments = computed(
  () => imageAttachments.value.length > 0 || fileAttachments.value.length > 0,
);
const imageCaption = computed(() => props.workflowState.imageCaption || "");

type PendingHitlEntry = {
  request: HitlRequestState;
  path: string[];
  workflowName: string;
};

function collectPendingHitl(
  state: UiWorkflowState,
  path: string[] = [],
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
      entries.push(...collectPendingHitl(node.subflowState, [...path, nodeId]));
    }
  }

  return entries;
}

const pendingHitlRequests = computed(() =>
  collectPendingHitl(props.workflowState),
);
const pendingHitlCount = computed(() => pendingHitlRequests.value.length);
const hasPendingHitl = computed(() => pendingHitlCount.value > 0);
const pendingHitlBadge = computed(() => {
  if (!hasPendingHitl.value) return "";
  const modes = new Set(
    pendingHitlRequests.value.map((entry) => entry.request.mode),
  );
  if (modes.size === 1) {
    const mode = [...modes][0];
    if (mode === "approval") return "Approval needed";
    if (mode === "input") return "Input needed";
    if (mode === "review") return "Review needed";
  }
  return "Action required";
});
const pendingHitlBadgeText = computed(() => {
  if (!hasPendingHitl.value) return "";
  if (pendingHitlCount.value > 1) {
    return `${pendingHitlBadge.value} (${pendingHitlCount.value})`;
  }
  return pendingHitlBadge.value;
});
const pendingHitlStatusText = computed(() => {
  if (!hasPendingHitl.value) return "";
  const modes = new Set(
    pendingHitlRequests.value.map((entry) => entry.request.mode),
  );
  if (modes.size === 1) {
    const mode = [...modes][0];
    if (mode === "approval") return "Awaiting approval";
    if (mode === "input") return "Awaiting input";
    if (mode === "review") return "Awaiting review";
  }
  return "Action required";
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
        title: pendingHitlBadge.value || "Approval needed",
        description: getPendingHitlContextLabel(entry),
        color: "warning",
        icon: warningIcon.value,
        actions: [
          {
            label: "Review",
            size: "sm",
            variant: "soft",
            color: "warning",
            class: "whitespace-nowrap w-auto px-3",
            onClick: () => {
              focusHitlPath(buildFocusPath(entry));
            },
          },
        ],
      });
    }
  },
  { immediate: true, deep: true },
);

watch(
  () => props.focusPath,
  (path) => {
    if (!path || path.length === 0) return;
    focusHitlPath(path);
  },
  { immediate: true },
);

// Icons
const runExpandIcon = useIcon("ui.chevron.down");
const runCollapseIcon = useIcon("ui.chevron.up");
const timelineCollapseIcon = useIcon("ui.chevron.left");
const timelineExpandIcon = useIcon("ui.chevron.right");
const followCurrentIcon = "i-heroicons-cursor-arrow-rays-20-solid";
const warningIcon = useIcon("ui.warning");
const resumeIcon = useIcon("ui.refresh");
const cancelledStatusIcon = useIcon("workflow.status.cancelled");
const pendingStatusIcon = useIcon("workflow.status.pending");
const runningStatusIcon = useIcon("workflow.status.running");
const completedStatusIcon = useIcon("workflow.status.completed");
const errorStatusIcon = useIcon("workflow.status.error");
const stoppedStatusIcon = useIcon("workflow.status.stopped");
const presentationIcons = computed<WorkflowStatusIcons>(() => ({
  pending: pendingStatusIcon.value,
  running: runningStatusIcon.value,
  completed: completedStatusIcon.value,
  error: errorStatusIcon.value,
  stopped: stoppedStatusIcon.value,
}));

const hitlRequestsByNode = computed(() => {
  const grouped = new Map<string, HitlRequestState[]>();
  const requests = props.workflowState.hitlRequests;
  if (!requests) return grouped;
  for (const request of Object.values(requests)) {
    const existing = grouped.get(request.nodeId);
    if (existing) {
      existing.push(request);
    } else {
      grouped.set(request.nodeId, [request]);
    }
  }
  return grouped;
});

const branchesByNode = computed(() => {
  const grouped = new Map<string, BranchState[]>();
  const branches = props.workflowState.branches;
  if (!branches) return grouped;
  for (const [key, branch] of Object.entries(branches)) {
    if (branch.id === MERGE_BRANCH_ID) continue;
    const [nodeId] = key.split(":", 1);
    if (!nodeId) continue;
    const existing = grouped.get(nodeId);
    if (existing) {
      existing.push(branch);
    } else {
      grouped.set(nodeId, [branch]);
    }
  }
  return grouped;
});

const statusIcon = computed(() =>
  executionStatusIcon(
    props.workflowState.executionState,
    hasPendingHitl.value,
    presentationIcons.value,
  ),
);
const statusColorClass = computed(() =>
  executionStatusColor(
    props.workflowState.executionState,
    hasPendingHitl.value,
  ),
);

const statusText = computed(() => {
  if (hasPendingHitl.value) {
    return pendingHitlStatusText.value;
  }
  const state = props.workflowState.executionState;
  if (!state) return "Unknown";
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

function getNodeStatus(nodeId: string) {
  return getNode(nodeId)?.status || "pending";
}

function getNodeStatusIcon(nodeId: string) {
  const status = getNodeStatus(nodeId);
  if (
    status === "active" &&
    ["stopped", "interrupted"].includes(props.workflowState.executionState)
  ) {
    return cancelledStatusIcon.value;
  }
  if (status === "active" && props.workflowState.executionState === "error") {
    return errorStatusIcon.value;
  }
  return nodeStatusIcon(
    status,
    props.workflowState.executionState,
    presentationIcons.value,
  );
}

function getNodeStatusColor(nodeId: string) {
  return nodeStatusColor(
    getNodeStatus(nodeId),
    props.workflowState.executionState,
  );
}

function getNodeOutput(nodeId: string): string {
  const node = getNode(nodeId);
  return node?.streamingText || node?.output || "";
}

function getNodeActivityText(nodeId: string): string {
  if (activeWorkWasStopped(getNodeStatus(nodeId))) return "Stopped";
  const node = getNode(nodeId);
  if (node?.activity === "thinking") return "Thinking…";
  return "Starting model response…";
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId;
  mobileInspectorOpen.value = true;
  followingCurrent.value = nodeId === activeNodeId.value;
  const node = getNode(nodeId);
  selectedTab.value =
    node?.status === "active" && node.reasoningText && !getNodeOutput(nodeId)
      ? "reasoning"
      : "output";
}

function followCurrentNode() {
  const nodeId = activeNodeId.value;
  if (!nodeId) return;
  followingCurrent.value = true;
  selectedNodeId.value = nodeId;
  mobileInspectorOpen.value = true;
  const node = getNode(nodeId);
  selectedTab.value =
    node?.reasoningText && !getNodeOutput(nodeId) ? "reasoning" : "output";
}

function formatDurationMs(duration: number): string {
  if (duration < 1_000) return `${Math.max(1, Math.round(duration))}ms`;
  const seconds = Math.round(duration / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getNodeDurationText(nodeId: string): string {
  const node = getNode(nodeId);
  if (!node?.startedAt) return "";
  if (!node.finishedAt && props.workflowState.executionState !== "running") {
    return "";
  }
  const end = node.finishedAt || clockNow.value;
  return formatDurationMs(Math.max(0, end - node.startedAt));
}

function humanizeNodeStatus(status: NodeState["status"]): string {
  if (
    status === "active" &&
    ["stopped", "interrupted"].includes(props.workflowState.executionState)
  ) {
    return "Cancelled";
  }
  if (status === "active" && props.workflowState.executionState === "error") {
    return "Failed";
  }
  if (status === "active") return "Running";
  if (status === "waiting") return "Waiting for input";
  if (status === "pending") return "Waiting";
  if (status === "error") return "Failed";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function displayModelName(modelId: string): string {
  const normalized = modelId.replace(/^~/, "");
  const registeredName = modelRegistry.getInfo(normalized)?.name;
  if (registeredName) return registeredName;
  return (normalized.split("/").pop() || normalized)
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^v?\d+(?:\.\d+)*$/i.test(part)) return part.toUpperCase();
      if (part.toLowerCase() === "gpt") return "GPT";
      if (part.toLowerCase() === "glm") return "GLM";
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

function latestReasoningPreview(reasoning?: string): string {
  if (!reasoning) return "Reasoning…";
  const compact = reasoning.replace(/\s+/g, " ").trim();
  if (!compact) return "Reasoning…";
  const tail = compact.slice(-96);
  return compact.length > tail.length ? `…${tail}` : tail;
}

function getNodeTimelineText(nodeId: string): string {
  const node = getNode(nodeId);
  if (!node) return "Waiting";
  if (node.error) return node.error;
  if (activeWorkWasStopped(node.status)) return "Stopped";
  if (node.status === "waiting") return getNodeWaitingText(nodeId);
  if (node.status === "active") {
    if (node.streamingText) return "Streaming output…";
    if (node.reasoningText) return latestReasoningPreview(node.reasoningText);
    return getNodeActivityText(nodeId);
  }
  if (node.status === "pending") return "Waiting";
  if (node.route) return `Selected ${node.route}`;
  return "";
}

function shouldShowNodeActivity(nodeId: string): boolean {
  const status = getNodeStatus(nodeId);
  if (getNodeError(nodeId)) return true;
  if (status === "waiting") return true;
  return (
    status === "active" && props.workflowState.executionState === "running"
  );
}

function getNodeEmptyOutputText(nodeId: string): string {
  const status = getNodeStatus(nodeId);
  if (status === "active") {
    return getNode(nodeId)?.reasoningText
      ? "The model is still reasoning before it writes its response."
      : getNodeActivityText(nodeId);
  }
  if (status === "waiting") return getNodeWaitingText(nodeId);
  if (status === "pending") return "This step has not started yet.";
  if (activeWorkWasStopped(status)) {
    return props.workflowState.executionState === "error"
      ? "This step failed before producing output."
      : "This step was cancelled before producing output.";
  }
  return "This step did not produce visible output.";
}

function isNodeStreaming(nodeId: string): boolean {
  const node = getNode(nodeId);
  // A node is streaming if it has streamingText and status is active
  return !!(node?.streamingText && node.status === "active");
}

function getNodeError(nodeId: string): string | undefined {
  return getNode(nodeId)?.error;
}

function getNodeToolCalls(nodeId: string): ToolCallState[] {
  return getNode(nodeId)?.toolCalls || [];
}

function getNodeHitlRequests(nodeId: string): HitlRequestState[] {
  return hitlRequestsByNode.value.get(nodeId) || [];
}

function getNodePendingHitlCount(nodeId: string): number {
  const localCount = getNodeHitlRequests(nodeId).length;
  const subflowState = getNodeSubflowState(nodeId);
  const nestedCount = subflowState
    ? collectPendingHitl(subflowState).length
    : 0;
  return localCount + nestedCount;
}

function getNodeWaitingText(nodeId: string): string {
  const requests = getNodeHitlRequests(nodeId);
  if (!requests.length) return "Waiting for input...";
  const modes = new Set(requests.map((req) => req.mode));
  if (modes.size === 1) {
    const mode = [...modes][0];
    if (mode === "approval") return "Waiting for approval...";
    if (mode === "input") return "Waiting for input...";
    if (mode === "review") return "Waiting for review...";
  }
  return "Waiting for action...";
}

function buildFocusPath(entry: PendingHitlEntry): string[] {
  return [...entry.path, entry.request.nodeId];
}

function focusHitlPath(path: string[]) {
  if (!path.length) return;
  collapsed.value = false;
  timelineCollapsed.value = false;
  mobileInspectorOpen.value = true;
  const [nodeId, ...rest] = path;
  if (!nodeId) return;
  selectedNodeId.value = nodeId;
  selectedTab.value = "output";
  followingCurrent.value = nodeId === activeNodeId.value;
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
  return labels.join(" › ");
}

const pendingHitlContextLabel = computed(() => {
  const entry = pendingHitlRequests.value[0];
  if (!entry) return "";
  return getPendingHitlContextLabel(entry);
});

function getBranches(nodeId: string): BranchState[] {
  return branchesByNode.value.get(nodeId) || [];
}

function getBranchLabel(branch: BranchState): string {
  return branchLabel(branch);
}

function getBranchContent(branch: BranchState): string {
  return branchContent(branch);
}

function getBranchStatusIcon(branch: BranchState) {
  if (activeWorkWasStopped(branch.status))
    return presentationIcons.value.stopped;
  return branchStatusIcon(branch, presentationIcons.value);
}

function getBranchStatusColor(branch: BranchState) {
  if (activeWorkWasStopped(branch.status)) {
    return "text-[var(--md-outline)]";
  }
  return statusColor(branch.status);
}

function getToolStatusIcon(tool: ToolCallState) {
  if (activeWorkWasStopped(tool.status)) return presentationIcons.value.stopped;
  return toolStatusIcon(tool, presentationIcons.value);
}

function getToolStatusColor(tool: ToolCallState) {
  if (activeWorkWasStopped(tool.status)) {
    return "text-[var(--md-outline)]";
  }
  return statusColor(tool.status);
}

function getToolStatusTextForWorkflow(tool: ToolCallState): string {
  return activeWorkWasStopped(tool.status)
    ? "Stopped"
    : getToolStatusText(tool.status);
}

function activeWorkWasStopped(status: string): boolean {
  return (
    status === "active" &&
    ["stopped", "interrupted", "error"].includes(
      props.workflowState.executionState,
    )
  );
}

function getHitlInputDisplay(request: HitlRequestState): string {
  const input = request.context?.input ?? props.workflowState.prompt ?? "";
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }
  return "(no input provided)";
}

function getHitlOutputDisplay(request: HitlRequestState): string {
  const output = request.context?.output;
  if (typeof output === "string" && output.trim().length > 0) {
    return output;
  }
  return "(no output provided)";
}

async function handleHitlAction(
  request: HitlRequestState,
  action: HitlAction,
  label: string,
  requiresInput?: boolean,
) {
  const workflowSlash = nuxtApp.$workflowSlash;

  if (!workflowSlash?.respondHitl) return;

  if (
    requiresInput ||
    action === "submit" ||
    action === "modify" ||
    action === "custom"
  ) {
    if (typeof window === "undefined") return;
    const defaultValue =
      request.mode === "review"
        ? request.context?.output
        : request.context?.input;
    const promptLabel = label || request.prompt;
    const response = window.prompt(promptLabel, defaultValue || "");
    if (response === null) return;
    const ok = await workflowSlash.respondHitl(
      request.id,
      action,
      response,
      request.jobId,
    );
    if (!ok) {
      toast.add({
        title: "Failed to submit response",
        description: "Please try again.",
        color: "error",
      });
    }
    return;
  }

  const ok = await workflowSlash.respondHitl(
    request.id,
    action,
    undefined,
    request.jobId,
  );
  if (!ok) {
    toast.add({
      title: "Failed to submit response",
      description: "Please try again.",
      color: "error",
    });
  }
}

// Theme
const nuxtApp = useNuxtApp();
const themePlugin = computed<ThemePlugin>(() => nuxtApp.$theme);
const currentShikiTheme = computed(() => {
  const themeObj = themePlugin.value;
  const themeName = themeObj.current?.value ?? themeObj.get();
  return String(themeName).startsWith("dark") ? "github-dark" : "github-light";
});

onMounted(async () => {
  if (depth.value === 0) {
    timelineCollapsed.value =
      window.localStorage.getItem("or3:workflow:timeline-collapsed") === "true";
  }
  clockTimer = setInterval(() => {
    clockNow.value = Date.now();
  }, 1_000);
  await useShikiHighlighter();
});

watch(timelineCollapsed, (next) => {
  if (!import.meta.client || depth.value > 0) return;
  window.localStorage.setItem("or3:workflow:timeline-collapsed", String(next));
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<style scoped src="./WorkflowExecutionStatus.css"></style>
