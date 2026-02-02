/**
 * @module composables/chat/useWorkflowStreamAccumulator
 *
 * **Purpose**
 * Provides a reactive state accumulator for workflow execution streaming. Manages real-time
 * updates of workflow execution state as events flow from the workflow engine (or3-workflow-core),
 * presenting a unified, renderable state tree for UI components. Handles both top-level workflows
 * and nested subflows, branch parallelism, tool calls, and human-in-the-loop (HITL) requests.
 *
 * **Responsibilities**
 * - Accumulate workflow execution events (node start/finish/token, branch lifecycle, tool calls, etc.)
 * - Maintain reactive state tree with per-node and per-branch states
 * - Manage subflow scoping via prefixed keys (`sf:parentNodeId|childNodeId`)
 * - Track execution order and current/last active nodes for UI focus and scrolling
 * - Aggregate workflow-level streaming tokens from leaf nodes
 * - Apply RAF (requestAnimationFrame) batching to token updates for performance
 * - Support HITL pause/resume flows (request tracking, state updates)
 * - Export final state to WorkflowMessageData for persistence
 *
 * **Non-responsibilities**
 * - Does NOT execute workflows (see or3-workflow-core engine)
 * - Does NOT manage workflow definitions or schemas (see workflow store)
 * - Does NOT persist state directly (see useAi.ts for DB writes)
 * - Does NOT handle UI rendering (see WorkflowView.vue, WorkflowNodeCard.vue)
 * - Does NOT manage workflow configuration or routing logic
 *
 * **Subflow Scope Keying Strategy**
 * - Top-level nodes use plain nodeId: `"node1"`, `"node2"`
 * - Subflow nodes use prefixed keys: `"sf:parentNodeId|childNodeId"`
 * - Deep nesting: `"sf:node1|sf:node2|node3"` for node3 inside node2 inside node1
 * - Separator: `"|"` splits scope segments
 * - Prefix: `"sf:"` marks a scope segment
 * - Parsing: `parseScopedNodeId()` extracts path and leaf nodeId
 * - UI rendering: nested `UiWorkflowState` objects represent subflow states in the tree
 *
 * **Branch Keys and Ordering**
 * - Branch keys: `"nodeId:branchId"` for parallel execution branches
 * - Each branch tracks its own `streamingText`, `output`, `complete` flag
 * - Branch order follows event arrival (no explicit ordering constraint)
 * - Branches are rendered as expandable sections in UI (see WorkflowNodeCard.vue)
 *
 * **Event → State Mapping Invariants**
 * - `nodeStart` → creates NodeState, adds to executionOrder, sets currentNodeId
 * - `nodeToken` → appends to node.streamingText (batched via RAF)
 * - `nodeReasoning` → appends to node.reasoning (batched via RAF)
 * - `nodeFinish` → sets node.output, moves streamingText to output, marks complete
 * - `nodeError` → sets node.error, failedNodeId, executionState = 'failed'
 * - `branchStart` → creates BranchState under `nodeId:branchId` key
 * - `branchToken` → appends to branch.streamingText (batched via RAF)
 * - `branchComplete` → moves branch.streamingText to branch.output, marks complete
 * - `workflowToken` → appends to finalStreamingText (batched via RAF), for leaf aggregation
 * - `finalize` → commits pending batches, sets executionState, isActive = false, error if provided
 * - `reset` → clears all state, cancels pending RAF, resets to initial defaults
 *
 * **Performance Characteristics**
 * - RAF batching: token updates are accumulated in pending buffers and flushed on next animation frame
 * - Expected event rate: 10-100 events/sec during active streaming (depends on LLM speed)
 * - State tree size: typically 5-20 nodes per workflow, up to 100 for complex graphs
 * - Subflow nesting: supports arbitrary depth, though typical depth is 1-2 levels
 * - Version counter increments on every state mutation (used by watchers for change detection)
 *
 * **Error Handling Contract**
 * - `nodeError(nodeId, error)` sets `failedNodeId` and `executionState = 'failed'`
 * - `finalize({ error })` sets top-level `error` and `executionState = 'failed'`
 * - Errors do NOT throw or propagate; state is updated and UI reflects failure
 * - HITL request failures set request.state = 'rejected' and update node state
 * - Partial execution state is preserved on error (for debugging and resume scenarios)
 *
 * **Concurrency and Batching**
 * - Token events are buffered in Maps/Arrays and applied in a single RAF callback
 * - Only one RAF flush is scheduled at a time (idempotent scheduling)
 * - Flush order: node tokens → branch tokens → workflow tokens → version increment
 * - Finalize cancels pending RAF and commits immediately
 *
 * **Testing Strategy**
 * - Unit tests: verify event handlers update state correctly (mock reactive state)
 * - Unit tests: verify subflow scoping and branch key parsing
 * - Unit tests: verify RAF batching reduces mutation count
 * - Integration tests: simulate full workflow execution event sequences
 * - Performance tests: measure update latency under high token throughput
 */

import { reactive } from 'vue';
import type {
    NodeState,
    BranchState,
    WorkflowExecutionState,
    WorkflowMessageData,
    ChatHistoryMessage,
    ToolCallState,
    HitlRequestState,
    UiWorkflowState,
} from '~/utils/chat/workflow-types';
import { deriveStartNodeId } from '~/utils/chat/workflow-types';
import type { ToolCallEventWithNode } from 'or3-workflow-core';
import type { Attachment } from 'or3-workflow-core';

const SUBFLOW_SCOPE_PREFIX = 'sf:';
const SUBFLOW_SCOPE_SEPARATOR = '|';

/**
 * Reactive state interface for workflow execution streaming.
 * This state is exposed to UI components for real-time rendering.
 */
export interface WorkflowStreamingState {
    /** Workflow identification */
    workflowId?: string;
    /** Workflow display name */
    workflowName?: string;
    /** Attachments available to the workflow execution */
    attachments?: Attachment[];
    /** Auto-generated caption for image attachments */
    imageCaption?: string;
    /** Overall execution state */
    executionState: WorkflowExecutionState;
    /** Per-node states, keyed by nodeId */
    nodeStates: Record<string, NodeState>;
    /** Execution order (list of nodeIds) */
    executionOrder: string[];
    /** Last node that produced output */
    lastActiveNodeId: string | null;
    /** Final node id reported by the engine */
    finalNodeId: string | null;
    /** Currently active node ID */
    currentNodeId: string | null;
    /** Branch states for parallel execution, keyed by "nodeId:branchId" */
    branches: Record<string, BranchState>;
    /** Final accumulated output */
    finalOutput: string;
    /** Streaming buffer for workflow-level tokens */
    finalStreamingText: string;
    /** Token usage rollup */
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    /** Per-node token usage details */
    tokenUsageDetails?: Array<{
        nodeId: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens?: number;
    }>;
    /** Is execution still active */
    isActive: boolean;
    /** Version counter for watchers (increments on every update) */
    version: number;
    /** Error if any */
    error: Error | null;
    /** Node that failed (if any) */
    failedNodeId: string | null;
    /** Latest per-node outputs for resume */
    nodeOutputs?: Record<string, string>;
    /** Session messages collected during execution */
    sessionMessages?: ChatHistoryMessage[];
    /** Pending HITL requests keyed by request ID */
    hitlRequests?: Record<string, HitlRequestState>;
}

/**
 * API for the workflow stream accumulator.
 * Provides methods to update state based on execution events.
 */
export interface WorkflowStreamAccumulatorApi {
    /** Read-only reactive state */
    state: Readonly<WorkflowStreamingState>;

    // Identification
    setWorkflowInfo(id: string, name: string): void;

    // Attachments
    setAttachments(attachments?: Attachment[]): void;
    setImageCaption(caption?: string): void;

    // Node lifecycle
    nodeStart(
        nodeId: string,
        label: string,
        type: string,
        modelId?: string
    ): void;
    nodeToken(nodeId: string, token: string): void;
    nodeReasoning(nodeId: string, token: string): void;
    nodeFinish(nodeId: string, output: string): void;
    nodeError(nodeId: string, error: Error): void;
    routeSelected(nodeId: string, route: string): void;
    tokenUsage(
        nodeId: string,
        usage: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        }
    ): void;

    // Branch lifecycle (for parallel nodes)
    branchStart(nodeId: string, branchId: string, label: string): void;
    branchToken(
        nodeId: string,
        branchId: string,
        label: string,
        token: string
    ): void;
    branchReasoning(
        nodeId: string,
        branchId: string,
        label: string,
        token: string
    ): void;
    branchComplete(
        nodeId: string,
        branchId: string,
        branchLabel: string,
        output: string
    ): void;
    toolCallEvent(event: ToolCallEventWithNode): void;
    hitlRequest(request: HitlRequestState): void;
    hitlResolve(
        requestId: string,
        response?: { action?: string; data?: unknown }
    ): void;

    // Workflow-level streaming (leaf aggregation)
    workflowToken(token: string, meta?: { nodeId?: string }): void;

    // Execution lifecycle
    finalize(opts?: {
        error?: Error;
        stopped?: boolean;
        result?: {
            success: boolean;
            finalOutput?: string;
            finalNodeId?: string;
            executionOrder?: string[];
            lastActiveNodeId?: string;
            duration?: number;
            usage?: {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
            };
            tokenUsageDetails?: Array<{
                nodeId: string;
                promptTokens: number;
                completionTokens: number;
                totalTokens?: number;
            }>;
            error?: Error;
            nodeOutputs?: Record<string, string>;
            sessionMessages?: ChatHistoryMessage[];
        };
    }): void;
    reset(): void;

    // Export for persistence
    toMessageData(
        workflowId: string,
        workflowName: string,
        prompt: string
    ): WorkflowMessageData;
}

type WorkflowUiState = WorkflowStreamingState | UiWorkflowState;

function parseScopedNodeId(scopedId: string): {
    path: string[];
    nodeId: string;
} {
    const segments = scopedId.split(SUBFLOW_SCOPE_SEPARATOR);
    if (segments.length === 1) {
        return { path: [], nodeId: scopedId };
    }

    const path: string[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        if (!segment || !segment.startsWith(SUBFLOW_SCOPE_PREFIX)) {
            return { path: [], nodeId: scopedId };
        }
        path.push(segment.slice(SUBFLOW_SCOPE_PREFIX.length));
    }

    const nodeId = segments[segments.length - 1];
    return { path, nodeId: nodeId || scopedId };
}

/**
 * Creates a workflow stream accumulator.
 * Manages reactive state updates with RAF batching for performance.
 */
export function createWorkflowStreamAccumulator(): WorkflowStreamAccumulatorApi {
    const state = reactive<WorkflowStreamingState>({
        workflowId: undefined,
        workflowName: undefined,
        attachments: undefined,
        imageCaption: undefined,
        executionState: 'running',
        nodeStates: {},
        executionOrder: [],
        lastActiveNodeId: null,
        finalNodeId: null,
        currentNodeId: null,
        branches: {},
        finalOutput: '',
        finalStreamingText: '',
        isActive: true,
        version: 0,
        error: null,
        failedNodeId: null,
        hitlRequests: {},
    });

    // Pending updates for RAF batching
    let pendingNodeTokens: Map<string, string[]> = new Map();
    let pendingBranchTokens: Map<string, string[]> = new Map();
    let pendingWorkflowTokens: string[] = [];
    let rafId: number | null = null;
    let finalized = false;
    let totalTokens = 0;

    function createSubflowState(
        node: NodeState,
        nodeId: string
    ): UiWorkflowState {
        return {
            workflowId: nodeId,
            workflowName: node.label || nodeId,
            executionState: 'running',
            attachments: state.attachments,
            imageCaption: state.imageCaption,
            nodeStates: {},
            executionOrder: [],
            lastActiveNodeId: null,
            finalNodeId: null,
            currentNodeId: null,
            branches: {},
            hitlRequests: {},
            finalOutput: '',
            finalStreamingText: '',
            failedNodeId: null,
            version: 0,
        };
    }

    function ensureNodeState(
        targetState: WorkflowUiState,
        nodeId: string,
        label?: string,
        type?: string,
        modelId?: string
    ): NodeState {
        const existing = targetState.nodeStates[nodeId];
        if (existing) return existing;

        const node: NodeState = {
            status: 'active',
            label: label || nodeId,
            type: type || 'node',
            modelId,
            output: '',
            streamingText: '',
            startedAt: Date.now(),
            tokenCount: 0,
        };
        targetState.nodeStates[nodeId] = node;
        return node;
    }

    function getOrCreateSubflowState(path: string[]): UiWorkflowState {
        let currentState: WorkflowUiState = state;
        for (const nodeId of path) {
            const node = ensureNodeState(currentState, nodeId);
            if (!node.subflowState) {
                node.subflowState = createSubflowState(node, nodeId);
            }
            currentState = node.subflowState;
        }
        return currentState as UiWorkflowState;
    }

    function resolveScopedTarget(scopedId: string): {
        targetState: WorkflowUiState;
        nodeId: string;
        path: string[];
    } {
        const { path, nodeId } = parseScopedNodeId(scopedId);
        if (path.length === 0) {
            return { targetState: state, nodeId, path };
        }
        return { targetState: getOrCreateSubflowState(path), nodeId, path };
    }

    function ensureBranches(
        targetState: WorkflowUiState
    ): Record<string, BranchState> {
        if (!targetState.branches) {
            targetState.branches = {};
        }
        return targetState.branches;
    }

    function parseBranchKey(
        key: string
    ): { nodeId: string; branchId: string } | null {
        const splitIndex = key.lastIndexOf(':');
        if (splitIndex <= 0) return null;
        return {
            nodeId: key.slice(0, splitIndex),
            branchId: key.slice(splitIndex + 1),
        };
    }

    function ensureBranchState(
        targetState: WorkflowUiState,
        nodeId: string,
        branchId: string,
        label?: string
    ): BranchState {
        const branches = ensureBranches(targetState);
        const key = `${nodeId}:${branchId}`;
        const existing = branches[key];
        if (existing) return existing;

        const branch: BranchState = {
            id: branchId,
            label: label || branchId,
            status: 'active',
            output: '',
            streamingText: '',
        };
        branches[key] = branch;
        return branch;
    }

    function ensureHitlRequests(
        targetState: WorkflowUiState
    ): Record<string, HitlRequestState> {
        if (!targetState.hitlRequests) {
            targetState.hitlRequests = {};
        }
        return targetState.hitlRequests;
    }

    function touchState(targetState: WorkflowUiState) {
        if (targetState !== state) {
            targetState.version = (targetState.version ?? 0) + 1;
        }
        state.version++;
    }

    function finalizeSubflowState(
        subflowState: UiWorkflowState,
        output?: string
    ) {
        if (
            subflowState.executionState === 'running' ||
            subflowState.executionState === 'idle'
        ) {
            subflowState.executionState = 'completed';
        }
        subflowState.currentNodeId = null;
        if (!subflowState.finalOutput) {
            if (subflowState.finalStreamingText) {
                subflowState.finalOutput = subflowState.finalStreamingText;
            } else if (output) {
                subflowState.finalOutput = output;
            }
        }
        if (!subflowState.finalNodeId && subflowState.executionOrder.length) {
            subflowState.finalNodeId =
                subflowState.executionOrder[
                    subflowState.executionOrder.length - 1
                ];
        }
        subflowState.version = (subflowState.version ?? 0) + 1;
    }

    function findHitlRequestState(
        targetState: WorkflowUiState,
        requestId: string
    ): { state: WorkflowUiState; request: HitlRequestState } | null {
        if (targetState.hitlRequests && targetState.hitlRequests[requestId]) {
            return {
                state: targetState,
                request: targetState.hitlRequests[requestId],
            };
        }

        for (const node of Object.values(targetState.nodeStates)) {
            if (!node.subflowState) continue;
            const found = findHitlRequestState(node.subflowState, requestId);
            if (found) return found;
        }

        return null;
    }

    function scheduleFlush() {
        if (rafId !== null || finalized) return;
        if (typeof requestAnimationFrame === 'function') {
            rafId = requestAnimationFrame(flush);
        } else {
            // Fallback for non-browser environments (e.g. tests)
            rafId = setTimeout(flush, 0) as unknown as number;
        }
    }

    function flush() {
        rafId = null;
        const touchedStates = new Set<WorkflowUiState>();

        // Flush node tokens
        for (const [scopedNodeId, tokens] of pendingNodeTokens) {
            const { targetState, nodeId } = resolveScopedTarget(scopedNodeId);
            const node = targetState.nodeStates[nodeId];
            if (!node) continue;

            node.streamingText = (node.streamingText || '') + tokens.join('');
            // Update token count estimate (rough approximation)
            node.tokenCount = (node.tokenCount || 0) + tokens.length;
            touchedStates.add(targetState);
        }
        pendingNodeTokens.clear();

        // Flush branch tokens
        for (const [key, tokens] of pendingBranchTokens) {
            const parsed = parseBranchKey(key);
            if (!parsed) continue;
            const { targetState, nodeId } = resolveScopedTarget(parsed.nodeId);
            const branches = targetState.branches;
            if (!branches) continue;
            const branch = branches[key];
            if (!branch) continue;

            branch.streamingText =
                (branch.streamingText || '') + tokens.join('');
            touchedStates.add(targetState);
        }
        pendingBranchTokens.clear();

        // Flush workflow tokens
        if (pendingWorkflowTokens.length > 0) {
            const text = pendingWorkflowTokens.join('');
            state.finalStreamingText = (state.finalStreamingText || '') + text;
            state.finalOutput = state.finalStreamingText;
            pendingWorkflowTokens = [];
            touchedStates.add(state);
        }

        if (touchedStates.size > 0) {
            for (const targetState of touchedStates) {
                if (targetState !== state) {
                    targetState.version = (targetState.version ?? 0) + 1;
                }
            }
            state.version++;
        }
    }

    function nodeStart(
        nodeId: string,
        label: string,
        type: string,
        modelId?: string
    ) {
        if (finalized) return;

        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);

        const node =
            targetState.nodeStates[localNodeId] ||
            ({
                status: 'active',
                label,
                type,
                modelId,
                output: '',
                streamingText: '',
                startedAt: Date.now(),
                tokenCount: 0,
            } satisfies NodeState);

        node.status = 'active';
        node.label = label;
        node.type = type;
        if (modelId) {
            node.modelId = modelId;
        }
        node.output = node.output || '';
        node.streamingText = node.streamingText ?? '';
        node.startedAt = node.startedAt ?? Date.now();
        node.tokenCount = node.tokenCount ?? 0;

        if (type === 'subflow' && !node.subflowState) {
            node.subflowState = createSubflowState(node, localNodeId);
        }
        if (
            node.subflowState &&
            node.subflowState.workflowName !== node.label
        ) {
            node.subflowState.workflowName = node.label || localNodeId;
        }

        targetState.nodeStates[localNodeId] = node;

        if (!targetState.executionOrder.includes(localNodeId)) {
            targetState.executionOrder.push(localNodeId);
        }

        targetState.currentNodeId = localNodeId;
        targetState.lastActiveNodeId = localNodeId;
        if (targetState.executionState !== 'running') {
            targetState.executionState = 'running';
        }
        touchState(targetState);
    }

    function nodeToken(nodeId: string, token: string) {
        if (finalized || !token) return;

        const existing = pendingNodeTokens.get(nodeId) || [];
        existing.push(token);
        pendingNodeTokens.set(nodeId, existing);
        scheduleFlush();
    }

    function nodeReasoning(nodeId: string, token: string) {
        // Reasoning tokens treated same as regular tokens for now
        // Could be extended to track separately per-node if needed
        nodeToken(nodeId, token);
    }

    function nodeFinish(nodeId: string, output: string) {
        if (finalized) return;

        // Force flush pending tokens first
        if (rafId !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(rafId);
            } else {
                clearTimeout(rafId);
            }
            flush();
        }

        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);
        const node = targetState.nodeStates[localNodeId];
        if (!node) return;

        node.status = 'completed';
        node.output = output;
        node.streamingText = undefined; // Clear streaming buffer
        node.finishedAt = Date.now();

        if (targetState.currentNodeId === localNodeId) {
            targetState.currentNodeId = null;
        }

        targetState.lastActiveNodeId = localNodeId;

        if (node.subflowState) {
            finalizeSubflowState(node.subflowState, output);
        }

        // Do NOT set finalOutput here - intermediate nodes should not trigger
        // the result box. finalOutput is only set when finalize() is called
        // with the actual workflow result.
        touchState(targetState);
    }

    function nodeError(nodeId: string, error: Error) {
        if (finalized) return;

        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);
        const node = targetState.nodeStates[localNodeId];
        if (!node) return;

        node.status = 'error';
        node.error = error.message;
        node.finishedAt = Date.now();

        if (node.subflowState) {
            node.subflowState.executionState = 'error';
            node.subflowState.failedNodeId =
                node.subflowState.lastActiveNodeId || null;
            node.subflowState.version = (node.subflowState.version ?? 0) + 1;
        }

        targetState.executionState = 'error';
        targetState.failedNodeId = localNodeId;
        targetState.currentNodeId = localNodeId;

        if (targetState === state) {
            state.error = error;
        }

        touchState(targetState);
    }

    function workflowToken(token: string, meta?: { nodeId?: string }) {
        if (finalized || !token) return;
        if (meta?.nodeId) {
            const { targetState } = resolveScopedTarget(meta.nodeId);
            if (targetState !== state) {
                targetState.finalStreamingText =
                    (targetState.finalStreamingText || '') + token;
                targetState.finalOutput = targetState.finalStreamingText;
                touchState(targetState);
                return;
            }
        }

        // Workflow tokens update immediately for real-time final output streaming
        state.finalStreamingText = (state.finalStreamingText || '') + token;
        state.finalOutput = state.finalStreamingText;
        touchState(state);
    }

    function routeSelected(nodeId: string, route: string) {
        if (finalized) return;
        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);
        const node = targetState.nodeStates[localNodeId];
        if (node) {
            (node as NodeState & { route?: string }).route = route;
            touchState(targetState);
        }
    }

    function tokenUsage(
        nodeId: string,
        usage: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        }
    ) {
        if (finalized) return;
        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);
        const node = targetState.nodeStates[localNodeId];
        if (node) {
            const increment = usage.totalTokens ?? 0;
            node.tokenCount = (node.tokenCount || 0) + increment;
            totalTokens += increment;
            touchState(targetState);
        }
    }

    function branchStart(nodeId: string, branchId: string, label: string) {
        if (finalized) return;

        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);

        // Parallel nodes should be started before branches
        if (!targetState.nodeStates[localNodeId]) return;

        const branch = ensureBranchState(
            targetState,
            localNodeId,
            branchId,
            label
        );
        branch.status = 'active';
        branch.output = '';
        branch.streamingText = '';
        touchState(targetState);
    }

    // NOTE: label param comes from or3-workflows callback (4th positional param)
    // We don't use it here since branch was created with label in branchStart
    function branchToken(
        nodeId: string,
        branchId: string,
        _label: string,
        token: string
    ) {
        if (finalized || !token) return;

        const key = `${nodeId}:${branchId}`;
        const existing = pendingBranchTokens.get(key) || [];
        existing.push(token);
        pendingBranchTokens.set(key, existing);
        scheduleFlush();
    }

    function branchReasoning(
        nodeId: string,
        branchId: string,
        label: string,
        token: string
    ) {
        // Treat reasoning tokens like normal branch tokens for streaming
        branchToken(nodeId, branchId, label, token);
    }

    function branchComplete(
        nodeId: string,
        branchId: string,
        _branchLabel: string,
        output: string
    ) {
        if (finalized) return;

        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);

        const branches = targetState.branches;
        if (!branches) return;

        const key = `${localNodeId}:${branchId}`;
        const branch = branches[key];
        if (!branch) return;

        branch.status = 'completed';
        // Prefer accumulated streaming text; fall back to engine output
        branch.output = branch.streamingText || output || '';
        branch.streamingText = undefined;
        touchState(targetState);
    }

    function toolCallEvent(event: ToolCallEventWithNode) {
        if (finalized || !event.nodeId) return;

        const { nodeId, nodeLabel, nodeType, branchId, branchLabel } = event;
        const { targetState, nodeId: localNodeId } =
            resolveScopedTarget(nodeId);
        const targetKey = branchId ? `${localNodeId}:${branchId}` : localNodeId;

        let target:
            | (NodeState & { toolCalls?: ToolCallState[] })
            | (BranchState & { toolCalls?: ToolCallState[] })
            | undefined;

        if (branchId) {
            const branch = ensureBranchState(
                targetState,
                localNodeId,
                branchId,
                branchLabel
            );
            target = branch as BranchState & { toolCalls?: ToolCallState[] };
        } else {
            const node = ensureNodeState(
                targetState,
                localNodeId,
                nodeLabel || localNodeId,
                nodeType || 'node'
            );
            target = node as NodeState & { toolCalls?: ToolCallState[] };
        }

        const toolCalls = target.toolCalls || [];
        let tool = toolCalls.find((call) => call.id === event.id);

        if (!tool) {
            tool = {
                id: event.id,
                name: event.name,
                status: event.status,
                startedAt: Date.now(),
            };
            toolCalls.push(tool);
        } else {
            tool.status = event.status;
        }

        if (event.error) {
            tool.error = event.error;
        }

        if (event.status !== 'active') {
            tool.finishedAt = Date.now();
        }

        target.toolCalls = toolCalls;
        touchState(targetState);
    }

    function hitlRequest(request: HitlRequestState) {
        if (finalized) return;

        const { targetState, nodeId: localNodeId } = resolveScopedTarget(
            request.nodeId
        );
        const hitlRequests = ensureHitlRequests(targetState);
        const scopedRequest = {
            ...request,
            nodeId: localNodeId,
        } satisfies HitlRequestState;
        targetState.hitlRequests = {
            ...hitlRequests,
            [request.id]: scopedRequest,
        };

        const node =
            targetState.nodeStates[localNodeId] ||
            ({
                status: 'waiting',
                label: request.nodeLabel || localNodeId,
                type: 'node',
                output: '',
                streamingText: '',
            } as NodeState);

        if (node.status !== 'error') {
            node.status = 'waiting';
        }

        if (!node.startedAt) {
            node.startedAt = Date.now();
        }

        targetState.nodeStates[localNodeId] = node;

        if (!targetState.executionOrder.includes(localNodeId)) {
            targetState.executionOrder.push(localNodeId);
        }

        targetState.currentNodeId = localNodeId;
        targetState.lastActiveNodeId = localNodeId;
        touchState(targetState);
    }

    function hitlResolve(
        requestId: string,
        response?: { action?: string; data?: unknown }
    ) {
        const found = findHitlRequestState(state, requestId);
        if (!found) return;

        const { state: targetState, request } = found;
        const hitlRequests = ensureHitlRequests(targetState);
        const nextRequests = { ...hitlRequests };
        delete nextRequests[requestId];
        targetState.hitlRequests =
            Object.keys(nextRequests).length > 0 ? nextRequests : {};

        const node = targetState.nodeStates[request.nodeId];
        if (node && node.status === 'waiting') {
            if (response?.action === 'reject') {
                node.status = 'error';
                node.error = 'Rejected by user';
                node.finishedAt = Date.now();
                touchState(targetState);
                return;
            }
            if (
                request.mode === 'review' &&
                response?.action === 'modify' &&
                response.data !== undefined
            ) {
                node.output =
                    typeof response.data === 'string'
                        ? response.data
                        : JSON.stringify(response.data);
            }

            const shouldComplete = Boolean(
                node.output || node.finishedAt || request.mode === 'review'
            );
            node.status = shouldComplete ? 'completed' : 'active';
            if (shouldComplete && !node.finishedAt) {
                node.finishedAt = Date.now();
            }
        }

        touchState(targetState);
    }

    function finalize(opts?: {
        error?: Error;
        stopped?: boolean;
        result?: {
            success: boolean;
            finalOutput?: string;
            finalNodeId?: string;
            executionOrder?: string[];
            lastActiveNodeId?: string;
            duration?: number;
            usage?: {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
            };
            tokenUsageDetails?: Array<{
                nodeId: string;
                promptTokens: number;
                completionTokens: number;
                totalTokens?: number;
            }>;
            error?: Error;
            nodeOutputs?: Record<string, string>;
            sessionMessages?: ChatHistoryMessage[];
        };
    }) {
        if (finalized) {
            // Merge late-arriving result data (e.g., session messages)
            if (opts?.result) {
                let changed = false;

                if (opts.result.nodeOutputs) {
                    state.nodeOutputs = { ...opts.result.nodeOutputs };
                    changed = true;
                }

                if (opts.result.sessionMessages?.length) {
                    state.sessionMessages = [...opts.result.sessionMessages];
                    changed = true;
                }

                if (opts.result.usage && !state.usage) {
                    state.usage = opts.result.usage;
                    changed = true;
                }

                if (
                    opts.result.tokenUsageDetails?.length &&
                    !state.tokenUsageDetails
                ) {
                    state.tokenUsageDetails = opts.result.tokenUsageDetails;
                    changed = true;
                }

                if (
                    opts.result.executionOrder?.length &&
                    state.executionOrder.length === 0
                ) {
                    state.executionOrder = [...opts.result.executionOrder];
                    changed = true;
                }

                if (!state.lastActiveNodeId && opts.result.lastActiveNodeId) {
                    state.lastActiveNodeId = opts.result.lastActiveNodeId;
                    changed = true;
                }

                if (!state.finalNodeId && opts.result.finalNodeId) {
                    state.finalNodeId = opts.result.finalNodeId;
                    changed = true;
                }

                if (!state.finalOutput && opts.result.finalOutput) {
                    state.finalOutput = opts.result.finalOutput;
                    changed = true;
                }

                if (changed) {
                    state.version++;
                }
            }
            return;
        }

        finalized = true;

        // Flush any pending tokens
        if (rafId !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(rafId);
            } else {
                clearTimeout(rafId);
            }
            flush();
        }

        const result = opts?.result;

        if (result?.executionOrder?.length) {
            state.executionOrder = [...result.executionOrder];
        }

        if (result?.lastActiveNodeId) {
            state.lastActiveNodeId = result.lastActiveNodeId;
        }

        if (result?.finalNodeId) {
            state.finalNodeId = result.finalNodeId;
        }

        if (result?.tokenUsageDetails?.length) {
            state.tokenUsageDetails = result.tokenUsageDetails;
        }

        if (result?.usage) {
            state.usage = result.usage;
            // Prefer aggregated usage when provided
            if (result.usage.totalTokens !== undefined) {
                totalTokens = result.usage.totalTokens;
            }
        }

        const nodeOutputs =
            result?.nodeOutputs || deriveNodeOutputs(state.nodeStates);
        state.nodeOutputs = nodeOutputs;

        if (result?.sessionMessages?.length) {
            state.sessionMessages = [...result.sessionMessages];
        }

        if (opts?.error || result?.error) {
            state.error = opts?.error || result?.error || null;
            state.executionState = 'error';
        } else if (opts?.stopped) {
            state.executionState = 'interrupted';
        } else {
            state.executionState = 'completed';
            // Only set finalOutput on successful completion
            if (result?.finalOutput) {
                state.finalOutput = result.finalOutput;
            } else if (state.finalStreamingText) {
                state.finalOutput = state.finalStreamingText;
            } else {
                // Fallback: get last node's output from execution order
                const lastNodeId = (result?.executionOrder ||
                    state.executionOrder)[
                    (result?.executionOrder || state.executionOrder).length - 1
                ];
                if (lastNodeId) {
                    const lastNode = state.nodeStates[lastNodeId];
                    if (lastNode?.output) {
                        state.finalOutput = lastNode.output;
                    }
                }
            }
        }

        state.isActive = false;
        state.currentNodeId = null;
        state.version++;
    }

    function reset() {
        if (rafId !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(rafId);
            } else {
                clearTimeout(rafId);
            }
            rafId = null;
        }
        pendingNodeTokens.clear();
        pendingBranchTokens.clear();
        finalized = false;

        state.attachments = undefined;
        state.imageCaption = undefined;
        state.executionState = 'running';
        state.nodeStates = {};
        state.executionOrder = [];
        state.lastActiveNodeId = null;
        state.finalNodeId = null;
        state.currentNodeId = null;
        state.branches = {};
        state.finalOutput = '';
        state.finalStreamingText = '';
        state.tokenUsageDetails = undefined;
        state.usage = undefined;
        state.isActive = true;
        state.error = null;
        state.failedNodeId = null;
        state.nodeOutputs = undefined;
        state.sessionMessages = undefined;
        state.hitlRequests = {};
        state.version++;
    }

    function toMessageData(
        workflowId: string,
        workflowName: string,
        prompt: string
    ): WorkflowMessageData {
        const plainNodeStates = Object.fromEntries(
            Object.entries(state.nodeStates).map(([id, node]) => [
                id,
                { ...node },
            ])
        );

        const plainBranches = Object.keys(state.branches).length
            ? Object.fromEntries(
                  Object.entries(state.branches).map(([id, branch]) => [
                      id,
                      { ...branch },
                  ])
              )
            : undefined;

        const nodeOutputs =
            state.nodeOutputs || deriveNodeOutputs(state.nodeStates);

        const shouldResume =
            state.executionState === 'error' ||
            state.executionState === 'interrupted' ||
            state.executionState === 'stopped';

        const resumeStartNodeId = shouldResume
            ? deriveStartNodeId({
                  failedNodeId: state.failedNodeId,
                  currentNodeId: state.currentNodeId,
                  nodeStates: state.nodeStates,
                  lastActiveNodeId: state.lastActiveNodeId,
              })
            : undefined;

        const resumeState = resumeStartNodeId
            ? {
                  startNodeId: resumeStartNodeId,
                  nodeOutputs,
                  executionOrder: [...state.executionOrder],
                  lastActiveNodeId: state.lastActiveNodeId,
                  sessionMessages: state.sessionMessages,
                  resumeInput:
                      (state.lastActiveNodeId
                          ? nodeOutputs[state.lastActiveNodeId]
                          : undefined) || undefined,
              }
            : undefined;

        return {
            type: 'workflow-execution',
            workflowId,
            workflowName,
            prompt,
            attachments: state.attachments,
            imageCaption: state.imageCaption,
            executionState: state.executionState,
            nodeStates: plainNodeStates,
            executionOrder: [...state.executionOrder],
            currentNodeId: state.currentNodeId,
            lastActiveNodeId: state.lastActiveNodeId,
            finalNodeId: state.finalNodeId,
            branches: plainBranches,
            hitlRequests:
                state.hitlRequests && Object.keys(state.hitlRequests).length
                    ? { ...state.hitlRequests }
                    : undefined,
            finalOutput: state.finalOutput,
            failedNodeId: state.failedNodeId || undefined,
            nodeOutputs,
            sessionMessages: state.sessionMessages,
            resumeState,
            result:
                state.executionState !== 'running'
                    ? {
                          success: state.executionState === 'completed',
                          duration: calculateDuration(state.nodeStates),
                          totalTokens:
                              state.usage?.totalTokens ||
                              totalTokens ||
                              undefined,
                          error: state.error?.message,
                          usage: state.usage,
                          tokenUsageDetails: state.tokenUsageDetails,
                      }
                    : undefined,
        };
    }

    function setWorkflowInfo(id: string, name: string) {
        state.workflowId = id;
        state.workflowName = name;
        propagateToSubflows((target) => {
            target.workflowId = id;
            target.workflowName = name;
        });
        touchState(state);
    }

    function setAttachments(attachments?: Attachment[]) {
        state.attachments = attachments;
        propagateToSubflows((target) => {
            target.attachments = attachments;
        });
        touchState(state);
    }

    function setImageCaption(caption?: string) {
        state.imageCaption = caption;
        propagateToSubflows((target) => {
            target.imageCaption = caption;
        });
        touchState(state);
    }

    function propagateToSubflows(
        fn: (target: UiWorkflowState) => void,
        targetState: WorkflowStreamingState | UiWorkflowState = state
    ) {
        for (const node of Object.values(targetState.nodeStates)) {
            if (!node.subflowState) continue;
            fn(node.subflowState);
            propagateToSubflows(fn, node.subflowState);
        }
    }

    return {
        state,
        setWorkflowInfo,
        setAttachments,
        setImageCaption,
        nodeStart,
        nodeToken,
        nodeReasoning,
        nodeFinish,
        nodeError,
        branchStart,
        branchToken,
        branchReasoning,
        branchComplete,
        toolCallEvent,
        hitlRequest,
        hitlResolve,
        finalize,
        workflowToken,
        reset,
        toMessageData,
        routeSelected,
        tokenUsage,
    };
}

function calculateDuration(nodeStates: Record<string, NodeState>): number {
    const nodes = Object.values(nodeStates);
    if (nodes.length === 0) return 0;

    const startTimes = nodes
        .map((n) => n.startedAt)
        .filter((t): t is number => t !== undefined);
    const endTimes = nodes
        .map((n) => n.finishedAt)
        .filter((t): t is number => t !== undefined);

    if (startTimes.length === 0) return 0;

    const earliest = Math.min(...startTimes);
    const latest = endTimes.length > 0 ? Math.max(...endTimes) : Date.now();

    return latest - earliest;
}

function deriveNodeOutputs(
    nodeStates: Record<string, NodeState>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(nodeStates)
            .filter(([, node]) => typeof node.output === 'string')
            .map(([id, node]) => [id, node.output])
    );
}
