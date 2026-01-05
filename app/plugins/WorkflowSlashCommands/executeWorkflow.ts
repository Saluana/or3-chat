/**
 * Workflow Slash Commands - Execution Service
 *
 * Handles workflow execution with streaming output and conversation history.
 */

import {
    DefaultSubflowRegistry,
    createDefaultInputMappings,
    createSubflowDefinition,
    isSubflowNodeData,
    modelRegistry,
} from '@or3/workflow-core';
import type {
    WorkflowData,
    ExecutionCallbacks,
    ExecutionResult,
    ResumeFromOptions,
    ExecutableToolDefinition,
    HITLRequest,
    HITLResponse,
    Attachment,
} from '@or3/workflow-core';
import { deriveMessageContent } from '~/utils/chat/messages';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { listWorkflowsWithMeta } from './useWorkflowSlashCommands';

// WorkflowTokenMetadata shape (not exported from core, define inline)
interface WorkflowTokenMetadata {
    nodeId?: string;
    branchId?: string;
    [key: string]: unknown;
}

type ToolCallEventWithNode = {
    id: string;
    name: string;
    status: 'active' | 'completed' | 'error';
    error?: string;
    nodeId: string;
    nodeType?: string;
    nodeLabel?: string;
    branchId?: string;
    branchLabel?: string;
};

const DEFAULT_TOOL_MODEL = 'openai/gpt-4o-mini';

interface ToolModelWarning {
    nodeId: string;
    nodeType: string;
    nodeLabel?: string;
    branchId?: string;
    branchLabel?: string;
    modelId?: string;
    fallbackModelId: string;
    reason: string;
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
    /** Tool call lifecycle events */
    onToolCallEvent?: (event: ToolCallEventWithNode) => void;
    /** HITL (human-in-the-loop) callback */
    onHITLRequest?: (request: HITLRequest) => Promise<HITLResponse>;
    /** Resume from a failed node without re-running completed steps */
    resumeFrom?: ResumeFromOptions;
    /** Attachments (files, images) to include */
    attachments?: Attachment[];
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
export function parseSlashCommand(
    text: string,
    workflowNames: string[] = []
): ParsedSlashCommand | null {
    const trimmed = text.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
        return null;
    }

    const raw = trimmed.slice(1);
    if (!raw.trim()) {
        return null;
    }

    // Allow quoted workflow names: /"My Workflow" prompt
    const quotedMatch = raw.match(/^(["'])(.+?)\1\s*(.*)$/s);
    if (quotedMatch) {
        return {
            workflowName: quotedMatch[2]?.trim() || '',
            prompt: quotedMatch[3]?.trim() || '',
        };
    }

    // Prefer exact workflow title matches (handles spaces and missing separators)
    const candidates = workflowNames
        .map((name) => name.trim())
        .filter(Boolean);
    if (candidates.length) {
        const rawLower = raw.toLowerCase();
        let best: string | null = null;
        for (const name of candidates) {
            if (!rawLower.startsWith(name.toLowerCase())) continue;
            if (!best || name.length > best.length) best = name;
        }

        if (best) {
            return {
                workflowName: best,
                prompt: raw.slice(best.length).trimStart(),
            };
        }
    }

    // Fallback: treat first token as the workflow name
    const match = raw.match(/^([^\s]+)(?:\s+(.*))?$/s);
    if (!match) {
        return null;
    }

    const workflowName = match[1] || '';
    if (!workflowName) {
        return null;
    }

    return {
        workflowName,
        prompt: match[2]?.trim() || '',
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
            // Cast handler to match ExecutableToolDefinition signature
            // ToolHandler<Record<string, unknown>> is compatible with (args: unknown) => string
            handler: tool.handler as (args: unknown) => Promise<string> | string,
        }));
}

function getToolSupport(modelId?: string): 'supported' | 'unsupported' | 'unknown' {
    if (!modelId) return 'unknown';
    const info = modelRegistry.get(modelId);
    if (!info) return 'unknown';
    return modelRegistry.supportsTools(modelId) ? 'supported' : 'unsupported';
}

function pickToolFallbackModel(defaultModel: string): string {
    if (getToolSupport(defaultModel) === 'supported') return defaultModel;
    const toolModels = modelRegistry.getToolCapableModels();
    const firstToolModel = toolModels[0];
    return firstToolModel ? firstToolModel.id : defaultModel;
}

function ensureToolCapableModels(
    workflow: WorkflowData,
    fallbackModel: string
): { workflow: WorkflowData; warnings: ToolModelWarning[] } {
    const warnings: ToolModelWarning[] = [];
    let changed = false;

    const nodes = workflow.nodes.map((node) => {
        if (node.type === 'agent') {
            const data = node.data as {
                tools?: string[];
                model?: string;
                label?: string;
            };
            const hasTools = Array.isArray(data.tools) && data.tools.length > 0;
            if (!hasTools) return node;

            const support = getToolSupport(data.model);
            if (support === 'unsupported') {
                warnings.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    nodeLabel: data.label,
                    modelId: data.model,
                    fallbackModelId: fallbackModel,
                    reason: 'agent_model_no_tool_support',
                });
                changed = true;
                return {
                    ...node,
                    data: {
                        ...node.data,
                        model: fallbackModel,
                    },
                } as typeof node;
            }
            if (support === 'unknown') {
                warnings.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    nodeLabel: data.label,
                    modelId: data.model,
                    fallbackModelId: fallbackModel,
                    reason: 'agent_model_tool_support_unknown',
                });
            }
            return node;
        }

        if (node.type === 'parallel') {
            const data = node.data as {
                model?: string;
                label?: string;
                branches?: Array<{
                    id: string;
                    label: string;
                    model?: string;
                    tools?: string[];
                }>;
            };

            const branches = Array.isArray(data.branches) ? data.branches : [];
            let branchesChanged = false;
            const updatedBranches = branches.map((branch) => {
                const hasTools =
                    Array.isArray(branch.tools) && branch.tools.length > 0;
                if (!hasTools) return branch;

                const resolvedModel = branch.model || data.model;
                const support = getToolSupport(resolvedModel);

                if (support === 'unsupported') {
                    warnings.push({
                        nodeId: node.id,
                        nodeType: node.type,
                        nodeLabel: data.label,
                        branchId: branch.id,
                        branchLabel: branch.label,
                        modelId: resolvedModel,
                        fallbackModelId: fallbackModel,
                        reason: 'parallel_branch_model_no_tool_support',
                    });
                    branchesChanged = true;
                    return { ...branch, model: fallbackModel };
                }

                if (!resolvedModel) {
                    warnings.push({
                        nodeId: node.id,
                        nodeType: node.type,
                        nodeLabel: data.label,
                        branchId: branch.id,
                        branchLabel: branch.label,
                        modelId: resolvedModel,
                        fallbackModelId: fallbackModel,
                        reason: 'parallel_branch_model_missing_for_tools',
                    });
                    branchesChanged = true;
                    return { ...branch, model: fallbackModel };
                }

                if (support === 'unknown') {
                    warnings.push({
                        nodeId: node.id,
                        nodeType: node.type,
                        nodeLabel: data.label,
                        branchId: branch.id,
                        branchLabel: branch.label,
                        modelId: resolvedModel,
                        fallbackModelId: fallbackModel,
                        reason: 'parallel_branch_model_tool_support_unknown',
                    });
                }

                return branch;
            });

            if (!branchesChanged) return node;

            changed = true;
            return {
                ...node,
                data: {
                    ...node.data,
                    branches: updatedBranches,
                },
            } as typeof node;
        }

        return node;
    });

    return {
        workflow: changed ? { ...workflow, nodes } : workflow,
        warnings,
    };
}

function collectWorkflowToolNames(workflow: WorkflowData): Set<string> {
    const tools = new Set<string>();

    for (const node of workflow.nodes) {
        if (node.type === 'agent') {
            const data = node.data as { tools?: string[] };
            if (Array.isArray(data.tools)) {
                data.tools
                    .map((tool) => tool?.trim())
                    .filter((tool): tool is string => Boolean(tool))
                    .forEach((tool) => tools.add(tool));
            }
        }

        if (node.type === 'parallel') {
            const data = node.data as {
                tools?: string[];
                branches?: Array<{ tools?: string[] }>;
            };
            if (Array.isArray(data.tools)) {
                data.tools
                    .map((tool) => tool?.trim())
                    .filter((tool): tool is string => Boolean(tool))
                    .forEach((tool) => tools.add(tool));
            }
            if (Array.isArray(data.branches)) {
                for (const branch of data.branches) {
                    if (!branch || !Array.isArray(branch.tools)) continue;
                    branch.tools
                        .map((tool) => tool?.trim())
                        .filter((tool): tool is string => Boolean(tool))
                        .forEach((tool) => tools.add(tool));
                }
            }
        }
    }

    return tools;
}

function preflightToolAvailability(workflow: WorkflowData): void {
    const registry = useToolRegistry();
    const toolNames = collectWorkflowToolNames(workflow);
    if (toolNames.size === 0) return;

    const missing: string[] = [];
    const disabled: string[] = [];

    for (const name of toolNames) {
        const tool = registry.getTool(name);
        if (!tool) {
            missing.push(name);
            continue;
        }
        if (!tool.enabled.value) {
            disabled.push(name);
        }
    }

    if (missing.length || disabled.length) {
        const parts: string[] = [];
        if (missing.length) {
            parts.push(`Missing tools: ${missing.join(', ')}`);
        }
        if (disabled.length) {
            parts.push(`Disabled tools: ${disabled.join(', ')}`);
        }
        throw new Error(
            `${parts.join('. ')}. Please update the workflow or enable the tool(s).`
        );
    }
}

function buildSubflowRegistry(records: {
    id: string;
    title: string;
    meta: WorkflowData | null;
}[]): DefaultSubflowRegistry {
    const registry = new DefaultSubflowRegistry();

    for (const record of records) {
        if (!record.meta) continue;
        const description =
            typeof (record.meta as any)?.description === 'string'
                ? ((record.meta as any).description as string)
                : undefined;
        registry.register(
            createSubflowDefinition(record.id, record.title, record.meta, {
                description,
            })
        );
    }

    return registry;
}

function applyDefaultSubflowMappings(
    workflow: WorkflowData,
    registry: DefaultSubflowRegistry
): WorkflowData {
    let changed = false;

    const nodes = workflow.nodes.map((node) => {
        if (node.type !== 'subflow') return node;
        const data = node.data as unknown;
        if (!isSubflowNodeData(data)) return node;

        const subflowData = data as {
            subflowId: string;
            inputMappings: Record<string, unknown>;
        };
        const subflowId = subflowData.subflowId?.trim();
        if (!subflowId) return node;

        const defaults = createDefaultInputMappings(subflowId, registry);
        if (!defaults || Object.keys(defaults).length === 0) return node;

        const inputMappings = subflowData.inputMappings || {};
        const missingRequired = Object.keys(defaults).some(
            (key) => !(key in inputMappings)
        );

        if (!missingRequired) return node;
        changed = true;

        return {
            ...node,
            data: {
                ...subflowData,
                inputMappings: {
                    ...defaults,
                    ...inputMappings,
                },
            },
        } as typeof node;
    });

    return changed ? { ...workflow, nodes } : workflow;
}

function assertSubflowRegistryCoverage(
    workflow: WorkflowData,
    registry: DefaultSubflowRegistry
): void {
    const missing = new Set<string>();

    for (const node of workflow.nodes) {
        if (node.type !== 'subflow') continue;
        const data = node.data as unknown;
        if (!isSubflowNodeData(data)) continue;
        const subflowId = data.subflowId?.trim();
        if (!subflowId) continue;
        if (!registry.has(subflowId)) {
            missing.add(subflowId);
        }
    }

    if (missing.size > 0) {
        const ids = Array.from(missing).join(', ');
        throw new Error(
            `Subflow registry missing definitions for: ${ids}. ` +
                'Subflow IDs must match workflow record IDs.'
        );
    }
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

        const toolFallbackModel = pickToolFallbackModel(DEFAULT_TOOL_MODEL);
        const toolModelCheck = ensureToolCapableModels(
            validatedWorkflow,
            toolFallbackModel
        );
        let workflowForExecution = toolModelCheck.workflow;
        preflightToolAvailability(workflowForExecution);

        const hasSubflows = workflowForExecution.nodes.some(
            (node: any) => node?.type === 'subflow'
        );
        const subflowRegistry = hasSubflows
            ? buildSubflowRegistry(await listWorkflowsWithMeta())
            : undefined;
        if (subflowRegistry) {
            assertSubflowRegistryCoverage(workflowForExecution, subflowRegistry);
            workflowForExecution = applyDefaultSubflowMappings(
                workflowForExecution,
                subflowRegistry
            );
        }

        if (toolModelCheck.warnings.length > 0) {
            console.warn(
                '[workflow-slash] Tool-capable model warnings',
                toolModelCheck.warnings
            );
        }

        // Determine start node (needed when seeding session messages via resumeFrom)
        const startNodeId =
            workflowForExecution.nodes.find((n: any) => n?.type === 'start')
                ?.id ||
            workflowForExecution.nodes[0]?.id ||
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
            defaultModel: DEFAULT_TOOL_MODEL,
            preflight: true,
            resumeFrom: resumeFromWithHistory,
            tools: workflowTools,
            subflowRegistry,
            onToolCall: executeToolCallViaRegistry,
            onToolCallEvent: options.onToolCallEvent,
            onHITLRequest: options.onHITLRequest,
        });

        // Build callbacks
        const callbacks: ExecutionCallbacks = {
            ...extraCallbacks,
            onNodeStart: (nodeId, ...rest) => {
                extraCallbacks?.onNodeStart?.(nodeId, ...rest);
                onNodeStart?.(nodeId);
            },
            onNodeFinish: (nodeId, output, ...rest) => {
                extraCallbacks?.onNodeFinish?.(nodeId, output, ...rest);
                onNodeFinish?.(nodeId, output);
            },
            onNodeError: (nodeId, error, ...rest) => {
                extraCallbacks?.onNodeError?.(nodeId, error, ...rest);
                onError?.(error);
            },
            onToken: (nodeId, token, ...rest) => {
                extraCallbacks?.onToken?.(nodeId, token, ...rest);
                onToken(token);
            },
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
            onComplete: (...args) => {
                extraCallbacks?.onComplete?.(...args);
            },
        };

        try {
            // Build workflow with conversation history
            const workflowWithHistory = {
                ...workflowForExecution,
                conversationHistory,
            } as WorkflowData & { conversationHistory: ChatMessage[] };
            const inputPayload = {
                text: prompt,
                conversationHistory,
                attachments: options.attachments,
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
