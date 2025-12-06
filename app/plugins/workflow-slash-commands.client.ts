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
import type { OpenRouterMessage } from '~/core/hooks/hook-types';
import type { WorkflowExecutionController } from './WorkflowSlashCommands/executeWorkflow';
import { createWorkflowStreamAccumulator } from '~/composables/chat/useWorkflowStreamAccumulator';
import { nowSec } from '~/db/util';
import { reportError } from '~/utils/errors';

// Types for lazy-loaded modules
interface SlashCommandsModule {
    SlashCommand: Extension;
    WorkflowNode: Node;
    createSlashCommandSuggestion: typeof import('./WorkflowSlashCommands/suggestions').createSlashCommandSuggestion;
    searchWorkflows: typeof import('./WorkflowSlashCommands/useWorkflowSlashCommands').searchWorkflows;
    getWorkflowByName: typeof import('./WorkflowSlashCommands/useWorkflowSlashCommands').getWorkflowByName;
}

interface ExecutionModule {
    parseSlashCommand: typeof import('./WorkflowSlashCommands/executeWorkflow').parseSlashCommand;
    executeWorkflow: typeof import('./WorkflowSlashCommands/executeWorkflow').executeWorkflow;
    getConversationHistory: typeof import('./WorkflowSlashCommands/executeWorkflow').getConversationHistory;
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
    const toast = useToast();
    let slashModule: SlashCommandsModule | null = null;
    let executionModule: ExecutionModule | null = null;
    let extensionRegistered = false;

    // Provide stop function globally
    nuxtApp.provide('workflowSlash', {
        stop: stopWorkflowExecution,
        isExecuting: isWorkflowExecuting,
    });

    // Listen for stop-stream event to stop workflow execution
    if (typeof window !== 'undefined') {
        window.addEventListener('workflow:stop', () => {
            if (stopWorkflowExecution()) {
                console.log('[workflow-slash] Execution stopped by user');
                toast.add({
                    title: 'Workflow Stopped',
                    description: 'Execution was cancelled',
                    color: 'info',
                });
            }
        });
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
            hooks.on('ui.chat.editor:filter:extensions', (existing) => {
                const list = Array.isArray(existing) ? existing : [];
                return [...list, module.WorkflowNode, SlashCommandExtension];
            });

            console.log('[workflow-slash] Extension registered');
        },
        { kind: 'action' }
    );

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

            if (!content.startsWith('/')) {
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

            // Parse the slash command
            const parsed = execMod.parseSlashCommand(content);
            if (!parsed) {
                return { messages };
            }

            // Get the workflow
            const workflowPost = await slashMod.getWorkflowByName(
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

            // Get thread ID from messages context (if available)
            // For now, we'll use an empty history - full implementation would
            // get the thread ID from the current pane context
            const conversationHistory = await execMod.getConversationHistory(
                '' // TODO: Get current thread ID
            );

            // Check workflow has valid meta
            if (!workflowPost.meta) {
                reportError(`Workflow "${parsed.workflowName}" has no data`, {
                    code: 'ERR_VALIDATION',
                    toast: true,
                });
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
                    parsed.workflowName
                );
            }

            // Import db for streaming updates
            const { db } = await import('~/db');

            // Capture context before starting async work
            const assistantContext = pendingAssistantContext;
            if (!assistantContext) {
                console.error(
                    '[workflow-slash] No assistant context available'
                );
                return { messages };
            }

            // Create accumulator
            const accumulator = createWorkflowStreamAccumulator();

            // Reactive bridge: Emit state updates for UI
            const emitStateUpdate = () => {
                hooks.doAction('workflow.execution:action:state_update', {
                    messageId: assistantContext.id,
                    state: accumulator.state,
                });
            };

            // Persistence helper with throttling
            let lastPersist = 0;
            let persistTimeout: any = null;

            const persist = (immediate = false) => {
                const now = Date.now();
                if (immediate || now - lastPersist > 500) {
                    lastPersist = now;
                    if (persistTimeout) clearTimeout(persistTimeout);
                    persistTimeout = null;

                    const data = accumulator.toMessageData(
                        workflowPost.id,
                        workflowPost.title,
                        parsed.prompt || ''
                    );

                    db.messages
                        .get(assistantContext.id)
                        .then(async (msg) => {
                            const timestamp = nowSec();
                            if (msg) {
                                return db.messages.put({
                                    ...msg,
                                    data,
                                    updated_at: timestamp,
                                });
                            }

                            // Create placeholder assistant message so UI can render it
                            const index = Math.floor(Date.now());
                            return db.messages.put({
                                id: assistantContext.id,
                                role: 'assistant',
                                data,
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
                } else if (!persistTimeout) {
                    persistTimeout = setTimeout(() => persist(true), 500);
                }
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
                    emitStateUpdate();
                    hooks.doAction('workflow.execution:action:node_complete', {
                        messageId: assistantContext.id,
                        nodeId,
                    });
                    persist();
                },
                onNodeError: (nodeId: string, error: Error) => {
                    accumulator.nodeError(nodeId, error);
                    emitStateUpdate();
                    persist();
                    reportError(error, {
                        code: 'ERR_INTERNAL',
                        message: `Node ${nodeId} failed`,
                        silent: true,
                    });
                },
                onToken: (nodeId: string, token: string) => {
                    accumulator.nodeToken(nodeId, token);
                    emitStateUpdate();
                    persist();
                },
                onReasoning: (nodeId: string, token: string) => {
                    accumulator.nodeReasoning(nodeId, token);
                    emitStateUpdate();
                    persist();
                },
                onBranchStart: (
                    nodeId: string,
                    branchId: string,
                    label: string
                ) => {
                    accumulator.branchStart(nodeId, branchId, label);
                    emitStateUpdate();
                    persist();
                },
                onBranchToken: (
                    nodeId: string,
                    branchId: string,
                    label: string,
                    token: string
                ) => {
                    accumulator.branchToken(nodeId, branchId, label, token);
                    emitStateUpdate();
                    persist();
                },
                onBranchReasoning: (
                    nodeId: string,
                    branchId: string,
                    label: string,
                    token: string
                ) => {
                    accumulator.branchReasoning(nodeId, branchId, label, token);
                    emitStateUpdate();
                    persist();
                },
                onBranchComplete: (
                    nodeId: string,
                    branchId: string,
                    output: string
                ) => {
                    accumulator.branchComplete(nodeId, branchId, output);
                    emitStateUpdate();
                    persist();
                },
                onRouteSelected: (nodeId: string, route: string) => {
                    accumulator.routeSelected(nodeId, route);
                    emitStateUpdate();
                    persist();
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
                    persist();
                },
                onWorkflowToken: (token: string) => {
                    accumulator.workflowToken(token);
                    emitStateUpdate();
                    persist();
                },
                onComplete: (result) => {
                    accumulator.finalize({ result });
                    emitStateUpdate();
                    persist(true);
                },
            } satisfies Record<string, (...args: any[]) => void>;

            if (import.meta.dev) {
                console.log(
                    '[workflow-slash] Starting execution with prompt:',
                    parsed.prompt
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
                prompt: parsed.prompt || 'Execute workflow',
                conversationHistory,
                apiKey: apiKey.value,
                onToken: () => {}, // Handled by callbacks.onToken
                onWorkflowToken: (_token) => {},
                callbacks, // Pass our custom callbacks
                onError: (error) => {
                    reportError(error, {
                        code: 'ERR_INTERNAL',
                        message: 'Execution error',
                        toast: true,
                    });
                },
            });

            activeController = controller;

            // Handle completion
            controller.promise
                .then(async ({ result, stopped }) => {
                    activeController = null;

                    const finalOutput =
                        result?.finalOutput ?? result?.output ?? '';
                    accumulator.finalize({
                        stopped,
                        result: result || undefined,
                        error: result?.error || undefined,
                    });
                    emitStateUpdate();
                    persist(true); // Final persist

                    if (stopped) {
                        console.log('[workflow-slash] Execution stopped');
                    } else {
                        console.log('[workflow-slash] Execution completed');
                        // Emit completion hook
                        await hooks.doAction(
                            'workflow.execution:action:complete',
                            {
                                messageId: assistantContext.id,
                                workflowId: workflowPost.id,
                            }
                        );
                    }
                })
                .catch((error) => {
                    activeController = null;
                    accumulator.finalize({ error });
                    emitStateUpdate();
                    persist(true);

                    reportError(error, {
                        code: 'ERR_INTERNAL',
                        message: 'Execution failed',
                        toast: true,
                    });
                });

            // Clear pending context
            pendingAssistantContext = null;

            // Signal to the chat system that workflow is handling this request
            workflowHandlingRequest = true;

            return { messages: [] };
        }
    );
});
