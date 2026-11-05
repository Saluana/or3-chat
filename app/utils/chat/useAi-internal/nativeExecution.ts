import type { Ref } from 'vue';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { PaneContext } from '~~/types/chat-internal';
import type { ChatMessage, SendResult } from '~/utils/chat/types';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { newId } from '~/db/util';
import { serializeFileHashes } from '~/db/files-util';
import { asAppError, reportError } from '~/utils/errors';
import { errorDiagnostics } from '~~/shared/errors';
import { ToolIterationLimitError } from '~~/shared/chat/stream-errors';
import { contextAdmissionFailureReason } from '~~/shared/chat/context-budget';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { startBackgroundStream, prepareOpenRouterRequest } from '~/utils/chat/openrouterStream';
import { saveNativeRecoveryCheckpoint } from '~/utils/chat/native-recovery';
import { BackgroundTrackerConflict } from './background-tracker-conflict';
import { makeAssistantPersister, updateMessageRecord, startForegroundGenerationHeartbeat } from './persistence';
import { projectCanonicalBackgroundMessage } from './backgroundJobPersistence';
import { reloadTurnIntoRawMessages } from './turnWriteback';
import { finalizeRequest, publishRequest, type ChatRequest, type RequestFinalization } from './requestController';
import type { createChatViewProjection } from './viewProjection';
import type { createBackgroundAttachmentCoordinator } from './backgroundAttachment';
import type { createNativeRecoveryCandidates } from './nativeRecovery';
import type { NativeExecutionInput, StoredMessage } from './nativeExecutionTypes';

/** Runs one already-admitted native request. The request controller remains the lifecycle authority. */
export function createNativeExecution(ports: {
    view: Pick<ReturnType<typeof createChatViewProjection>, 'rawMessages' | 'tailAssistant' | 'resolveUiMessage'> & {
        threadIdRef: Ref<string | undefined>;
        visibleRequest: Ref<ChatRequest | null>;
        abortController: Ref<AbortController | null>;
        loading: Readonly<Ref<boolean>>;
        activeRequest: () => ChatRequest | null;
        isDetached: () => boolean;
        resetStream: () => void;
        getActivePaneContext: () => PaneContext | null;
    };
    background: Pick<ReturnType<typeof createBackgroundAttachmentCoordinator>, 'attachBackgroundJobToUi' | 'ensureScopedBackgroundTracker' | 'normalizeBackgroundToolCalls'> & {
        backgroundStreamingAllowed: Readonly<Ref<boolean>>;
        serverNotificationsEnabled: Readonly<Ref<boolean>>;
        backgroundJobId: Ref<string | null>;
        backgroundJobMode: Ref<'none' | 'background'>;
        backgroundJobInfo: Ref<{ jobId: string; threadId: string; messageId: string } | null>;
        notifyBackgroundAdmissionUncertain: () => void;
        logBgStream: (stage: string, details?: Record<string, unknown>) => void;
        warnBgStream: (stage: string, details?: Record<string, unknown>) => void;
    };
    hooks: TypedHookEngine;
    nativeRecoveryCandidates: ReturnType<typeof createNativeRecoveryCandidates>;
    effectiveApiKey: Readonly<Ref<string | null>>;
    resolveChatLimits: (workspaceId: string) => Promise<import('~~/shared/chat/chat-limits').ChatLimits>;
    taskPrompt: () => unknown;
    canonicalOutputLimitBytes: number | undefined;
    ownsCurrentView: (request: ChatRequest) => boolean;
    reportFinalization: (result: RequestFinalization) => void;
    isStaleDevModuleError: (error: unknown) => boolean;
    warnDelegation: () => void;
}) {
    const { rawMessages, tailAssistant, resolveUiMessage, threadIdRef, visibleRequest, abortController,
        loading, isDetached, resetStream, getActivePaneContext } = ports.view;
    const { backgroundStreamingAllowed, serverNotificationsEnabled, backgroundJobId, backgroundJobMode,
        backgroundJobInfo, attachBackgroundJobToUi, ensureScopedBackgroundTracker, normalizeBackgroundToolCalls,
        notifyBackgroundAdmissionUncertain, logBgStream, warnBgStream } = ports.background;
    const { hooks, nativeRecoveryCandidates, effectiveApiKey, canonicalOutputLimitBytes,
        ownsCurrentView, reportFinalization, isStaleDevModuleError } = ports;
    const isRequestCancelled = (scope: ChatRequest): boolean => scope.cancelled;
    /** One native foreground/background owner, shared by new turns and explicit unsent recovery. */
    return async function runPreparedNative(input: NativeExecutionInput): Promise<SendResult> {
        const { requestScope, userDbMsg, assistantDbMsg, newStreamId, modelId, orMessages, modalities, reasoning, contextPolicy, enabledToolDefs, foregroundToolDefs, allowBackgroundStreaming, startedAt, reviewedLossyMessages, delegationDefaults, durableDelegation, recoveryInput, projectQuery, advertisedToolDefs } = input;
        const requestId = requestScope.requestId; const requestThreadId = requestScope.threadId!;
        const preparationSignal = requestScope.abortController!.signal;
        const toolRegistry = useToolRegistry(); const activeToolCalls = new Map<string, ToolCallInfo>();
        const assistantFileHashes: string[] = []; const persistAssistant = makeAssistantPersister(requestScope.originDb, assistantDbMsg, assistantFileHashes, requestId);
        requestScope.persistAssistant = persistAssistant;
        const currentModelId = modelId; let terminalResult: SendResult | undefined; let stopForegroundHeartbeat: (() => void) | undefined;
        try {
            // Old side-effecting final filters retain their once-only post-write
            // order. Their final native body is still admitted before inference;
            // universal zero-write admission requires migration to pure prepare.
            if (reviewedLossyMessages && JSON.stringify(orMessages) !== reviewedLossyMessages) {
                throw Object.assign(new Error('A final request filter changed the reviewed lossy candidate. Inspect the omissions again.'),
                    { code: 'context_full' });
            }
            const { retryReplacement: _replacement, onUserPersisted: _persisted, historyOverride: _history, lossyConfirmation: _confirmation, inspectLossyRequest: _inspect, ...savedInput } = recoveryInput;
            // Durable before inference: rejection or crash cannot append another user turn.
            const checkpoint = await saveNativeRecoveryCheckpoint({ db: requestScope.originDb,
                requestId, threadId: requestThreadId, userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id,
                savedInput, messages: orMessages, tools: advertisedToolDefs, delegationDefaults,
                projectContext: () => requestScope.projectContext, projectQuery,
                masterPrompt: () => useAiSettings().settings.value.masterSystemPrompt, taskPrompt: ports.taskPrompt,
                cancelled: () => isRequestCancelled(requestScope) });
            nativeRecoveryCandidates.prepared(requestScope, checkpoint);
            await prepareOpenRouterRequest({ projectContext: requestScope.projectContext, model: modelId, orMessages, modalities, reasoning,
                tools: (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs).length
                    ? (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs) : undefined,
                contextPolicy, signal: preparationSignal });
            if (isRequestCancelled(requestScope)) {
                reportFinalization(await finalizeRequest(requestScope, {
                    outcome: 'aborted', messageError: 'stopped', deleteEmpty: true,
                }));
                return { status: 'aborted', requestId, reason: 'aborted', userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
            }
            if (!ownsCurrentView(requestScope)) {
                requestScope.attached.value = false;
                return { status: 'detached', requestId, reason: 'detached', userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
            }
            if (!durableDelegation && enabledToolDefs.some(tool => tool.function.name === DELEGATE_CHAT_TOOL)) {
                ports.warnDelegation();
            }
            logBgStream('send-message-stream-mode-decision', {
                threadId: requestThreadId,
                allowBackgroundStreaming,
                backgroundStreamingAllowed: backgroundStreamingAllowed.value,
                enabledToolCount: enabledToolDefs.length,
                modalities,
            });

            if (allowBackgroundStreaming) {
                backgroundJobMode.value = 'background';
                logBgStream('send-message-background-start', {
                    threadId: requestThreadId,
                    messageId: assistantDbMsg.id,
                    streamId: newStreamId,
                });

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                rawMessages.value.push(rawAssistant);
                const uiAssistant = ensureUiMessage(rawAssistant);
                uiAssistant.pending = true;
                tailAssistant.value = uiAssistant;
                requestScope.message = uiAssistant;

                // Background admission can block before a job ID exists. Keep it
                // cancellable through the same request-scoped controller as foreground.
                requestScope.abortController ??= new AbortController();
                abortController.value = requestScope.abortController;

                // Stable per-send admission identity. Persisted on the request
                // scope before the start request so Stop can target the
                // admission even before a job ID returns.
                const backgroundAdmissionId = newId();
                requestScope.backgroundAdmissionId = backgroundAdmissionId;

                try {
                    const toolRuntime =
                        enabledToolDefs.length > 0
                            ? enabledToolDefs.reduce<Record<string, string>>(
                                  (acc, tool) => {
                                      if (tool.runtime) {
                                          acc[tool.function.name] =
                                              tool.runtime;
                                      }
                                      return acc;
                                  },
                                  {}
                              )
                            : undefined;

                    // Capture the exact local records before paid execution.
                    // The assistant stays pending locally (so HookBridge does
                    // not race it); the server commits this envelope directly
                    // to canonical sync history before claiming the job.
                    await updateMessageRecord(
                        requestScope.originDb,
                        assistantDbMsg.id,
                        {
                            data: {
                                background_admission_id: backgroundAdmissionId,
                                generation_mode: 'background',
                                generation_state: 'streaming',
                                background_history_version: 1,
                            },
                        }
                    );
                    const [historyThread, historyAssistant] = await Promise.all(
                        [
                            requestScope.originDb.threads.get(requestThreadId),
                            requestScope.originDb.messages.get(
                                assistantDbMsg.id
                            ),
                        ]
                    );
                    if (!historyThread || !historyAssistant) {
                        throw new Error(
                            'Unable to capture canonical background history'
                        );
                    }

                    // No request has been sent yet. A session or view change
                    // during history capture must not dispatch under the new
                    // authority. The pending turn uses normal interruption recovery.
                    if (isRequestCancelled(requestScope) || requestScope.abortController.signal.aborted)
                        throw new DOMException('Chat request cancelled.', 'AbortError');
                    if (!ownsCurrentView(requestScope)) {
                        requestScope.attached.value = false;
                        return { status: 'detached', requestId, reason: 'detached',
                            userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
                    }

                    const result = await startBackgroundStream({
                        expectedProjectId: requestScope.expectedProjectId,
                        apiKey: effectiveApiKey.value,
                        model: modelId,
                        orMessages: orMessages as Parameters<
                            typeof startBackgroundStream
                        >[0]['orMessages'],
                        modalities,
                        contextPolicy,
                        delegationDefaults,
                        durableDelegation,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        admissionId: backgroundAdmissionId,
                        history: {
                            version: 1,
                            kind: 'new-turn',
                            admissionId: backgroundAdmissionId,
                            generationId: newStreamId,
                            workspaceId: requestScope.workspaceId,
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                            thread: historyThread,
                            userMessage: userDbMsg,
                            assistantMessage: historyAssistant,
                        },
                        reasoning,
                        tools:
                            enabledToolDefs.length > 0
                                ? enabledToolDefs
                                : undefined,
                        toolRuntime,
                        signal: requestScope.abortController.signal,
                    });
                    requestScope.jobId = result.jobId;
                    if (ownsCurrentView(requestScope) && !isRequestCancelled(requestScope)) publishRequest(requestScope, {
                        status: 'streaming', requestId, userMessageId: userDbMsg.id,
                        assistantMessageId: assistantDbMsg.id, providerAccepted: true });
                    nativeRecoveryCandidates.accepted(requestScope);
                    if (isRequestCancelled(requestScope) && requestScope.stopConfirmation) {
                        throw new DOMException('Admission cancelled', 'AbortError');
                    }

                    logBgStream('send-message-background-job-created', {
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        streamId: newStreamId,
                        jobId: result.jobId,
                    });

                    if (
                        assistantDbMsg.data &&
                        typeof assistantDbMsg.data === 'object'
                    ) {
                        assistantDbMsg.data = {
                            ...(assistantDbMsg.data as Record<string, unknown>),
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        };
                    } else {
                        assistantDbMsg.data = {
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        } as Record<string, unknown>;
                    }
                    await projectCanonicalBackgroundMessage(
                        requestScope.originDb,
                        assistantDbMsg.id,
                        {
                            data: {
                                background_job_id: result.jobId,
                                background_admission_id: backgroundAdmissionId,
                                background_job_status: 'streaming',
                                generation_mode: 'background',
                                generation_state: 'streaming',
                            },
                        }
                    );

                    requestScope.jobId = result.jobId;
                    const ownsCurrentThread = ownsCurrentView(requestScope);
                    if (ownsCurrentThread) {
                        backgroundJobId.value = result.jobId;
                        backgroundJobInfo.value = {
                            jobId: result.jobId,
                            threadId: requestThreadId,
                            messageId: assistantDbMsg.id,
                        };
                    }
                    const tracker = ownsCurrentThread
                        ? attachBackgroundJobToUi({
                              jobId: result.jobId,
                              userId: requestScope.originUserId!,
                              messageId: assistantDbMsg.id,
                              threadId: requestThreadId,
                              originDb: requestScope.originDb,
                              workspaceId: requestScope.workspaceId,
                              canonicalHistory: true,
                              generationId: newStreamId,
                              initialContent: '',
                              useSse: backgroundStreamingAllowed.value,
                              request: requestScope,
                          })
                        : ensureScopedBackgroundTracker({
                              jobId: result.jobId,
                              userId: requestScope.originUserId!,
                              messageId: assistantDbMsg.id,
                              threadId: requestThreadId,
                              originDb: requestScope.originDb,
                              workspaceId: requestScope.workspaceId,
                              canonicalHistory: true,
                              generationId: newStreamId,
                              preferServerNotifications:
                                  serverNotificationsEnabled.value,
                              initialContent: '',
                              useSse: false,
                          });

                    logBgStream('send-message-background-await-completion', {
                        jobId: tracker.jobId,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                    });
                    const completion = await tracker.completion;
                    if (completion.trackingInterrupted) {
                        requestScope.attached.value = false;
                        return {
                            status: 'detached',
                            requestId,
                            reason: 'detached',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                    reportFinalization(
                        await finalizeRequest(requestScope, {
                            outcome:
                                completion.status === 'complete'
                                    ? 'completed'
                                    : completion.status === 'aborted'
                                      ? 'aborted'
                                      : 'failed',
                            content: completion.content ?? tracker.lastContent,
                            reasoning: completion.reasoning_text,
                            toolCalls: normalizeBackgroundToolCalls(
                                completion.tool_calls
                            ),
                            messageError:
                                completion.status === 'complete'
                                    ? null
                                    : completion.status === 'aborted'
                                      ? 'stopped'
                                      : (completion.error ??
                                        'Background stream failed'),
                            persistence: 'tracker',
                            canonicalFinalized: completion.canonicalFinalized,
                            attempt: completion.attempt,
                        })
                    );
                    logBgStream('send-message-background-completed', {
                        jobId: tracker.jobId,
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                    });
                    if (completion.status === 'aborted') {
                        return {
                            status: 'aborted',
                            requestId,
                            reason: 'aborted',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                    if (completion.status === 'error') {
                        return {
                            status: 'failed',
                            requestId,
                            reason: 'stream_error',
                            error:
                                completion.error || 'Background stream failed',
                            userMessageId: userDbMsg.id,
                            assistantMessageId: assistantDbMsg.id,
                        };
                    }
                } catch (error) {
                    if (
                        isRequestCancelled(requestScope) ||
                        requestScope.abortController.signal.aborted ||
                        (error instanceof Error && error.name === 'AbortError')
                    ) {
                        // Let the request-level abort path own cleanup and the
                        // terminal result. Treating admission cancellation as a
                        // provider failure leaves a false error row behind.
                        throw error;
                    }
                    if (error instanceof BackgroundTrackerConflict) {
                        requestScope.attached.value = false;
                        return { status: 'detached', requestId, reason: 'detached',
                            userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
                    }
                    if (error instanceof Error && 'backgroundAdmissionUncertain' in error && error.backgroundAdmissionUncertain === true) {
                        nativeRecoveryCandidates.acceptedIfPresent(requestScope);
                        if (ownsCurrentView(requestScope)) notifyBackgroundAdmissionUncertain();
                        requestScope.attached.value = false;
                        return { status: 'detached', requestId, reason: 'detached',
                            userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
                    }
                    const errMessage =
                        error instanceof Error
                            ? error.message
                            : 'Background stream failed';
                    // This admission may have been superseded by navigation. Its
                    // durable row still belongs to the origin DB, but no shared
                    // UI state (tail, loading, background controls, accumulator)
                    // may be touched once it no longer owns the visible view.
                    const ownsView = ownsCurrentView(requestScope);
                    warnBgStream('send-message-background-failed', {
                        threadId: requestThreadId,
                        messageId: assistantDbMsg.id,
                        error: errMessage,
                        ownsCurrentView: ownsView,
                    });
                    requestScope.message = ownsView
                        ? resolveUiMessage(assistantDbMsg.id)
                        : requestScope.message;
                    const failureReason = contextAdmissionFailureReason(error) ?? 'stream_error';
                    reportFinalization(
                        await finalizeRequest(requestScope, {
                            outcome: 'failed',
                            error: error instanceof Error ? error : new Error(errMessage),
                            messageError: failureReason === 'context_full' && !requestScope.jobId ? 'context_full' : errMessage,
                            failureReason,
                        })
                    );
                    return {
                        status: 'failed',
                        requestId,
                        reason: failureReason,
                        error: errMessage,
                        userMessageId: userDbMsg.id,
                        assistantMessageId: assistantDbMsg.id,
                    };
                }

                return {
                    status: 'complete',
                    requestId,
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }

            requestScope.abortController ??= new AbortController();
            abortController.value = requestScope.abortController;

            stopForegroundHeartbeat = startForegroundGenerationHeartbeat(
                requestScope.originDb, assistantDbMsg.id, requestId,
                requestScope.abortController.signal
            );
            input.stopAcceptanceHeartbeat?.();
            const chatLimits = await ports.resolveChatLimits(requestScope.workspaceId);
            preparationSignal.throwIfAborted();
            const streamApiKey = effectiveApiKey.value;
            const streamGeneration = getWorkspaceGeneration();
            const { runForegroundStreamLoop } = await import('~/utils/chat/useAi-internal/foregroundStream');
            if (isRequestCancelled(requestScope) || getDb() !== requestScope.originDb
                || getWorkspaceGeneration() !== streamGeneration) throw new DOMException('Chat request cancelled.', 'AbortError');
            if (!ownsCurrentView(requestScope)) {
                requestScope.attached.value = false;
                return { status: 'detached', requestId, reason: 'detached',
                    userMessageId: userDbMsg.id, assistantMessageId: assistantDbMsg.id };
            }
            await runForegroundStreamLoop({
                chatLimits,
                apiKey: streamApiKey,
                modelId,
                orMessages,
                modalities,
                reasoning,
                contextPolicy,
                tools:
                    foregroundToolDefs.length > 0
                        ? foregroundToolDefs
                        : undefined,
                onProviderAccepted: () => {
                    nativeRecoveryCandidates.accepted(requestScope);
                    if (ownsCurrentView(requestScope) && !isRequestCancelled(requestScope)) publishRequest(requestScope, {
                        status: 'streaming', requestId, userMessageId: userDbMsg.id,
                        assistantMessageId: assistantDbMsg.id, providerAccepted: true });
                },
                abortSignal: requestScope.abortController.signal,
                assistantId: assistantDbMsg.id,
                parentTurnId: userDbMsg.id,
                streamId: newStreamId,
                threadId: requestThreadId,
                projectContext: requestScope.projectContext,
                expectedProjectId: requestScope.expectedProjectId,
                originDb: requestScope.originDb,
                streamAcc: requestScope.accumulator,
                workspaceId: requestScope.workspaceId,
                hooks,
                toolRegistry,
                persistAssistant,
                assistantFileHashes,
                activeToolCalls,
                tailAssistant,
                rawMessages,
                toolLedger: requestScope.toolLedger,
                outputLimitBytes: canonicalOutputLimitBytes,
            });
            stopForegroundHeartbeat();

            requestScope.abortController.signal.throwIfAborted();
            const current = tailAssistant.value!;
            requestScope.message = current;
            const fullText = current.text;
            const hookName = 'ui.chat.message:filter:incoming';
            const errorsBefore = hooks._diagnostics.errors[hookName] ?? 0;
            const incoming = await hooks.applyFilters(
                hookName,
                fullText,
                requestThreadId
            );
            requestScope.abortController.signal.throwIfAborted();
            const errorsAfter = hooks._diagnostics.errors[hookName] ?? 0;
            if (errorsAfter > errorsBefore) {
                throw new Error('Incoming filter threw an exception');
            }
            requestScope.message = current;
            const finalization = await finalizeRequest(requestScope, {
                outcome: 'completed',
                content: incoming,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                afterPersist: async () => {
                    // Write the finished turn (assistant + tool rows) back into the
                    // canonical history. Without this, rawMessages keeps the empty
                    // placeholder and the next request loses the answer and tools.
                    try {
                        if (requestScope.ownsView())
                            await reloadTurnIntoRawMessages(
                                requestScope.originDb,
                                requestThreadId,
                                assistantDbMsg.id,
                                rawMessages,
                                threadIdRef
                            );
                    } catch (writebackError) {
                        if (import.meta.dev) {
                            console.warn(
                                '[useChat] turn writeback failed',
                                errorDiagnostics(writebackError)
                            );
                        }
                    }
                    const finalized: StoredMessage = {
                        ...assistantDbMsg,
                        file_hashes: assistantFileHashes.length
                            ? serializeFileHashes(assistantFileHashes)
                            : assistantDbMsg.file_hashes,
                    };
                    await hooks.doAction('ai.chat.stream:action:complete', {
                        threadId: requestThreadId,
                        workspaceId: requestScope.workspaceId,
                        projectId: requestScope.projectContext?.projectId ?? null,
                        assistantId: assistantDbMsg.id,
                        streamId: newStreamId,
                        totalLength: incoming.length,
                        reasoningLength: (current.reasoning_text || '').length,
                        fileHashes: finalized.file_hashes || null,
                    });
                    try {
                        const ctx = getActivePaneContext();
                        if (ctx) {
                            void hooks.doAction('ui.pane.msg:action:received', {
                                pane: ctx.pane,
                                paneIndex: ctx.paneIndex,
                                message: {
                                    id: finalized.id,
                                    threadId: requestThreadId,
                                    length: incoming.length,
                                    fileHashes: finalized.file_hashes || null,
                                    reasoningLength: (
                                        current.reasoning_text || ''
                                    ).length,
                                },
                            });
                        }
                    } catch {
                        /* intentionally empty */
                    }
                    const endedAt = Date.now();
                    await hooks.doAction('ai.chat.send:action:after', {
                        threadId: requestThreadId,
                        request: { modelId, userId: userDbMsg.id },
                        response: {
                            assistantId: assistantDbMsg.id,
                            length: incoming.length,
                        },
                        timings: {
                            startedAt,
                            endedAt,
                            durationMs: endedAt - startedAt,
                        },
                        aborted: false,
                    });
                },
            });
            reportFinalization(finalization);
            if (finalization.persistenceError) {
                return {
                    status: 'failed',
                    requestId,
                    reason: 'stream_error',
                    error:
                        finalization.persistenceError instanceof Error
                            ? finalization.persistenceError.message
                            : String(finalization.persistenceError),
                    userMessageId: userDbMsg.id,
                    assistantMessageId: assistantDbMsg.id,
                };
            }
            terminalResult = {
                status: 'complete',
                requestId,
                userMessageId: userDbMsg.id,
                assistantMessageId: assistantDbMsg.id,
            };
        } catch (err) {
            stopForegroundHeartbeat?.();
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
                        messageError: terminalResult.reason === 'context_full' ? 'context_full' : 'stream_interrupted',
                        generationState: 'interrupted',
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
            stopForegroundHeartbeat?.();
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
    }

}
