/**
 * Workflow Slash Commands - Execution Service
 *
 * Handles workflow execution with streaming output and conversation history.
 */

import type {
    WorkflowData,
    ExecutionCallbacks,
    ExecutionResult,
    WorkflowTokenMetadata,
} from '@or3/workflow-core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Chat message format for conversation history
 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/**
 * Options for workflow execution
 */
export interface WorkflowExecutionOptions {
    /** The workflow data to execute */
    workflow: WorkflowData;
    /** User's prompt/input text */
    prompt: string;
    /** Conversation history for context */
    conversationHistory: ChatMessage[];
    /** OpenRouter API key */
    apiKey: string;
    /** Callback for each streamed token */
    onToken: (token: string) => void;
    /** Callback for workflow-level streamed token (leaf aggregation) */
    onWorkflowToken?: (token: string, meta?: WorkflowTokenMetadata) => void;
    /** Callback when a node starts executing */
    onNodeStart?: (nodeId: string) => void;
    /** Callback when a node finishes */
    onNodeFinish?: (nodeId: string, output: string) => void;
    /** Callback for execution errors */
    onError?: (error: Error) => void;
    /** Additional execution callbacks */
    callbacks?: Partial<ExecutionCallbacks>;
}

/**
 * Result of parsing a slash command
 */
export interface ParsedSlashCommand {
    /** The workflow name (after /) */
    workflowName: string;
    /** The workflow ID (if stored in node) */
    workflowId?: string;
    /** The remaining prompt text */
    prompt: string;
}

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse a slash command from message text.
 * Format: /WorkflowName prompt text here
 *
 * @param text - The full message text
 * @returns Parsed command or null if not a slash command
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
    const trimmed = text.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
        return null;
    }

    // Extract workflow name (everything after / until first space or end)
    const match = trimmed.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
    if (!match) {
        return null;
    }

    const workflowName = match[1] || '';
    const prompt = match[2]?.trim() || '';

    if (!workflowName) {
        return null;
    }

    return {
        workflowName,
        prompt,
    };
}

// ─────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────

/**
 * Result of workflow execution
 */
export interface WorkflowExecutionResult {
    /** The execution result from the adapter */
    result: ExecutionResult | null;
    /** Whether execution was stopped early */
    stopped: boolean;
}

/**
 * Controller for managing workflow execution
 */
export interface WorkflowExecutionController {
    /** Promise that resolves when execution completes */
    promise: Promise<WorkflowExecutionResult>;
    /** Stop the workflow execution */
    stop: () => void;
    /** Check if execution is running */
    isRunning: () => boolean;
}

/**
 * Validate and normalize workflow data structure.
 * Ensures nodes and edges are arrays.
 *
 * @param data - Raw workflow data from database
 * @returns Normalized WorkflowData
 * @throws Error if workflow structure is invalid
 */
function validateWorkflow(data: unknown): WorkflowData {
    if (!data || typeof data !== 'object') {
        throw new Error('Workflow data is not an object');
    }

    const wf = data as Record<string, unknown>;

    // Ensure nodes is an array
    if (!Array.isArray(wf.nodes)) {
        throw new Error(
            `Workflow must have nodes[] array, got: ${typeof wf.nodes}`
        );
    }

    // Ensure edges is an array
    if (!Array.isArray(wf.edges)) {
        throw new Error(
            `Workflow must have edges[] array, got: ${typeof wf.edges}`
        );
    }

    // Ensure meta exists
    if (!wf.meta || typeof wf.meta !== 'object') {
        throw new Error('Workflow must have meta object');
    }

    return {
        meta: wf.meta as WorkflowData['meta'],
        nodes: wf.nodes,
        edges: wf.edges,
    };
}

/**
 * Execute a workflow with streaming output.
 * Returns a controller that allows stopping the execution.
 *
 * @param options - Execution options
 * @returns Execution controller with promise and stop method
 */
export function executeWorkflow(
    options: WorkflowExecutionOptions
): WorkflowExecutionController {
    const {
        workflow,
        prompt,
        conversationHistory,
        apiKey,
        onToken,
        onNodeStart,
        onNodeFinish,
        onError,
        callbacks: extraCallbacks,
    } = options;

    let adapter: any = null;
    let stopped = false;

    const promise = (async () => {
        // Validate workflow structure before execution
        let validatedWorkflow: WorkflowData;
        try {
            validatedWorkflow = validateWorkflow(workflow);
        } catch (error) {
            const err =
                error instanceof Error
                    ? error
                    : new Error('Invalid workflow structure');
            console.error('[workflow-slash] Validation failed:', err.message);
            console.error('[workflow-slash] Workflow data:', workflow);
            onError?.(err);
            throw err;
        }

        // Dynamically import to avoid SSR issues
        const { OpenRouterExecutionAdapter } = await import(
            '@or3/workflow-core'
        );
        const { OpenRouter } = await import('@openrouter/sdk');

        // Create OpenRouter client
        const client = new OpenRouter({ apiKey });

        // Create execution adapter
        // Cast to any to handle version mismatch between SDK versions
        adapter = new OpenRouterExecutionAdapter(client as any, {
            defaultModel: 'openai/gpt-4o-mini',
            preflight: true,
        });

        // Build callbacks
        const callbacks: ExecutionCallbacks = {
            onNodeStart: onNodeStart || (() => {}),
            onNodeFinish: onNodeFinish || (() => {}),
            onNodeError: (_nodeId, error) => onError?.(error),
            onToken: (_nodeId, token) => onToken(token),
            onWorkflowToken: (token, meta) =>
                extraCallbacks?.onWorkflowToken?.(token, meta) ||
                options.onWorkflowToken?.(token, meta) ||
                onToken(token),
            onComplete: extraCallbacks?.onComplete,
            ...extraCallbacks,
        };

        try {
            // Build workflow with conversation history
            const workflowWithHistory = {
                ...validatedWorkflow,
                conversationHistory,
            } as WorkflowData & { conversationHistory: ChatMessage[] };

            // Execute the workflow
            const result = await adapter.execute(
                workflowWithHistory as any,
                { text: prompt },
                callbacks
            );

            return { result, stopped };
        } catch (error) {
            // Check if this was a stop/abort
            if (stopped) {
                return { result: null, stopped: true };
            }
            onError?.(
                error instanceof Error ? error : new Error(String(error))
            );
            throw error;
        }
    })();

    return {
        promise,
        stop: () => {
            stopped = true;
            if (adapter && typeof adapter.stop === 'function') {
                adapter.stop();
            }
        },
        isRunning: () => {
            return adapter ? adapter.isRunning() : false;
        },
    };
}

/**
 * Get conversation history from a thread.
 *
 * @param threadId - The thread ID to load messages from
 * @returns Array of chat messages
 */
export async function getConversationHistory(
    threadId: string
): Promise<ChatMessage[]> {
    if (!threadId) {
        return [];
    }

    try {
        const { db } = await import('~/db');

        const messages = await db.messages
            .where('thread_id')
            .equals(threadId)
            .sortBy('index');

        return messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content:
                typeof m.data?.content === 'string'
                    ? m.data.content
                    : JSON.stringify(m.data?.content || ''),
        }));
    } catch (error) {
        console.error('[workflow-slash] Failed to load history:', error);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

export default {
    parseSlashCommand,
    executeWorkflow,
    getConversationHistory,
};
