/**
 * @module app/utils/chat/workflow-types
 *
 * Purpose:
 * Defines TypeScript types and helpers for workflow execution messages
 * displayed in the chat interface.
 *
 * Behavior:
 * - Provides discriminated unions for workflow vs standard messages
 * - Exposes UI-friendly workflow state types
 *
 * Constraints:
 * - These are structural types only; runtime validation is minimal
 */

import type { Attachment } from 'or3-workflow-core';

// ─────────────────────────────────────────────────────────────────────────────
// Status Types
// ─────────────────────────────────────────────────────────────────────────────

/** Execution status of an individual node within a workflow */
export type NodeExecutionStatus =
    | 'pending'
    | 'active'
    | 'waiting'
    | 'completed'
    | 'error'
    | 'skipped';

/** Overall execution state of a workflow */
export type WorkflowExecutionState =
    | 'idle'
    | 'running'
    | 'completed'
    | 'error'
    | 'stopped'
    | 'interrupted';

export type ToolCallStatus = 'active' | 'completed' | 'error';

export interface ToolCallState {
    id: string;
    name: string;
    status: ToolCallStatus;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
}

export type HitlMode = 'approval' | 'input' | 'review';
export type HitlAction =
    | 'approve'
    | 'reject'
    | 'skip'
    | 'submit'
    | 'modify'
    | 'custom';

export interface HitlRequestState {
    id: string;
    jobId?: string;
    workspaceId?: string;
    nodeId: string;
    nodeLabel: string;
    mode: HitlMode;
    prompt: string;
    options?: Array<{ id: string; label: string; action: HitlAction }>;
    inputSchema?: Record<string, unknown>;
    createdAt: string;
    expiresAt?: string;
    context?: {
        input?: string;
        output?: string;
        workflowName?: string;
        sessionId?: string;
    };
    response?: {
        requestId: string;
        action: HitlAction;
        data?: unknown;
        respondedAt: string;
    };
}

export interface ChatHistoryMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** State of an individual node during workflow execution */
export interface NodeState {
    /** Node execution status */
    status: NodeExecutionStatus;

    /** Node label/name from workflow definition */
    label: string;

    /** Node type (agent, router, parallel, etc.) */
    type: string;

    /** Model identifier used for this node (when applicable) */
    modelId?: string;

    /** Final accumulated output */
    output: string;

    /** Streaming text (cleared on completion, output gets final value) */
    streamingText?: string;

    /** Error message if status is 'error' */
    error?: string;

    /** Start timestamp (ms since epoch) */
    startedAt?: number;

    /** Finish timestamp (ms since epoch) */
    finishedAt?: number;

    /** Token count for this node */
    tokenCount?: number;

    /** Selected route (for router nodes) */
    route?: string;

    /** Tool calls executed by this node */
    toolCalls?: ToolCallState[];

    /** Nested subflow execution state (if this node runs a subflow) */
    subflowState?: UiWorkflowState;
}

/** State of a parallel branch within a workflow node */
export interface BranchState {
    /** Branch ID */
    id: string;

    /** Branch label */
    label: string;

    /** Branch execution status */
    status: NodeExecutionStatus;

    /** Final accumulated output */
    output: string;

    /** Streaming text */
    streamingText?: string;

    /** Tool calls executed by this branch */
    toolCalls?: ToolCallState[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Data Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base message data type for regular chat messages.
 * Used for discriminated union with workflow messages.
 */
export interface BaseMessageData {
    /** Discriminator for regular messages */
    type: 'message';

    /** Reasoning text from model (optional) */
    reasoning_text?: string | null;

    /** Tool calls info (optional) */
    tool_calls?: unknown[];

    /** Allow additional properties */
    [key: string]: unknown;
}

/**
 * Workflow execution message data stored in the message.data field.
 * Uses 'workflow-execution' as a discriminator for type narrowing.
 */
export interface WorkflowMessageData {
    /** Discriminator for workflow messages - enables type narrowing */
    type: 'workflow-execution';

    /** Workflow identification */
    workflowId: string;

    /** Workflow display name */
    workflowName: string;

    /** Original user prompt that triggered the workflow */
    prompt: string;

    /** Attachments available to the workflow execution */
    attachments?: Attachment[];

    /** Auto-generated caption for image attachments */
    imageCaption?: string;

    /** Overall execution state */
    executionState: WorkflowExecutionState;

    /** Per-node execution states, keyed by nodeId */
    nodeStates: Record<string, NodeState>;

    /** Execution order (list of nodeIds in execution sequence) */
    executionOrder: string[];

    /** Last node that produced output */
    lastActiveNodeId?: string | null;

    /** Final node id reported by the engine */
    finalNodeId?: string | null;

    /** Currently active node ID (null when idle or completed) */
    currentNodeId: string | null;

    /** Parallel branch states (for parallel nodes), keyed by "nodeId:branchId" */
    branches?: Record<string, BranchState>;

    /** Pending HITL requests keyed by request ID */
    hitlRequests?: Record<string, HitlRequestState>;

    /** Final output content (from output node or last agent) */
    finalOutput: string;

    /** Node that failed (when executionState === 'error') */
    failedNodeId?: string | null;

    /** Per-node outputs for resume */
    nodeOutputs?: Record<string, string>;

    /** Session messages captured during execution */
    sessionMessages?: ChatHistoryMessage[];

    /** Resume metadata to allow retrying from a failed node */
    resumeState?: WorkflowResumeState;

    /** Version counter for reactivity tracking */
    version?: number;

    /** Execution result metadata (populated on completion) */
    result?: {
        /** Whether execution completed successfully */
        success: boolean;

        /** Total execution duration in milliseconds */
        duration: number;

        /** Total tokens used across all nodes */
        totalTokens?: number;

        /** Aggregated usage from engine (if available) */
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };

        /** Per-node token usage details (if available) */
        tokenUsageDetails?: Array<{
            nodeId: string;
            promptTokens: number;
            completionTokens: number;
            totalTokens?: number;
        }>;

        /** Error message if execution failed */
        error?: string;
    };
}

/**
 * Union type for message data - enables discriminated union pattern.
 * Use `isWorkflowMessageData()` type guard for safe type narrowing.
 */
export type MessageDataUnion = BaseMessageData | WorkflowMessageData;

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `isWorkflowMessageData`
 *
 * Purpose:
 * Type guard for workflow execution message data.
 */
export function isWorkflowMessageData(
    data: unknown
): data is WorkflowMessageData {
    return (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data as { type: unknown }).type === 'workflow-execution'
    );
}

/**
 * `isBaseMessageData`
 *
 * Purpose:
 * Type guard for regular message data.
 */
export function isBaseMessageData(data: unknown): data is BaseMessageData {
    if (data === null || data === undefined) return true;
    if (typeof data !== 'object') return false;
    // If it has a type field that's 'workflow-execution', it's not a base message
    if (
        'type' in data &&
        (data as { type: unknown }).type === 'workflow-execution'
    ) {
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI State Types (for component props)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Workflow state as exposed to UI components via UiChatMessage.workflowState.
 * This is a subset of WorkflowMessageData optimized for reactive rendering.
 */
export interface UiWorkflowState {
    /** Workflow identification */
    workflowId: string;

    /** Workflow display name */
    workflowName: string;

    /** Original user prompt that triggered the workflow */
    prompt?: string;

    /** Attachments available to the workflow execution */
    attachments?: Attachment[];

    /** Auto-generated caption for image attachments */
    imageCaption?: string;

    /** Overall execution state */
    executionState: WorkflowExecutionState;

    /** Per-node execution states */
    nodeStates: Record<string, NodeState>;

    /** Execution order */
    executionOrder: string[];

    /** Last node that produced output */
    lastActiveNodeId?: string | null;

    /** Final node id reported by the engine */
    finalNodeId?: string | null;

    /** Currently active node ID */
    currentNodeId: string | null;

    /** Parallel branch states (optional) */
    branches?: Record<string, BranchState>;

    /** Pending HITL requests keyed by request ID */
    hitlRequests?: Record<string, HitlRequestState>;

    /** Final accumulated output */
    finalOutput?: string;

    /** Live streaming text (before finalOutput is set) */
    finalStreamingText?: string;

    /** Node that failed (if any) */
    failedNodeId?: string | null;

    /** Per-node outputs for resume */
    nodeOutputs?: Record<string, string>;

    /** Session messages captured during execution */
    sessionMessages?: ChatHistoryMessage[];

    /** Resume metadata */
    resumeState?: WorkflowResumeState;

    /** Version counter for reactivity */
    version?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `deriveStartNodeId`
 *
 * Purpose:
 * Determines the best node ID to resume a workflow execution from.
 */
export function deriveStartNodeId(opts: {
    resumeState?: WorkflowResumeState;
    failedNodeId?: string | null;
    currentNodeId?: string | null;
    nodeStates?: Record<string, NodeState>;
    lastActiveNodeId?: string | null;
}): string | undefined {
    const activeFromStates = opts.nodeStates
        ? Object.entries(opts.nodeStates).find(
              ([, ns]) => ns.status === 'active'
          )?.[0]
        : undefined;

    return (
        opts.resumeState?.startNodeId ||
        opts.failedNodeId ||
        opts.currentNodeId ||
        activeFromStates ||
        opts.lastActiveNodeId ||
        undefined
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `MERGE_BRANCH_ID`
 *
 * Purpose:
 * Special branch ID used by parallel nodes for the merge step.
 */
export const MERGE_BRANCH_ID = '__merge__';

/**
 * `MERGE_BRANCH_LABEL`
 *
 * Purpose:
 * Display label for the merge branch.
 */
export const MERGE_BRANCH_LABEL = 'Merging results...';

/** Resume metadata for workflow executions */
export interface WorkflowResumeState {
    /** Node to resume from (usually the failed node) */
    startNodeId: string;
    /** Per-node outputs captured so far */
    nodeOutputs: Record<string, string>;
    /** Execution order up to failure */
    executionOrder: string[];
    /** Last active node when failure occurred */
    lastActiveNodeId?: string | null;
    /** Session messages captured so far */
    sessionMessages?: ChatHistoryMessage[];
    /** Suggested input when resuming (last output) */
    resumeInput?: string;
}
