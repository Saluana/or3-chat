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
                toast.add({
                    title: 'Workflow Error',
                    description: 'Failed to load workflow modules',
                    color: 'error',
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
                toast.add({
                    title: 'Workflow Not Found',
                    description: `No workflow named "${parsed.workflowName}"`,
                    color: 'warning',
                });
                return { messages };
            }

            // Get API key
            const { useUserApiKey } = await import('~/core/auth/useUserApiKey');
            const { apiKey } = useUserApiKey();

            if (!apiKey.value) {
                toast.add({
                    title: 'API Key Required',
                    description: 'Please connect your OpenRouter account',
                    color: 'warning',
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
                toast.add({
                    title: 'Invalid Workflow',
                    description: `Workflow "${parsed.workflowName}" has no data`,
                    color: 'error',
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

            // Track streamed output
            let output = '';
            let updatePending = false;
            let chunkIndex = 0;

            // Update function to persist to database
            const updateMessage = async () => {
                if (!assistantContext || updatePending) return;
                updatePending = true;

                try {
                    const existingMsg = await db.messages.get(
                        assistantContext.id
                    );
                    if (existingMsg) {
                        await db.messages.put({
                            ...existingMsg,
                            data: {
                                content: output,
                                attachments: [],
                                reasoning_text: null,
                            },
                            updated_at: Date.now(),
                        });
                    }
                } catch (e) {
                    if (import.meta.dev) {
                        console.warn(
                            '[workflow-slash] Stream update failed:',
                            e
                        );
                    }
                } finally {
                    updatePending = false;
                }
            };

            // Throttle updates to ~50ms intervals for smooth streaming
            let lastUpdate = 0;
            const throttledUpdate = async (delta: string) => {
                const now = Date.now();

                // Emit delta hook for any listeners
                await hooks.doAction('ai.chat.stream:action:delta', delta, {
                    threadId: assistantContext.threadId,
                    assistantId: assistantContext.id,
                    streamId: assistantContext.streamId,
                    deltaLength: delta.length,
                    totalLength: output.length,
                    chunkIndex: chunkIndex++,
                });

                // Throttle database updates
                if (now - lastUpdate > 50) {
                    lastUpdate = now;
                    void updateMessage();
                }
            };

            if (import.meta.dev) {
                console.log(
                    '[workflow-slash] Starting execution with prompt:',
                    parsed.prompt
                );
            }

            // Create execution controller (allows stopping)
            const controller = execMod.executeWorkflow({
                workflow: workflowPost.meta,
                prompt: parsed.prompt || 'Execute workflow',
                conversationHistory,
                apiKey: apiKey.value,
                onToken: (token) => {
                    output += token;
                    // Stream to the assistant message in real-time
                    void throttledUpdate(token);
                },
                onNodeStart: (nodeId) => {
                    if (import.meta.dev) {
                        console.log('[workflow-slash] Node started:', nodeId);
                    }
                },
                onNodeFinish: (nodeId, nodeOutput) => {
                    if (import.meta.dev) {
                        console.log(
                            '[workflow-slash] Node finished:',
                            nodeId,
                            nodeOutput?.slice?.(0, 100) || ''
                        );
                    }
                },
                onError: (error) => {
                    console.error('[workflow-slash] Execution error:', error);
                    toast.add({
                        title: 'Workflow Error',
                        description: error.message || 'Execution failed',
                        color: 'error',
                    });
                },
            });

            // Track the active controller for stop functionality
            activeController = controller;

            // Handle workflow completion in background (don't block the filter)
            controller.promise
                .then(async ({ stopped }) => {
                    activeController = null;

                    if (stopped) {
                        console.log('[workflow-slash] Execution was stopped');
                        if (output) {
                            await updateMessage();
                        }
                        return;
                    }

                    if (import.meta.dev) {
                        console.log(
                            '[workflow-slash] Execution complete, output length:',
                            output.length
                        );
                    }

                    // Final update to ensure complete output is saved
                    const finalOutput =
                        output || 'Workflow executed successfully.';
                    try {
                        const existingMsg = await db.messages.get(
                            assistantContext.id
                        );
                        if (existingMsg) {
                            await db.messages.put({
                                ...existingMsg,
                                data: {
                                    content: finalOutput,
                                    attachments: [],
                                    reasoning_text: null,
                                },
                                updated_at: Date.now(),
                            });

                            // Emit completion hook
                            await hooks.doAction(
                                'ai.chat.stream:action:complete',
                                {
                                    threadId: assistantContext.threadId,
                                    assistantId: assistantContext.id,
                                    streamId: assistantContext.streamId,
                                    totalLength: finalOutput.length,
                                }
                            );

                            if (import.meta.dev) {
                                console.log(
                                    '[workflow-slash] Final update to message:',
                                    assistantContext.id
                                );
                            }
                        }
                    } catch (dbError) {
                        console.error(
                            '[workflow-slash] Failed to update message:',
                            dbError
                        );
                    }
                })
                .catch((error) => {
                    activeController = null;
                    console.error('[workflow-slash] Execution failed:', error);
                    toast.add({
                        title: 'Workflow Failed',
                        description:
                            error instanceof Error
                                ? error.message
                                : 'Unknown error',
                        color: 'error',
                    });
                });

            // Clear pending context (we captured it above)
            pendingAssistantContext = null;

            // Return empty messages to prevent the AI from responding
            // The workflow is now running in the background and will update the message
            return { messages: [] };
        }
    );
});
