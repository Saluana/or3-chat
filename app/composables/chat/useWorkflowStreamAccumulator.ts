import { reactive } from 'vue';
import type {
    NodeState,
    BranchState,
    WorkflowExecutionState,
    WorkflowMessageData,
    ChatHistoryMessage,
} from '~/utils/chat/workflow-types';
import { deriveStartNodeId } from '~/utils/chat/workflow-types';

/**
 * Reactive state interface for workflow execution streaming.
 * This state is exposed to UI components for real-time rendering.
 */
export interface WorkflowStreamingState {
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
}

/**
 * API for the workflow stream accumulator.
 * Provides methods to update state based on execution events.
 */
export interface WorkflowStreamAccumulatorApi {
    /** Read-only reactive state */
    state: Readonly<WorkflowStreamingState>;

    // Node lifecycle
    nodeStart(nodeId: string, label: string, type: string): void;
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

    // Workflow-level streaming (leaf aggregation)
    workflowToken(token: string): void;

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

/**
 * Creates a workflow stream accumulator.
 * Manages reactive state updates with RAF batching for performance.
 */
export function createWorkflowStreamAccumulator(): WorkflowStreamAccumulatorApi {
    const state = reactive<WorkflowStreamingState>({
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
    });

    // Pending updates for RAF batching
    let pendingNodeTokens: Map<string, string[]> = new Map();
    let pendingBranchTokens: Map<string, string[]> = new Map();
    let rafId: number | null = null;
    let finalized = false;
    let totalTokens = 0;

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

        // Flush node tokens
        for (const [nodeId, tokens] of pendingNodeTokens) {
            const node = state.nodeStates[nodeId];
            if (node) {
                node.streamingText =
                    (node.streamingText || '') + tokens.join('');
                // Update token count estimate (rough approximation)
                node.tokenCount = (node.tokenCount || 0) + tokens.length;
            }
        }
        pendingNodeTokens.clear();

        // Flush branch tokens
        for (const [key, tokens] of pendingBranchTokens) {
            const branch = state.branches[key];
            if (branch) {
                branch.streamingText =
                    (branch.streamingText || '') + tokens.join('');
            }
        }
        pendingBranchTokens.clear();

        state.version++;
    }

    function nodeStart(nodeId: string, label: string, type: string) {
        if (finalized) return;

        state.nodeStates[nodeId] = {
            status: 'active',
            label,
            type,
            output: '',
            streamingText: '',
            startedAt: Date.now(),
            tokenCount: 0,
        };

        if (!state.executionOrder.includes(nodeId)) {
            state.executionOrder.push(nodeId);
        }

        state.currentNodeId = nodeId;
        state.lastActiveNodeId = nodeId;
        state.version++;
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

        const node = state.nodeStates[nodeId];
        if (node) {
            node.status = 'completed';
            node.output = output;
            node.streamingText = undefined; // Clear streaming buffer
            node.finishedAt = Date.now();
        }

        if (state.currentNodeId === nodeId) {
            state.currentNodeId = null;
        }

        state.lastActiveNodeId = nodeId;

        // Do NOT set finalOutput here - intermediate nodes should not trigger
        // the result box. finalOutput is only set when finalize() is called
        // with the actual workflow result.
        state.version++;
    }

    function nodeError(nodeId: string, error: Error) {
        if (finalized) return;

        const node = state.nodeStates[nodeId];
        if (node) {
            node.status = 'error';
            node.error = error.message;
            node.finishedAt = Date.now();
        }

        state.error = error;
        state.executionState = 'error';
        state.failedNodeId = nodeId;
        state.currentNodeId = nodeId;
        state.version++;
    }

    function workflowToken(token: string) {
        if (finalized || !token) return;
        const next = `${state.finalStreamingText}${token}`;
        state.finalStreamingText = next;
        state.finalOutput = next;
        state.version++;
    }

    function routeSelected(nodeId: string, route: string) {
        if (finalized) return;
        const node = state.nodeStates[nodeId];
        if (node) {
            (node as NodeState & { route?: string }).route = route;
            state.version++;
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
        const node = state.nodeStates[nodeId];
        if (node) {
            const increment = usage.totalTokens ?? 0;
            node.tokenCount = (node.tokenCount || 0) + increment;
            totalTokens += increment;
            state.version++;
        }
    }

    function branchStart(nodeId: string, branchId: string, label: string) {
        if (finalized) return;

        const key = `${nodeId}:${branchId}`;
        state.branches[key] = {
            id: branchId,
            label,
            status: 'active',
            output: '',
            streamingText: '',
        };
        state.version++;
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

        const key = `${nodeId}:${branchId}`;
        const branch = state.branches[key];
        if (branch) {
            branch.status = 'completed';
            // Prefer accumulated streaming text; fall back to engine output
            branch.output = branch.streamingText || output || '';
            branch.streamingText = undefined;
        }
        state.version++;
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
            executionState: state.executionState,
            nodeStates: plainNodeStates,
            executionOrder: [...state.executionOrder],
            currentNodeId: state.currentNodeId,
            lastActiveNodeId: state.lastActiveNodeId,
            finalNodeId: state.finalNodeId,
            branches: plainBranches,
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

    return {
        state,
        nodeStart,
        nodeToken,
        nodeReasoning,
        nodeFinish,
        nodeError,
        branchStart,
        branchToken,
        branchReasoning,
        branchComplete,
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
