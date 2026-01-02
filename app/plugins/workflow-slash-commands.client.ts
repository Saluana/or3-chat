/**
 * Workflow Slash Commands - Nuxt Client Plugin
 *
 * Registers the slash command TipTap extension via the hooks system.
 * When a user types `/`, a popover shows available workflows.
 * Selecting a workflow inserts a styled workflow node.
 *
 * Also intercepts message sends to detect and execute workflow commands.
 */

import { defineNuxtPlugin } from '#app';
import { useAppConfig, useHooks, useToast } from '#imports';
import type { Extension, Node } from '@tiptap/core';
import type {
    ToolCallEventWithNode,
    HITLRequest,
    HITLResponse,
} from '@or3/workflow-core';
import type { OpenRouterMessage } from '~/core/hooks/hook-types';
import type { WorkflowExecutionController } from './WorkflowSlashCommands/executeWorkflow';
import { createWorkflowStreamAccumulator } from '~/composables/chat/useWorkflowStreamAccumulator';
import { nowSec } from '~/db/util';
import { reportError } from '~/utils/errors';
import {
    isWorkflowMessageData,
    deriveStartNodeId,
    type HitlRequestState,
    type HitlAction,
} from '~/utils/chat/workflow-types';

// Types for lazy-loaded modules
interface SlashCommandsModule {
    SlashCommand: Extension;
    WorkflowNode: Node;
    createSlashCommandSuggestion: typeof import('./WorkflowSlashCommands/suggestions').createSlashCommandSuggestion;
    searchWorkflows: typeof import('./WorkflowSlashCommands/useWorkflowSlashCommands').searchWorkflows;
    getWorkflowByName: typeof import('./WorkflowSlashCommands/useWorkflowSlashCommands').getWorkflowByName;
    getWorkflowById: typeof import('./WorkflowSlashCommands/useWorkflowSlashCommands').getWorkflowById;
}

interface ExecutionModule {
    parseSlashCommand: typeof import('./WorkflowSlashCommands/executeWorkflow').parseSlashCommand;
    executeWorkflow: typeof import('./WorkflowSlashCommands/executeWorkflow').executeWorkflow;
    getConversationHistory: typeof import('./WorkflowSlashCommands/executeWorkflow').getConversationHistory;
}

type WorkflowPost = NonNullable<
    Awaited<ReturnType<NonNullable<SlashCommandsModule['getWorkflowByName']>>>
>;
type WorkflowPostWithMeta = WorkflowPost & {
    meta: NonNullable<WorkflowPost['meta']>;
};

function hasWorkflowMeta(
    post: WorkflowPost | null | undefined
): post is WorkflowPostWithMeta {
    return !!post && !!post.meta;
}

// Config type
interface WorkflowSlashConfig {
    enabled?: boolean;
    debounceMs?: number;
}

// Message payload type
type MessagesPayload =
    | { messages: OpenRouterMessage[] }
    | { messages: OpenRouterMessage[] }[];

function normalizeMessagesPayload(
    payload: MessagesPayload
): OpenRouterMessage[] {
    if (Array.isArray(payload)) {
        return payload.flatMap((p) => p.messages);
    }
    if ('messages' in payload && Array.isArray(payload.messages)) {
        return payload.messages;
    }
    return [];
}

// ─────────────────────────────────────────────────────────────
// Active Execution Tracking (for stop functionality)
// ─────────────────────────────────────────────────────────────

let activeController: WorkflowExecutionController | null = null;
const pendingHitlRequests = new Map<
    string,
    {
        messageId: string;
        request: HitlRequestState;
        resolve: (response: HITLResponse) => void;
        onResolve: (response: HITLResponse) => void;
    }
>();

/**
 * Pending assistant message context for workflow execution.
 * Set by ai.chat.send:action:before, consumed by the filter hook.
 */
let pendingAssistantContext: {
    id: string;
    streamId: string;
    threadId?: string;
} | null = null;

/**
 * Pending TipTap editor JSON captured right before send.
 * Used to extract workflow node metadata for slash commands.
 */
let pendingEditorJson: unknown | null = null;

/**
 * Flag to signal that a workflow is handling the current request.
 * This is checked by the chat system to skip the AI call.
 */
let workflowHandlingRequest = false;

/**
 * Get and reset the workflow handling flag.
 * Called by the chat system to check if it should skip the AI call.
 */
export function consumeWorkflowHandlingFlag(): boolean {
    const was = workflowHandlingRequest;
    workflowHandlingRequest = false;
    return was;
}

/**
 * Stop the currently running workflow execution.
 * Can be called from anywhere in the app.
 */
export function stopWorkflowExecution(): boolean {
    if (activeController) {
        activeController.stop();
        activeController = null;
        return true;
    }
    return false;
}

/**
 * Check if a workflow is currently executing.
 */
export function isWorkflowExecuting(): boolean {
    return activeController !== null && activeController.isRunning();
}

function respondToHitlRequest(
    requestId: string,
    action: HitlAction,
    data?: string | Record<string, unknown>
): boolean {
    const pending = pendingHitlRequests.get(requestId);
    if (!pending) return false;

    if (action === 'reject') {
        stopWorkflowExecution();
    }

    const response: HITLResponse = {
        requestId,
        action,
        data,
        respondedAt: new Date().toISOString(),
    };

    pendingHitlRequests.delete(requestId);
    pending.resolve(response);
    pending.onResolve(response);
    return true;
}

export default defineNuxtPlugin((nuxtApp) => {
    // SSR guard
    if (!import.meta.client) return;

    const appConfig = useAppConfig();
    const slashConfig: WorkflowSlashConfig =
        ((appConfig as Record<string, unknown>)
            ?.workflowSlashCommands as WorkflowSlashConfig) || {};

    // Check feature flag
    if (slashConfig.enabled === false) {
        console.log('[workflow-slash] Plugin disabled via feature flag');
        return;
    }

    const hooks = useHooks();

    hooks.on(
        'ui.chat.editor:action:before_send',
        (payload: unknown) => {
            pendingEditorJson = payload;
        },
        { kind: 'action' }
    );

    // Mark any previously running workflow messages as interrupted on load and push state to UI
    (async () => {
        if (!import.meta.client) return; // SSR guard
        try {
            const { db } = await import('~/db');
            const now = nowSec();

            const stale = await db.messages
                .where('[data.type+data.executionState]')
                .equals(['workflow-execution', 'running'])
                .toArray();

            if (!stale.length) return;

            await db.messages
                .where('[data.type+data.executionState]')
                .equals(['workflow-execution', 'running'])
                .modify((m: any) => {
                    const data = m.data || {};
                    const nodeOutputs = data.nodeOutputs || {};
                    const startNodeId = deriveStartNodeId({
                        resumeState: data.resumeState,
                        failedNodeId: data.failedNodeId,
                        currentNodeId: data.currentNodeId,
                        nodeStates: data.nodeStates,
                        lastActiveNodeId: data.lastActiveNodeId,
                    });

                    m.data.executionState = 'interrupted';
                    if (startNodeId) {
                        m.data.resumeState = {
                            startNodeId,
                            nodeOutputs,
                            executionOrder:
                                data.executionOrder || Object.keys(nodeOutputs),
                            lastActiveNodeId: data.lastActiveNodeId,
                            sessionMessages: data.sessionMessages,
                            resumeInput: data.lastActiveNodeId
                                ? nodeOutputs[data.lastActiveNodeId]
                                : undefined,
                        };
                    }
                    m.data.result = {
                        success: false,
                        duration: 0,
                        error: 'Execution interrupted',
                    };
                    m.updated_at = now;
                    m.pending = false;
                });

            stale.forEach((m) => {
                if (!isWorkflowMessageData(m.data)) return;
                const data = m.data;
                const nodeOutputs = data.nodeOutputs || {};
                const startNodeId = deriveStartNodeId({
                    resumeState: data.resumeState,
                    failedNodeId: data.failedNodeId,
                    currentNodeId: data.currentNodeId,
                    nodeStates: data.nodeStates,
                    lastActiveNodeId: data.lastActiveNodeId,
                });

                const nextState = {
                    ...data,
                    executionState: 'interrupted' as const,
                    resumeState: startNodeId
                        ? {
                              startNodeId,
                              nodeOutputs,
                              executionOrder:
                                  data.executionOrder ||
                                  Object.keys(nodeOutputs),
                              lastActiveNodeId: data.lastActiveNodeId,
                              sessionMessages: data.sessionMessages,
                              resumeInput: data.lastActiveNodeId
                                  ? nodeOutputs[data.lastActiveNodeId]
                                  : undefined,
                          }
                        : undefined,
                    result: {
                        success: false,
                        duration: 0,
                        error: 'Execution interrupted',
                    },
                    version: (data.version || 0) + 1,
                };

                hooks.doAction('workflow.execution:action:state_update', {
                    messageId: m.id,
                    state: nextState as any,
                });
            });
        } catch (err) {
            reportError(err, {
                code: 'ERR_DB_WRITE_FAILED',
                message: 'Failed to mark stale workflow messages',
                silent: true,
            });
        }
    })();
    const toast = useToast();
    let slashModule: SlashCommandsModule | null = null;
    let executionModule: ExecutionModule | null = null;
    let extensionRegistered = false;

    // Provide stop function globally
    nuxtApp.provide('workflowSlash', {
        stop: stopWorkflowExecution,
        isExecuting: isWorkflowExecuting,
        retry: retryWorkflowMessage,
        respondHitl: respondToHitlRequest,
    });

    // Listen for stop-stream event to stop workflow execution (with cleanup to avoid leaks in HMR)
    const stopAbort = new AbortController();
    if (typeof window !== 'undefined') {
        window.addEventListener(
            'workflow:stop',
            () => {
                if (stopWorkflowExecution()) {
                    if (import.meta.dev)
                        console.log(
                            '[workflow-slash] Execution stopped by user'
                        );
                    toast.add({
                        title: 'Workflow Stopped',
                        description: 'Execution was cancelled',
                        color: 'info',
                    });
                }
            },
            { signal: stopAbort.signal }
        );
    }

    /**
     * Lazy load the slash commands module
     */
    async function loadSlashModule(): Promise<SlashCommandsModule | null> {
        if (slashModule) return slashModule;

        try {
            const [extensionModule, suggestionsModule, searchModule] =
                await Promise.all([
                    import('./WorkflowSlashCommands/slashCommandExtension'),
                    import('./WorkflowSlashCommands/suggestions'),
                    import('./WorkflowSlashCommands/useWorkflowSlashCommands'),
                ]);

            slashModule = {
                SlashCommand: extensionModule.SlashCommand,
                WorkflowNode: extensionModule.WorkflowNode,
                createSlashCommandSuggestion:
                    suggestionsModule.createSlashCommandSuggestion,
                searchWorkflows: searchModule.searchWorkflows,
                getWorkflowByName: searchModule.getWorkflowByName,
                getWorkflowById: searchModule.getWorkflowById,
            };

            return slashModule;
        } catch (error) {
            console.error('[workflow-slash] Failed to load module:', error);
            return null;
        }
    }

    /**
     * Lazy load the execution module
     */
    async function loadExecutionModule(): Promise<ExecutionModule | null> {
        if (executionModule) return executionModule;

        try {
            const module = await import(
                './WorkflowSlashCommands/executeWorkflow'
            );

            executionModule = {
                parseSlashCommand: module.parseSlashCommand,
                executeWorkflow: module.executeWorkflow,
                getConversationHistory: module.getConversationHistory,
            };

            return executionModule;
        } catch (error) {
            console.error('[workflow-slash] Failed to load execution:', error);
            return null;
        }
    }

    function safeCloneWorkflowData<T>(value: T): T {
        try {
            return structuredClone(value);
        } catch (err) {
            // Fallback to JSON clone for non-structured-cloneable fields
            return JSON.parse(JSON.stringify(value)) as T;
        }
    }

    function extractWorkflowCommandFromEditorJson(doc: unknown): {
        workflowId?: string;
        workflowName?: string;
        prompt: string;
    } | null {
        if (!doc || typeof doc !== 'object') return null;

        let found = false;
        let workflowId: string | undefined;
        let workflowName: string | undefined;
        const promptParts: string[] = [];

        const visit = (node: unknown) => {
            if (!node || typeof node !== 'object') return;

            const typed = node as {
                type?: string;
                text?: string;
                attrs?: Record<string, unknown>;
                content?: unknown[];
            };

            if (typed.type === 'workflow') {
                if (!found) {
                    found = true;
                    workflowId =
                        typeof typed.attrs?.id === 'string'
                            ? typed.attrs.id
                            : undefined;
                    workflowName =
                        typeof typed.attrs?.label === 'string'
                            ? typed.attrs.label
                            : undefined;
                }
                return;
            }

            if (typed.type === 'text') {
                if (found && typeof typed.text === 'string') {
                    promptParts.push(typed.text);
                }
                return;
            }

            if (typed.type === 'hardBreak') {
                if (found) {
                    promptParts.push('\n');
                }
                return;
            }

            if (Array.isArray(typed.content)) {
                typed.content.forEach(visit);
            }
        };

        visit(doc);

        if (!found) return null;

        return {
            workflowId,
            workflowName,
            prompt: promptParts.join('').trimStart(),
        };
    }

    async function runWorkflowExecution(opts: {
        workflowPost: WorkflowPostWithMeta;
        prompt: string;
        assistantContext: {
            id: string;
            streamId: string;
            threadId?: string;
        };
        execMod: ExecutionModule;
        apiKey: string;
        conversationHistory?: Awaited<
            ReturnType<ExecutionModule['getConversationHistory']>
        >;
        resumeFrom?: import('@or3/workflow-core').ResumeFromOptions;
    }) {
        const {
            workflowPost,
            prompt,
            assistantContext,
            execMod,
            apiKey,
            conversationHistory,
            resumeFrom,
        } = opts;

        // Import db for streaming updates
        const { db } = await import('~/db');

        // Create accumulator
        const accumulator = createWorkflowStreamAccumulator();

        // Pre-fill state with prior outputs when resuming to avoid re-running completed nodes visually
        // IMPORTANT: Exclude the startNodeId since we're about to re-run it
        if (resumeFrom?.nodeOutputs) {
            const meta = workflowPost.meta as any;
            const nodeMap = new Map(
                (meta?.nodes || []).map((n: any) => [n.id, n])
            );
            const orderedNodes = resumeFrom.executionOrder?.length
                ? resumeFrom.executionOrder
                : Object.keys(resumeFrom.nodeOutputs);
            // Filter out the node we're resuming from - it will be re-run
            const completedNodes = orderedNodes.filter(
                (nodeId) => nodeId !== resumeFrom.startNodeId
            );
            completedNodes.forEach((nodeId) => {
                // Only include if we have an output for it
                if (!resumeFrom.nodeOutputs[nodeId]) return;
                const node: any = nodeMap.get(nodeId) || {};
                const label =
                    (node.data && (node.data as any).label) ||
                    node.label ||
                    node.name ||
                    nodeId;
                const type = node.type || 'unknown';
                accumulator.nodeStart(nodeId, label, type);
                accumulator.nodeFinish(nodeId, resumeFrom.nodeOutputs[nodeId]);
            });
            (accumulator.state as any).executionOrder = [...completedNodes];
            (accumulator.state as any).lastActiveNodeId =
                resumeFrom.lastActiveNodeId ?? null;
        }

        // Reactive bridge: Emit state updates for UI (RAF-throttled) with sync fallback for finalize
        let emitRafId: number | null = null;
        const emitStateUpdate = () => {
            if (emitRafId !== null) return;
            emitRafId = requestAnimationFrame(() => {
                emitRafId = null;
                hooks.doAction('workflow.execution:action:state_update', {
                    messageId: assistantContext.id,
                    state: accumulator.state,
                });
            });
        };
        const emitStateUpdateSync = () => {
            if (emitRafId !== null) {
                cancelAnimationFrame(emitRafId);
                emitRafId = null;
            }
            hooks.doAction('workflow.execution:action:state_update', {
                messageId: assistantContext.id,
                state: accumulator.state,
            });
        };

        // Persistence helper - only called on lifecycle events, not tokens
        const persist = (_immediate = false) => {
            // Ensure we only persist plain, cloneable data to Dexie
            const data = safeCloneWorkflowData(
                accumulator.toMessageData(
                    workflowPost.id,
                    workflowPost.title,
                    prompt
                )
            );

            db.messages
                .get(assistantContext.id)
                .then(async (msg) => {
                    const timestamp = nowSec();
                    if (msg) {
                        return db.messages.put({
                            ...msg,
                            data,
                            pending: data.executionState === 'running',
                            updated_at: timestamp,
                        });
                    }

                    // Create placeholder assistant message so UI can render it
                    const index = Math.floor(Date.now());
                    return db.messages.put({
                        id: assistantContext.id,
                        role: 'assistant',
                        data,
                        pending: data.executionState === 'running',
                        created_at: timestamp,
                        updated_at: timestamp,
                        error: null,
                        deleted: false,
                        thread_id: assistantContext.threadId || '',
                        index,
                        clock: 0,
                        stream_id: assistantContext.streamId,
                        file_hashes: null,
                    });
                })
                .catch((e) =>
                    reportError(e, {
                        code: 'ERR_DB_WRITE_FAILED',
                        message: 'Persist failed',
                        silent: true,
                    })
                );
        };

        const resolveHitlRequestsForNode = (nodeId: string) => {
            let changed = false;
            for (const [requestId, pending] of pendingHitlRequests) {
                if (
                    pending.messageId === assistantContext.id &&
                    pending.request.nodeId === nodeId
                ) {
                    pendingHitlRequests.delete(requestId);
                    accumulator.hitlResolve(requestId);
                    changed = true;
                }
            }
            if (changed) {
                emitStateUpdate();
                persist(true);
            }
        };

        const handleHitlRequest = async (
            request: HITLRequest
        ): Promise<HITLResponse> => {
            const requestState: HitlRequestState = {
                id: request.id,
                nodeId: request.nodeId,
                nodeLabel: request.nodeLabel,
                mode: request.mode,
                prompt: request.prompt,
                options: request.options?.map((option) => ({ ...option })),
                inputSchema: request.inputSchema,
                createdAt: request.createdAt,
                expiresAt: request.expiresAt,
                context: {
                    input: request.context?.input,
                    output: request.context?.output,
                    workflowName: request.context?.workflowName,
                    sessionId: request.context?.sessionId,
                },
            };

            accumulator.hitlRequest(requestState);
            emitStateUpdate();
            persist(true);

            return new Promise<HITLResponse>((resolve) => {
                pendingHitlRequests.set(request.id, {
                    messageId: assistantContext.id,
                    request: requestState,
                    resolve,
                    onResolve: (response) => {
                        accumulator.hitlResolve(request.id, response);
                        emitStateUpdate();
                        persist(true);
                    },
                });
            });
        };

        // Initial persist to set message type
        persist(true);
        emitStateUpdate();

        // Execution callbacks (manual wiring; helper not available in current core build)
        const callbacks = {
            onNodeStart: (
                nodeId: string,
                nodeInfo?: { label?: string; type?: string }
            ) => {
                const meta = workflowPost.meta as any;
                const node = (meta?.nodes || []).find(
                    (n: any) => n.id === nodeId
                );
                const label =
                    nodeInfo?.label ||
                    node?.label ||
                    node?.name ||
                    nodeInfo?.type ||
                    node?.type ||
                    nodeId;
                const type = nodeInfo?.type || node?.type || 'unknown';
                accumulator.nodeStart(nodeId, label, type);
                emitStateUpdate();
                persist();
            },
            onNodeFinish: (nodeId: string, output: string) => {
                accumulator.nodeFinish(nodeId, output);
                resolveHitlRequestsForNode(nodeId);
                emitStateUpdate();
                hooks.doAction('workflow.execution:action:node_complete', {
                    messageId: assistantContext.id,
                    nodeId,
                });
                persist();
            },
            onNodeError: (nodeId: string, error: Error) => {
                accumulator.nodeError(nodeId, error);
                resolveHitlRequestsForNode(nodeId);
                emitStateUpdate();
                persist(true);
                reportError(error, {
                    code: 'ERR_INTERNAL',
                    message: `Node ${nodeId} failed`,
                    silent: true,
                });
            },
            onToken: (nodeId: string, token: string) => {
                accumulator.nodeToken(nodeId, token);
                // Token updates are RAF-batched in accumulator; no hook emission needed
            },
            onReasoning: (nodeId: string, token: string) => {
                accumulator.nodeReasoning(nodeId, token);
                // Token updates are RAF-batched in accumulator; no hook emission needed
            },
            onBranchStart: (
                nodeId: string,
                branchId: string,
                label: string
            ) => {
                accumulator.branchStart(nodeId, branchId, label);
                emitStateUpdate();
            },
            onBranchToken: (
                nodeId: string,
                branchId: string,
                label: string,
                token: string
            ) => {
                accumulator.branchToken(nodeId, branchId, label, token);
                // Token updates are RAF-batched in accumulator; no hook emission needed
            },
            onBranchReasoning: (
                nodeId: string,
                branchId: string,
                label: string,
                token: string
            ) => {
                accumulator.branchReasoning(nodeId, branchId, label, token);
                // Token updates are RAF-batched in accumulator; no hook emission needed
            },
            onBranchComplete: (
                nodeId: string,
                branchId: string,
                label: string,
                output: string
            ) => {
                accumulator.branchComplete(nodeId, branchId, label, output);
                emitStateUpdate();
                persist();
            },
            onRouteSelected: (nodeId: string, route: string) => {
                accumulator.routeSelected(nodeId, route);
                emitStateUpdate();
            },
            onTokenUsage: (
                nodeId: string,
                usage: {
                    promptTokens?: number;
                    completionTokens?: number;
                    totalTokens?: number;
                }
            ) => {
                accumulator.tokenUsage(nodeId, usage);
                emitStateUpdate();
            },
            onWorkflowToken: (token: string) => {
                accumulator.workflowToken(token);
                // Emit state update for UI reactivity (RAF-throttled)
                emitStateUpdate();
            },
            onComplete: (result) => {
                accumulator.finalize({ result });
                emitStateUpdate();
                persist(true);
            },
        } satisfies Record<string, (...args: any[]) => void>;

        const handleToolCallEvent = (event: ToolCallEventWithNode) => {
            accumulator.toolCallEvent(event);
            emitStateUpdate();
            if (event.status !== 'active') {
                persist();
            }
        };

        const cleanupHitlRequests = () => {
            let changed = false;
            for (const [requestId, pending] of pendingHitlRequests) {
                if (pending.messageId !== assistantContext.id) continue;
                pendingHitlRequests.delete(requestId);
                pending.resolve({
                    requestId,
                    action: 'reject',
                    respondedAt: new Date().toISOString(),
                });
                accumulator.hitlResolve(requestId);
                changed = true;
            }
            if (changed) {
                emitStateUpdate();
                persist(true);
            }
        };

        if (import.meta.dev) {
            console.log(
                '[workflow-slash] Starting execution with prompt:',
                prompt
            );
        }

        // Fire start hook
        await hooks.doAction('workflow.execution:action:start', {
            messageId: assistantContext.id,
            workflowId: workflowPost.id,
        });

        // Create execution controller
        const controller = execMod.executeWorkflow({
            workflow: workflowPost.meta,
            prompt: prompt || 'Execute workflow',
            conversationHistory:
                conversationHistory ||
                (await execMod.getConversationHistory(
                    assistantContext.threadId || ''
                )),
            apiKey,
            onToken: () => {}, // Handled by callbacks.onToken
            onWorkflowToken: (_token) => {},
            callbacks, // Pass our custom callbacks
            onToolCallEvent: handleToolCallEvent,
            onHITLRequest: handleHitlRequest,
            onError: (error) => {
                reportError(error, {
                    code: 'ERR_INTERNAL',
                    message: 'Execution error',
                    toast: true,
                });
            },
            resumeFrom,
        });

        activeController = controller;

        // Handle completion
        controller.promise
            .then(async ({ result, stopped }) => {
                activeController = null;

                const finalOutput = result?.finalOutput ?? result?.output ?? '';
                accumulator.finalize({
                    stopped,
                    result: result || undefined,
                    error: result?.error || undefined,
                });
                emitStateUpdateSync();
                persist(true); // Final persist
                cleanupHitlRequests();

                if (stopped) {
                    if (import.meta.dev)
                        console.log('[workflow-slash] Execution stopped');
                } else {
                    if (import.meta.dev)
                        console.log('[workflow-slash] Execution completed');
                    // Emit completion hook
                    await hooks.doAction('workflow.execution:action:complete', {
                        messageId: assistantContext.id,
                        workflowId: workflowPost.id,
                        finalOutput,
                    });
                }
            })
            .catch((error) => {
                activeController = null;
                accumulator.finalize({ error });
                emitStateUpdateSync();
                persist(true);
                cleanupHitlRequests();

                reportError(error, {
                    code: 'ERR_INTERNAL',
                    message: 'Execution failed',
                    toast: true,
                });
            });
    }

    async function retryWorkflowMessage(messageId: string): Promise<boolean> {
        try {
            const [slashMod, execMod] = await Promise.all([
                loadSlashModule(),
                loadExecutionModule(),
            ]);

            if (!slashMod || !execMod) {
                reportError('Failed to load workflow modules', {
                    code: 'ERR_INTERNAL',
                    toast: true,
                });
                return false;
            }

            const { db } = await import('~/db');
            const message = await db.messages.get(messageId);

            if (!message || !isWorkflowMessageData(message.data)) {
                reportError('Workflow data not found for retry', {
                    code: 'ERR_VALIDATION',
                    toast: true,
                });
                return false;
            }

            // Derive resume state from multiple sources if not explicitly set
            const data = message.data;
            const nodeOutputs = data.nodeOutputs || {};
            const derivedStartNodeId = deriveStartNodeId({
                resumeState: data.resumeState,
                failedNodeId: data.failedNodeId,
                currentNodeId: data.currentNodeId,
                nodeStates: data.nodeStates,
                lastActiveNodeId: data.lastActiveNodeId,
            });

            if (!derivedStartNodeId) {
                reportError('No retry state available for this message', {
                    code: 'ERR_VALIDATION',
                    toast: true,
                });
                return false;
            }

            const workflowPost =
                (message.data.workflowId
                    ? await slashMod.getWorkflowById(message.data.workflowId)
                    : null) ||
                (await slashMod.getWorkflowByName(message.data.workflowName));

            if (!hasWorkflowMeta(workflowPost)) {
                reportError('Workflow not found for retry', {
                    code: 'ERR_VALIDATION',
                    toast: true,
                });
                return false;
            }

            const { useUserApiKey } = await import('~/core/auth/useUserApiKey');
            const { apiKey } = useUserApiKey();

            if (!apiKey.value) {
                reportError('Please connect your OpenRouter account', {
                    code: 'ERR_AUTH',
                    severity: 'warn',
                    toast: true,
                });
                window.dispatchEvent(new CustomEvent('openrouter:login'));
                return false;
            }

            const resumeNodeOutputs =
                data.resumeState?.nodeOutputs ||
                data.nodeOutputs ||
                nodeOutputs;

            // Reuse the original message ID so UI updates in place
            const assistantContext = {
                id: messageId,
                streamId: crypto.randomUUID(),
                threadId: message.thread_id || '',
            };

            const resumeFrom = {
                startNodeId: derivedStartNodeId,
                nodeOutputs: resumeNodeOutputs,
                executionOrder:
                    data.resumeState?.executionOrder ||
                    data.executionOrder ||
                    Object.keys(resumeNodeOutputs),
                lastActiveNodeId:
                    data.resumeState?.lastActiveNodeId ??
                    data.lastActiveNodeId ??
                    undefined,
                sessionMessages:
                    data.sessionMessages || data.resumeState?.sessionMessages,
                resumeInput:
                    data.resumeState?.resumeInput ||
                    (data.lastActiveNodeId
                        ? resumeNodeOutputs[data.lastActiveNodeId]
                        : undefined),
                finalNodeId: data.finalNodeId || undefined,
            } satisfies import('@or3/workflow-core').ResumeFromOptions;

            const conversationHistory = await execMod.getConversationHistory(
                assistantContext.threadId || ''
            );

            await runWorkflowExecution({
                workflowPost,
                prompt: message.data.prompt || '',
                assistantContext,
                execMod,
                apiKey: apiKey.value,
                conversationHistory,
                resumeFrom,
            });

            return true;
        } catch (err) {
            reportError(err, {
                code: 'ERR_INTERNAL',
                message: 'Retry failed',
                toast: true,
            });
            return false;
        }
    }

    /**
     * Capture assistant message context before AI call starts.
     * This runs BEFORE the filter hook, so we can use this ID
     * to update the message with workflow output.
     */
    hooks.on(
        'ai.chat.send:action:before',
        (payload: {
            threadId?: string;
            assistant: { id: string; streamId: string };
        }) => {
            pendingAssistantContext = {
                id: payload.assistant.id,
                streamId: payload.assistant.streamId,
                threadId: payload.threadId,
            };

            if (import.meta.dev) {
                console.log(
                    '[workflow-slash] Captured assistant context:',
                    pendingAssistantContext
                );
            }
        },
        { kind: 'action', priority: 100 }
    );

    /**
     * Register TipTap extension when editor requests extensions
     */
    let editorExtensionsCleanup: (() => void) | null = null;
    hooks.on(
        'editor:request-extensions',
        async () => {
            const module = await loadSlashModule();
            if (!module) return;

            // Only register once
            if (extensionRegistered) return;
            extensionRegistered = true;

            // Create the suggestion configuration
            const suggestionConfig = module.createSlashCommandSuggestion(
                module.searchWorkflows,
                slashConfig.debounceMs || 100
            );

            // Configure the extension with the suggestion config
            const SlashCommandExtension = module.SlashCommand.configure({
                suggestion: suggestionConfig,
            });

            // Provide both WorkflowNode and SlashCommand extension via filter
            editorExtensionsCleanup = hooks.on(
                'ui.chat.editor:filter:extensions',
                (existing) => {
                    const list = Array.isArray(existing) ? existing : [];
                    return [
                        ...list,
                        module.WorkflowNode,
                        SlashCommandExtension,
                    ];
                }
            );

            console.log('[workflow-slash] Extension registered');
        },
        { kind: 'action' }
    );

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            stopAbort.abort();
            editorExtensionsCleanup?.();
        });
    }

    /**
     * Intercept message send to detect and execute workflow commands
     */
    hooks.on(
        'ai.chat.messages:filter:before_send',
        async (payload: MessagesPayload) => {
            const messages = normalizeMessagesPayload(payload);

            if (!messages.length) {
                return { messages };
            }

            // Find the last user message
            const lastUser = [...messages]
                .reverse()
                .find((m) => m.role === 'user');

            if (!lastUser) {
                return { messages };
            }

            // Get the text content
            const content =
                typeof lastUser.content === 'string'
                    ? lastUser.content
                    : Array.isArray(lastUser.content)
                    ? lastUser.content
                          .filter(
                              (p): p is { type: 'text'; text: string } =>
                                  typeof p === 'object' &&
                                  p !== null &&
                                  'type' in p &&
                                  p.type === 'text'
                          )
                          .map((p) => p.text)
                          .join('')
                    : '';

            const normalizedContent = content.trimStart();
            const editorDoc = pendingEditorJson;
            pendingEditorJson = null;

            if (!normalizedContent.startsWith('/')) {
                return { messages };
            }

            // Load modules
            const [slashMod, execMod] = await Promise.all([
                loadSlashModule(),
                loadExecutionModule(),
            ]);

            if (!slashMod || !execMod) {
                reportError('Failed to load workflow modules', {
                    code: 'ERR_INTERNAL',
                    toast: true,
                });
                return { messages };
            }

            const editorMatch = editorDoc
                ? extractWorkflowCommandFromEditorJson(editorDoc)
                : null;

            let workflowPost: WorkflowPostWithMeta | null = null;
            let workflowNameForLog = '';
            let prompt = '';

            if (editorMatch) {
                prompt = editorMatch.prompt || '';
                workflowNameForLog = editorMatch.workflowName || '';

                if (editorMatch.workflowId) {
                    workflowPost = await slashMod.getWorkflowById(
                        editorMatch.workflowId
                    );
                }

                if (!workflowPost && editorMatch.workflowName) {
                    workflowPost = await slashMod.getWorkflowByName(
                        editorMatch.workflowName
                    );
                }

                if (!workflowPost) {
                    reportError(
                        editorMatch.workflowName
                            ? `Workflow "${editorMatch.workflowName}" not found`
                            : 'Workflow not found',
                        {
                            code: 'ERR_VALIDATION',
                            severity: 'warn',
                            toast: true,
                        }
                    );
                    return { messages };
                }
            } else {
                const workflowOptions = await slashMod.searchWorkflows(
                    '',
                    Number.POSITIVE_INFINITY
                );
                const workflowNames = workflowOptions.map((item) => item.label);
                const parsed = execMod.parseSlashCommand(
                    normalizedContent,
                    workflowNames
                );

                if (!parsed) {
                    return { messages };
                }

                workflowNameForLog = parsed.workflowName;
                prompt = parsed.prompt || '';
                workflowPost = await slashMod.getWorkflowByName(
                    parsed.workflowName
                );

                if (!workflowPost) {
                    reportError(`No workflow named "${parsed.workflowName}"`, {
                        code: 'ERR_VALIDATION',
                        severity: 'warn',
                        toast: true,
                    });
                    return { messages };
                }
            }

            // Get API key
            const { useUserApiKey } = await import('~/core/auth/useUserApiKey');
            const { apiKey } = useUserApiKey();

            if (!apiKey.value) {
                reportError('Please connect your OpenRouter account', {
                    code: 'ERR_AUTH',
                    severity: 'warn',
                    toast: true,
                });
                // Dispatch event to prompt login
                window.dispatchEvent(new CustomEvent('openrouter:login'));
                return { messages };
            }

            // Check workflow has valid meta
            if (!hasWorkflowMeta(workflowPost)) {
                reportError(
                    `Workflow "${
                        workflowNameForLog || workflowPost.title
                    }" has no data`,
                    {
                    code: 'ERR_VALIDATION',
                    toast: true,
                    }
                );
                return { messages };
            }

            // Log workflow structure for debugging
            console.log('[workflow-slash] Workflow structure:', {
                id: workflowPost.id,
                title: workflowPost.title,
                hasNodes: Array.isArray(workflowPost.meta.nodes),
                hasEdges: Array.isArray(workflowPost.meta.edges),
                nodesCount: Array.isArray(workflowPost.meta.nodes)
                    ? workflowPost.meta.nodes.length
                    : 'N/A',
                edgesCount: Array.isArray(workflowPost.meta.edges)
                    ? workflowPost.meta.edges.length
                    : 'N/A',
            });

            // Execute the workflow
            if (import.meta.dev) {
                console.log(
                    '[workflow-slash] Executing workflow:',
                    workflowNameForLog || workflowPost.title
                );
            }

            // Capture context before starting async work
            const assistantContext = pendingAssistantContext;
            if (!assistantContext) {
                console.error(
                    '[workflow-slash] No assistant context available'
                );
                return { messages };
            }

            const conversationHistory = await execMod.getConversationHistory(
                assistantContext.threadId || ''
            );

            await runWorkflowExecution({
                workflowPost,
                prompt,
                assistantContext,
                execMod,
                apiKey: apiKey.value,
                conversationHistory,
            });

            // Clear pending context
            pendingAssistantContext = null;

            // Signal to the chat system that workflow is handling this request
            workflowHandlingRequest = true;

            return { messages: [] };
        }
    );
});
