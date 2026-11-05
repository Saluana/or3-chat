import type { Ref } from 'vue';
import type { useToast } from '#imports';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { ChatMessage, SendResult } from '~/utils/chat/types';
import { appendMessageToDb } from '~/db/messages';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { makeAssistantPersister } from './persistence';
import { getBuiltinMentionFilter } from '~/utils/chat/mention-filter-identity';
import { consumeChatSendHandled } from '~/utils/chat/send-interception';
import { asAppError, err, reportError } from '~/utils/errors';
import { ToolIterationLimitError } from '~~/shared/chat/stream-errors';
import { contextAdmissionFailureReason } from '~~/shared/chat/context-budget';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationDefaultsSchema, type DelegationDefaults } from '~~/shared/chat/delegation-checkpoint';
import type { ChatSendCommit } from '~~/shared/hooks/hook-domain-types';
import { hasUnsafeDelegationFilter, canUseDurableDelegation } from './delegationPolicy';
import { finalizeRequest, publishRequest, type ChatRequest, type RequestFinalization } from './requestController';
import type { createChatViewProjection } from './viewProjection';
import type { createNativeExecution } from './nativeExecution';
import type { createTurnPreparation } from './turnPreparation';
import type { OpenRouterMessage, StoredMessage } from './nativeExecutionTypes';

type PreparedTurn = Extract<Awaited<ReturnType<ReturnType<typeof createTurnPreparation>>>, { done: false }>;
type WorkflowMessageScope = Pick<ChatRequest, 'originDb' | 'workspaceId' | 'threadId'>;

/** Creates the assistant and hands a persisted turn to a workflow or native execution. */
export function createTurnDispatch(ports: {
    view: Pick<ReturnType<typeof createChatViewProjection>, 'messages' | 'rawMessages' | 'tailAssistant' | 'resolveUiMessage'> & {
        visibleRequest: Ref<ChatRequest | null>;
        abortController: Ref<AbortController | null>;
        loading: Readonly<Ref<boolean>>;
        streamId: Ref<string | undefined>;
        aborted: Ref<boolean>;
        detached: Ref<boolean>;
        activeRequest: () => ChatRequest | null;
        isDetached: () => boolean;
        resetStream: () => void;
    };
    backgroundJobId: Ref<string | null>;
    backgroundJobMode: Ref<'none' | 'background'>;
    backgroundJobInfo: Ref<{ jobId: string; threadId: string; messageId: string } | null>;
    workflowMessageScopes: Map<string, WorkflowMessageScope>;
    hooks: TypedHookEngine;
    toast: ReturnType<typeof useToast>;
    executeNative: ReturnType<typeof createNativeExecution>;
    reportFinalization: (result: RequestFinalization) => void;
    isStaleDevModuleError: (error: unknown) => boolean;
}) {
    const { messages, rawMessages, tailAssistant, resolveUiMessage, visibleRequest, abortController,
        loading, streamId, aborted, detached, isDetached, resetStream } = ports.view;
    const { backgroundJobId, backgroundJobMode, backgroundJobInfo, workflowMessageScopes, hooks, toast,
        reportFinalization, isStaleDevModuleError } = ports;
    const isRequestCancelled = (scope: ChatRequest): boolean => scope.cancelled;
    const runPreparedNative = ports.executeNative;
    return async function dispatchTurn(requestScope: ChatRequest, preparation: PreparedTurn,
        userDbMsg: Awaited<ReturnType<typeof appendMessageToDb>>, assistantDbMsg: StoredMessage, requestThreadId: string,
        stopAcceptanceHeartbeat: () => void): Promise<SendResult> {
        const { requestId, content, sendMessagesParams, workspaceGeneration, preparationSignal, ownsPreparation,
            outgoing, persistedUserText } = preparation.turn;
        const { preparationHookNames, ownsFilterChain, preparationErrors, recordPreparationFilter } = preparation.hookState;
        const { startedAt, modelId, reasoning, contextPolicy, systemMessage, effectiveMessages, prepared, modalities,
            advertisedToolDefs, enabledToolDefs, browserToolCapability, allowBackgroundStreaming,
            foregroundToolDefs, reviewedLossyMessages } = preparation.model;
        const ownsAdmission = () => ownsPreparation() || (requestScope.detachAdmissionOnNavigation === true
            && requestScope.ownsDetachedAdmission?.() === true);
        let { orMessages } = preparation.model;
        if (requestScope.ownsView()) {
            streamId.value = undefined;
            backgroundJobId.value = null;
            detached.value = false;
        }

        let currentModelId: string | undefined;
        let terminalResult: SendResult | undefined;
        try {
            currentModelId = modelId;

            const newStreamId = requestScope.streamId!;
            requestScope.streamId = newStreamId;
            if (requestScope.ownsView()) streamId.value = newStreamId;
            requestScope.assistantMessageId = assistantDbMsg.id;
            requestScope.assistantRecord = assistantDbMsg;
            publishRequest(requestScope, {
                status: 'streaming',
                requestId,
                userMessageId: userDbMsg.id,
                assistantMessageId: assistantDbMsg.id,
            });
            // Track file hashes across loop iterations
            const assistantFileHashes: string[] = [];
            const persistAssistant = makeAssistantPersister(
                requestScope.originDb,
                assistantDbMsg,
                assistantFileHashes,
                requestId
            );
            requestScope.persistAssistant = persistAssistant;

            // Workflow execution returns control to the caller immediately,
            // so retain the request's DB/thread authority after sendMessage
            // detaches and clears ports.view.activeRequest().
            workflowMessageScopes.set(assistantDbMsg.id, {
                originDb: requestScope.originDb,
                workspaceId: requestScope.workspaceId,
                threadId: requestThreadId,
            });
            requestScope.workflowMessageId = assistantDbMsg.id;

            // A listener can be registered while preparation awaits and remove
            // itself when invoked. Capture its presence at the dispatch boundary.
            preparation.hookState.captureAction();
            await hooks.doAction('ai.chat.send:action:before', {
                threadId: requestThreadId,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? effectiveMessages.length
                    : undefined,
            });


            if (requestScope.ownsView()) {
                aborted.value = false;
                backgroundJobId.value = null;
                backgroundJobMode.value = 'none';
                backgroundJobInfo.value = null;
            }

            recordPreparationFilter('ai.chat.messages:filter:before_send');
            const mentionFilter = getBuiltinMentionFilter();
            const unchangedMentionInput = mentionFilter && typeof hooks.hasOnlyFilter === 'function' &&
                hooks.hasOnlyFilter('ai.chat.messages:filter:before_send', mentionFilter) ? JSON.stringify(orMessages) : undefined;
            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages, editorDoc: sendMessagesParams.editorDoc ?? null }
            );
            if (isRequestCancelled(requestScope) || !ownsAdmission())
                throw new DOMException('Chat request cancelled', 'AbortError');

            if (
                typeof filteredMessages === 'object' &&
                'messages' in filteredMessages
            ) {
                const candidate = (
                    filteredMessages as {
                        messages?: OpenRouterMessage[];
                    }
                ).messages;
                if (Array.isArray(candidate)) {
                    orMessages = candidate;
                }
            }
            if (unchangedMentionInput !== undefined && unchangedMentionInput !== JSON.stringify(orMessages)) preparation.hookState.markFilter();
            if (prepared.delegation) {
                const expectedDelegation = { ...prepared.delegation };
                const commit: ChatSendCommit = { requestId, workspaceId: requestScope.workspaceId,
                    workspaceGeneration, signal: preparationSignal, delegation: { ...expectedDelegation },
                    assistant: { id: assistantDbMsg.id, threadId: requestThreadId, streamId: newStreamId }, status: 'pending' };
                recordPreparationFilter('ai.chat.send:filter:commit');
                const acknowledgement = await hooks.applyFilters('ai.chat.send:filter:commit', commit);
                if (!ownsAdmission()) throw new DOMException('Chat request cancelled', 'AbortError');
                if (acknowledgement.status !== 'handled'
                    || acknowledgement.requestId !== requestId
                    || acknowledgement.workspaceId !== requestScope.workspaceId
                    || acknowledgement.workspaceGeneration !== workspaceGeneration
                    || acknowledgement.signal !== preparationSignal
                    // A runtime filter can return an incomplete acknowledgement.
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    || acknowledgement.assistant?.id !== assistantDbMsg.id
                    || acknowledgement.assistant.threadId !== requestThreadId
                    || acknowledgement.assistant.streamId !== newStreamId
                    || acknowledgement.delegation?.pluginId !== expectedDelegation.pluginId
                    || acknowledgement.delegation.generation !== expectedDelegation.generation
                    || acknowledgement.delegation.intent !== expectedDelegation.intent) {
                    consumeChatSendHandled();
                    throw new Error(acknowledgement.error?.message ?? 'The delegated request was not acknowledged. Retry it explicitly.');
                }
            }

            // Check if a workflow is handling this request - skip AI call
            if (consumeChatSendHandled() || prepared.delegation) {
                if (!requestScope.ownsView()) throw new Error('The request was interrupted while changing chats. Retry it.');
                // Seed UI with assistant placeholder so workflow state can render immediately
                const workflowAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };
                rawMessages.value.push(workflowAssistant);
                const uiAssistant = ensureUiMessage(workflowAssistant);
                uiAssistant.pending = true;
                messages.value.push(uiAssistant);

                requestScope.abortController = null;
                abortController.value = null;
                return {
                    status: 'detached',
                    requestId,
                    reason: 'detached',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            // This request is going through the regular model path; there is
            // no detached workflow completion that needs the retained scope.
            workflowMessageScopes.delete(assistantDbMsg.id);

            // Also skip if messages array is empty (e.g., workflow returned empty)
            if (orMessages.length === 0) {
                const emptyContextError =
                    'No model input remained after request filters.';
                requestScope.message = resolveUiMessage(assistantDbMsg.id);
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'failed',
                        error: new Error(emptyContextError),
                        messageError: 'empty_context',
                        generationState: 'error',
                    })
                );
                toast.add({
                    title: 'Message not sent',
                    description:
                        'A message filter removed all model input. Nothing was sent.',
                    color: 'warning',
                    duration: 3500,
                });
                reportError(
                    err('ERR_HOOK_FAILURE', emptyContextError, {
                        severity: 'info',
                        tags: {
                            domain: 'chat',
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                            stage: 'before_send_filter',
                        },
                    }),
                    { toast: false }
                );
                return {
                    status: 'failed',
                    requestId,
                    reason: 'empty_context',
                    error: emptyContextError,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            let delegationDefaults: DelegationDefaults | undefined;
            const nativePreparation = () => !preparation.hookState.hadAction() && !preparation.hookState.hadFilter() && ownsFilterChain() && !preparationHookNames.some(name => hasUnsafeDelegationFilter(hooks, name)) &&
                !preparationHookNames.some((name, index) => (hooks._diagnostics.errors[name] ?? 0) > preparationErrors[index]!) &&
                !hooks.hasAction('ai.chat.send:action:before');
            if (allowBackgroundStreaming && browserToolCapability?.defaultsCapture &&
                enabledToolDefs.some(tool => tool.function.name === DELEGATE_CHAT_TOOL) && nativePreparation()) {
                if (!ownsAdmission()) throw new DOMException('Chat request cancelled', 'AbortError');
                if (nativePreparation()) {
                    const first = orMessages[0];
                    const text = first?.role === 'system' && (typeof first.content === 'string' ? first.content
                        : Array.isArray(first.content) && first.content.length === 1 && first.content[0]?.type === 'text' ? first.content[0].text : undefined);
                    if (!systemMessage || (typeof systemMessage.content === 'string' && text === systemMessage.content)) {
                        const captured = DelegationDefaultsSchema.safeParse({ version: 1, instructions: systemMessage ? [first] : [] });
                        if (captured.success) delegationDefaults = captured.data;
                    }
                }
            }
            const durableDelegation = canUseDurableDelegation(enabledToolDefs, delegationDefaults,
                allowBackgroundStreaming && browserToolCapability?.durableDelegation === true);
            return await runPreparedNative({ requestScope, userDbMsg, assistantDbMsg, newStreamId, modelId, orMessages, modalities, reasoning, contextPolicy, enabledToolDefs, foregroundToolDefs, allowBackgroundStreaming, startedAt, reviewedLossyMessages, delegationDefaults, durableDelegation, recoveryInput: { ...sendMessagesParams, content }, projectQuery: persistedUserText, advertisedToolDefs, stopAcceptanceHeartbeat });
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                if (isDetached()) {
                    return {
                        status: 'detached',
                        requestId,
                        reason: 'detached',
                        userMessageId: userDbMsg.id,
                    };
                }
            }
            if (
                visibleRequest.value === requestScope &&
                tailAssistant.value?.id === requestScope.assistantMessageId
            )
                requestScope.message = tailAssistant.value;
            const stopped =
                isRequestCancelled(requestScope) ||
                requestScope.abortController?.signal.aborted === true;
            if (
                stopped &&
                requestScope.stopConfirmation &&
                !(await requestScope.stopConfirmation)
            ) {
                requestScope.attached.value = false;
                return {
                    status: 'detached',
                    requestId,
                    reason: 'detached',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
            }
            const rawError = isStaleDevModuleError(err)
                ? new Error(
                      'The development server reloaded while this message was starting. Reload OR3, then resend the message.'
                  )
                : err instanceof Error
                  ? err
                  : new Error(String(err));
            const visibleError = asAppError(rawError, { code: 'ERR_STREAM_FAILURE',
                ...(isStaleDevModuleError(err) ? { fallbackMessage: 'The development server reloaded. Reload OR3, then resend your message.' } : {}),
            });
            if (stopped) {
                terminalResult = {
                    status: 'aborted',
                    requestId,
                    reason: 'aborted',
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'aborted',
                        messageError: 'stopped',
                        deleteEmpty: true,
                        persistence: requestScope.backgroundAdmissionId
                            ? 'tracker'
                            : 'request',
                        beforePersist: async () => {
                            await hooks.doAction('ai.chat.send:action:after', {
                                threadId: requestThreadId,
                                aborted: true,
                            });
                        },
                    })
                );
            } else {
                terminalResult = {
                    status: 'failed',
                    requestId,
                    reason:
                        contextAdmissionFailureReason(rawError) ?? contextAdmissionFailureReason(visibleError) ?? (err instanceof ToolIterationLimitError ? 'tool_iteration_limit' : 'stream_error'),
                    error: visibleError.message,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: requestScope.assistantMessageId,
                };
                reportError(visibleError, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: requestThreadId,
                        streamId: requestScope.streamId || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    toast: true,
                });
                reportFinalization(
                    await finalizeRequest(requestScope, {
                        outcome: 'failed',
                        error: visibleError,
                        messageError: 'stream_interrupted',
                        generationState: 'interrupted',
                        // Keep the failed turn visible and retryable after
                        // the transient toast disappears or the page reloads.
                        deleteEmpty: false,
                        beforePersist: async () => {
                            if (requestScope.ownsView())
                                requestScope.accumulator.finalize({
                                    error: visibleError,
                                });
                            await hooks.doAction(
                                'ai.chat.stream:action:error',
                                {
                                    threadId: requestThreadId,
                                    streamId: requestScope.streamId,
                                    error: visibleError,
                                    aborted: false,
                                }
                            );
                        },
                    })
                );
            }
        } finally {
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (ports.view.activeRequest() === requestScope) {
                if (abortController.value) {
                    abortController.value = null;
                }
            }
            setTimeout(() => {
                if (
                    ports.view.activeRequest() === null &&
                    !loading.value &&
                    requestScope.accumulator.state.finalized
                ) {
                    resetStream();
                }
            }, 0);
        }
        return terminalResult;
    };
}
