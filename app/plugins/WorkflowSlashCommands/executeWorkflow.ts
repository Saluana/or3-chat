/**
 * Workflow Slash Commands - Execution Service
 *
 * Handles workflow execution with streaming output and conversation history.
 */

import type {
    WorkflowData,
    ExecutionCallbacks,
    ExecutionResult,
    ResumeFromOptions,
    ExecutableToolDefinition,
} from '@or3/workflow-core';
import { deriveMessageContent } from '~/utils/chat/messages';
import { useToolRegistry } from '~/utils/chat/tool-registry';

// WorkflowTokenMetadata shape (not exported from core, define inline)
interface WorkflowTokenMetadata {
    nodeId?: string;
    branchId?: string;
    [key: string]: unknown;
}

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
    /** Resume from a failed node without re-running completed steps */
    resumeFrom?: ResumeFromOptions;
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

function getWorkflowTools(): ExecutableToolDefinition[] {
    const registry = useToolRegistry();
    return registry.listTools.value
        .filter((tool) => tool.enabled.value)
        .map((tool) => ({
            type: 'function' as const,
            function: tool.definition.function,
            handler: tool.handler,
        }));
}

async function executeToolCallViaRegistry(
    name: string,
    args: unknown
): Promise<string> {
    const registry = useToolRegistry();

    let serializedArgs: string;
    if (typeof args === 'string') {
        serializedArgs = args;
    } else {
        try {
            serializedArgs = JSON.stringify(args ?? {});
        } catch {
            serializedArgs = '';
        }
    }

    const execution = await registry.executeTool(name, serializedArgs);
    if (execution.error) {
        throw new Error(execution.error);
    }
    return execution.result ?? '';
}

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
        resumeFrom,
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

        // Determine start node (needed when seeding session messages via resumeFrom)
        const startNodeId =
            validatedWorkflow.nodes.find((n: any) => n?.type === 'start')?.id ||
            validatedWorkflow.nodes[0]?.id ||
            'start';

        // Seed session history with prior thread messages (and current prompt) so LLM nodes see context
        // Limit to last 20 messages to avoid inflating context/memory during streaming
        const MAX_HISTORY_MESSAGES = 20;
        const rawHistory = Array.isArray(conversationHistory)
            ? conversationHistory
            : [];
        const historyMessages =
            rawHistory.length > MAX_HISTORY_MESSAGES
                ? rawHistory.slice(-MAX_HISTORY_MESSAGES)
                : [...rawHistory];
        if (historyMessages.length) {
            historyMessages.push({
                role: 'user',
                content: prompt || 'Execute workflow',
            });
        }

        const resumeFromWithHistory =
            historyMessages.length && !resumeFrom?.sessionMessages
                ? ({
                      startNodeId: resumeFrom?.startNodeId ?? startNodeId,
                      nodeOutputs: resumeFrom?.nodeOutputs ?? {},
                      executionOrder: resumeFrom?.executionOrder,
                      lastActiveNodeId: resumeFrom?.lastActiveNodeId,
                      sessionMessages: historyMessages,
                      resumeInput: resumeFrom?.resumeInput,
                      finalNodeId: resumeFrom?.finalNodeId,
                  } satisfies ResumeFromOptions)
                : resumeFrom;

        const workflowTools = getWorkflowTools();

        // Create execution adapter
        // Cast to any to handle version mismatch between SDK versions
        adapter = new OpenRouterExecutionAdapter(client as any, {
            defaultModel: 'openai/gpt-4o-mini',
            preflight: true,
            resumeFrom: resumeFromWithHistory,
            tools: workflowTools,
            onToolCall: executeToolCallViaRegistry,
        });

        // Build callbacks
        const callbacks: ExecutionCallbacks = {
            onNodeStart: onNodeStart || (() => {}),
            onNodeFinish: onNodeFinish || (() => {}),
            onNodeError: (_nodeId, error) => onError?.(error),
            onToken: (_nodeId, token) => onToken(token),
            onWorkflowToken: (token: string, meta: unknown) => {
                if (extraCallbacks?.onWorkflowToken) {
                    extraCallbacks.onWorkflowToken(token, meta as any);
                } else if (options.onWorkflowToken) {
                    options.onWorkflowToken(
                        token,
                        meta as WorkflowTokenMetadata
                    );
                } else {
                    onToken(token);
                }
            },
            onComplete: extraCallbacks?.onComplete,
            ...extraCallbacks,
        };

        try {
            // Build workflow with conversation history
            const workflowWithHistory = {
                ...validatedWorkflow,
                conversationHistory,
            } as WorkflowData & { conversationHistory: ChatMessage[] };
            const inputPayload = {
                text: prompt,
                conversationHistory,
            };

            // Execute the workflow
            const result = await adapter.execute(
                workflowWithHistory as any,
                inputPayload as any,
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
 * Handles both regular chat messages and workflow execution messages.
 * For workflow messages, the prompt becomes a user message and finalOutput becomes assistant.
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
        const { isWorkflowMessageData } = await import(
            '~/utils/chat/workflow-types'
        );

        const messages = await db.messages
            .where('thread_id')
            .equals(threadId)
            .sortBy('index');

        const result: ChatMessage[] = [];

        for (const m of messages) {
            if ((m as any).deleted) continue;
            // Handle workflow execution messages specially
            if (isWorkflowMessageData(m.data)) {
                // Add the user's prompt that triggered the workflow
                if (m.data.prompt) {
                    result.push({
                        role: 'user',
                        content: m.data.prompt,
                    });
                }
                // Add the workflow's final output as assistant response
                if (m.data.finalOutput) {
                    result.push({
                        role: 'assistant',
                        content: m.data.finalOutput,
                    });
                }
            } else {
                // Regular message - extract content
                const role = m.role as 'user' | 'assistant' | 'system';
                const content = deriveMessageContent({
                    data: m.data as any,
                    // Dexie rows don't normally store top-level content, but include for completeness
                    content:
                        typeof (m as any).content === 'string'
                            ? ((m as any).content as string)
                            : undefined,
                });
                if (content) {
                    result.push({ role, content });
                }
            }
        }

        return result;
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
