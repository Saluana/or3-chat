import type { Ref } from 'vue';
import type { useToast } from '#imports';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { ChatSettings, ModelInfo, ExtendedSendMessageParams } from '~~/types/chat-internal';
import type { ChatMessage, ContentPart, SendMessageParams, SendResult } from '~/utils/chat/types';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type { prepareLossyRequest, confirmLossyRequest } from '~/utils/chat/lossy-request';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { newId } from '~/db/util';
import { serializeFileHashes } from '~/db/files-util';
import { normalizeFileUrl } from './files';
import { parseHashes, mergeAssistantFileHashes } from '~/utils/files/attachments';
import { resolveThreadProjection, requestHistoryFingerprint } from '~/utils/chat/compaction/history';
import { recoveryInputFingerprint, discardStaleRecovery } from '~/utils/chat/native-recovery';
import { projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { buildParts, shouldKeepAssistantMessage, getChatModalities } from '~/utils/chat/messages';
import { prepareOpenRouterRequest, getBackgroundClientToolCapability } from '~/utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { readChatToolPreferences } from '~/utils/chat/tool-preferences';
import { placeHistoryTools } from '~/utils/chat/history-placement';
import { inferMimeFromUrl } from '~/utils/chat/files';
import { acceptsImageInput, unsupportedImageInputMessage } from '~/utils/modelCatalog';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { resolveDefaultModel } from '~/core/auth/models-service';
import { DEFAULT_PROMPT_SELECTION } from '~/utils/chat/prompt-utils';
import { presentError } from '~~/shared/errors';
import { ChatContextAdmissionError, type ContextRequestPolicy } from '~~/shared/chat/context-budget';
import { resolveReasoningConfig } from '~~/shared/openrouter/reasoning';
import { openRouterToolCapability, resolveOpenRouterLegacySelection } from '~~/shared/openrouter/selection';
import { isOpenAiModel } from '~~/shared/openai/models';
import type { ChatSendPreparation } from '~~/shared/hooks/hook-domain-types';
import { delegationPreparationFilters, hasUnsafeDelegationFilter, placeServerModelSearch, withoutOpenRouterOnlyTools } from './delegationPolicy';
import { buildSystemPromptMessage, buildOpenRouterMessagesForSend } from './messageBuild';
import type { ChatRequest } from './requestController';
import type { OpenRouterMessage } from './nativeExecutionTypes';
import type { createNativeRecovery } from './nativeRecovery';
import type { createChatViewProjection } from './viewProjection';

/** Captures and validates a native turn before any message is committed. */
export function createTurnPreparation(ports: {
    view: Pick<ReturnType<typeof createChatViewProjection>, 'messages' | 'rawMessages'> & {
        threadIdRef: Ref<string | undefined>;
        pendingPromptIdRef: Ref<string | undefined>;
        abortController: Ref<AbortController | null>;
    };
    options: { forceForeground?: boolean; excludedTools?: readonly string[]; toolDraftId?: () => string | undefined };
    hooks: TypedHookEngine;
    toast: ReturnType<typeof useToast>;
    defaultModel: string;
    connected: Readonly<Ref<boolean>>;
    allowUserOverride: Readonly<Ref<boolean>>;
    effectiveApiKey: Readonly<Ref<string | null>>;
    hasInstanceKey: Readonly<Ref<boolean>>;
    guestAccessEnabled: Readonly<Ref<boolean>>;
    backgroundStreamingAllowed: Readonly<Ref<boolean>>;
    ssrAuthEnabled: () => boolean;
    startLogin: () => void;
    taskPrompt: () => unknown;
    enforceClientLimits: (isNewThread: boolean) => Promise<boolean>;
    recoverNativeTurn: ReturnType<typeof createNativeRecovery>;
    flushForSend: () => void;
}) {
    const { messages, rawMessages, threadIdRef, pendingPromptIdRef, abortController } = ports.view;
    const { options, hooks, toast, connected, allowUserOverride, effectiveApiKey, hasInstanceKey,
        guestAccessEnabled, backgroundStreamingAllowed, enforceClientLimits, recoverNativeTurn } = ports;
    const isRequestCancelled = (scope: ChatRequest): boolean => scope.cancelled;
    const early = (result: SendResult) => ({ done: true as const, result });
    return async function prepareTurn(requestScope: ChatRequest, contentOrParams: string | (SendMessageParams & { content: string }),
        maybeParams?: SendMessageParams) {
        const requestId = requestScope.requestId;
        let content: string;
        let sendMessagesParams: SendMessageParams;

        if (typeof contentOrParams === 'string') {
            content = contentOrParams;
            sendMessagesParams = maybeParams || {
                files: [],
                model: ports.defaultModel,
                file_hashes: [],
                online: false,
                context_hashes: [],
            };
        } else {
            content = contentOrParams.content;
            sendMessagesParams = contentOrParams;
        }

        // Detach user selections before any plugin/catalog/media await.
        sendMessagesParams = { ...sendMessagesParams,
            files: sendMessagesParams.files?.map((file) => ({ ...file })),
            file_hashes: sendMessagesParams.file_hashes?.slice(),
            context_hashes: sendMessagesParams.context_hashes?.slice(),
            extraTextParts: sendMessagesParams.extraTextParts?.slice(),
            historyOverride: sendMessagesParams.historyOverride ? structuredClone(sendMessagesParams.historyOverride) : undefined,
            editorDoc: sendMessagesParams.editorDoc ? structuredClone(sendMessagesParams.editorDoc) : undefined,
        };
        const workspaceGeneration = getWorkspaceGeneration();
        const toolDraftId = options.toolDraftId?.();
        const newPromptSelection = pendingPromptIdRef.value || DEFAULT_PROMPT_SELECTION;
        const taskPrompt = ports.taskPrompt();
        const preparationHookNames = delegationPreparationFilters;
        const ownsFilterChain = hooks.captureFilterChain(preparationHookNames);
        let hadPreparationAction = typeof hooks.hasAction === 'function' && Boolean(hooks.hasAction('ai.chat.send:action:before'));
        let hadPreparationFilter = typeof hooks.hasFilter === 'function' && preparationHookNames.some(name => hasUnsafeDelegationFilter(hooks, name));
        const recordPreparationFilter = (name: typeof preparationHookNames[number]) => {
            hadPreparationFilter ||= typeof hooks.hasFilter === 'function' && hasUnsafeDelegationFilter(hooks, name);
        };
        const preparationErrors = preparationHookNames.map((name) => hooks._diagnostics.errors[name] ?? 0);
        requestScope.abortController ??= new AbortController();
        abortController.value = requestScope.abortController;
        const preparationSignal = requestScope.abortController.signal;
        const ownsPreparation = () => !isRequestCancelled(requestScope) && !preparationSignal.aborted
            && requestScope.ownsView() && getDb() === requestScope.originDb
            && getWorkspaceGeneration() === workspaceGeneration;
        const { resolveChatProject, readProjectWorkspace, moveChatToProject } = await import('~/db/project-workspace');
        const initialProjectId = requestScope.threadId ? await resolveChatProject(requestScope.originDb, requestScope.threadId) : null;
        requestScope.expectedProjectId = initialProjectId;
        // Project intake is tied to the active pane. A pending navigation must
        // not allow that intake to write after the pane has changed.
        if (initialProjectId && requestScope.navigationPendingBeforeSave) {
            requestScope.cancelled = true;
            requestScope.abortController?.abort();
            return early({ status: 'aborted', requestId, reason: 'aborted' });
        }
        let projectAttachmentScope: WorkspaceOperationScope | undefined;
        let projectExtractionScope: WorkspaceOperationScope | undefined;
        if (requestScope.threadId && initialProjectId) {
            const { captureProjectOperation } = await import('~/utils/projects/context');
            // Capture the owner before any asynchronous preparation/dispatch.
            // Source extraction may outlive the stream, so it has its own signal.
            projectAttachmentScope = captureProjectOperation(preparationSignal, requestScope.threadId);
            projectExtractionScope = captureProjectOperation(undefined, requestScope.threadId);
            const scope = projectAttachmentScope;
            if (scope.writable && !(await scope.db.threads.get(requestScope.threadId))?.project_id)
                await moveChatToProject(scope, requestScope.threadId, initialProjectId, { family: false });
        }
        const projectState = initialProjectId ? await readProjectWorkspace(requestScope.originDb, initialProjectId) : undefined;
        const capturedPreference = await useAiSettings().captureContextPreference();
        if (!ownsPreparation()) return early({ status: 'aborted', requestId, reason: 'aborted' });
        const masterPrompt = useAiSettings().settings.value.masterSystemPrompt;

        // OpenAI models use the server's OpenAI credential, which the stream route checks.
        const hasKey = isOpenAiModel(sendMessagesParams.model || ports.defaultModel)
            || (allowUserOverride.value && connected.value) || Boolean(effectiveApiKey.value) || hasInstanceKey.value;
        if (!hasKey) {
            if (allowUserOverride.value && guestAccessEnabled.value) {
                // Guest access enabled - trigger OpenRouter login
                void ports.startLogin();
            } else if (!allowUserOverride.value) {
                toast.add({
                    title: 'Instance key required',
                    description:
                        'This deployment requires a managed OpenRouter key. Contact your administrator.',
                    color: 'warning',
                    duration: 4000,
                });
            } else if (ports.ssrAuthEnabled()) {
                // SSR mode: user must authenticate via the auth provider first
                toast.add({
                    title: 'Sign in required',
                    description: 'Please sign in to continue chatting.',
                    color: 'info',
                    duration: 4000,
                });
            } else {
                // Static/local mode: there is no "sign in" — the user just
                // needs an OpenRouter key. The chat input already shows
                // connect/paste actions; this is only a backstop.
                toast.add({
                    title: 'Connect to OpenRouter',
                    description: 'Add an OpenRouter API key to start chatting.',
                    color: 'info',
                    duration: 4000,
                });
            }
            return early({
                status: 'rejected',
                requestId,
                reason: 'missing_credentials',
            });
        }

        // Reuse the already filtered native payload, never request/delegation hooks.
        if (requestScope.threadId && !sendMessagesParams.historyOverride) {
            const recovery = await requestScope.originDb.chat_request_recoveries.get(requestScope.threadId);
            if (recovery && recovery.input_fingerprint === await recoveryInputFingerprint(content, sendMessagesParams)
                && !await discardStaleRecovery(requestScope.originDb, recovery)) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A durable checkpoint can be written by a newer client.
                if (recovery.version !== 1)
                    return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'This saved attempt uses an unsupported recovery version. Update the app or edit the draft to prepare a new request.' });
                if (sendMessagesParams.inspectLossyRequest || sendMessagesParams.lossyConfirmation)
                    return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'This saved attempt has a final payload. Retry it with another model or reply allowance, or edit the draft for a new request.' });
                return early(await recoverNativeTurn(requestScope, recovery, sendMessagesParams));
            }
        }

        // Extract extra text parts early so we can account for them in validation.
        // Large pastes (>600 words) are captured into extraTextParts while the
        // editor text field (content) is left empty — the send button and model
        // must still accept the message.
        const earlyExtraTextParts: string[] = Array.isArray(
            sendMessagesParams.extraTextParts
        )
            ? sendMessagesParams.extraTextParts.filter(
                  (t): t is string => typeof t === 'string' && t.trim() !== ''
              )
            : [];

        recordPreparationFilter('ui.chat.message:filter:outgoing');
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        if (
            (!outgoing ||
                typeof outgoing !== 'string' ||
                outgoing.trim() === '') &&
            earlyExtraTextParts.length === 0
        ) {
            toast.add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                duration: 3000,
            });
            return early({ status: 'rejected', requestId, reason: 'filtered' });
        }

        // Navigation can happen while an async outgoing filter is running. Do
        // not let that older admission create messages in the newly selected
        // thread after it resumes.
        if (
            isRequestCancelled(requestScope) ||
            (requestScope.threadId &&
                threadIdRef.value !== requestScope.threadId)
        ) {
            return early({ status: 'aborted', requestId, reason: 'aborted' });
        }

        const canSend = await enforceClientLimits(!requestScope.threadId);
        if (!canSend)
            return early({ status: 'rejected', requestId, reason: 'client_limit' });

        if (!requestScope.threadId) {
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const { catalog } = useModelStore();
                let lastSelected: string | null = null;
                const defaultModelMode: 'lastSelected' | 'fixed' =
                    settingsValue?.defaultModelMode === 'fixed'
                        ? 'fixed'
                        : 'lastSelected';
                try {
                    if (typeof window !== 'undefined')
                        lastSelected = localStorage.getItem(
                            'last_selected_model'
                        );
                } catch {
                    /* intentionally empty */
                }
                const chosen = resolveDefaultModel(
                    {
                        defaultModelMode,
                        fixedModelId: settingsValue?.fixedModelId ?? null,
                    },
                    {
                        isAvailable: (id: string) =>
                            catalog.value.some((m: ModelInfo) => m.id === id),
                        lastSelectedModelId: () => lastSelected,
                        recommendedDefault: () => ports.defaultModel,
                    }
                );
                if (!sendMessagesParams.model) {
                    sendMessagesParams.model = chosen.id;
                }
                if (
                    settingsValue?.defaultModelMode === 'fixed' &&
                    chosen.reason !== 'fixed'
                ) {
                    try {
                        toast.add({
                            title: 'Model fallback in effect',
                            description:
                                'Your fixed model was not used. Falling back to last selected or default.',
                            duration: 3500,
                        });
                    } catch {
                        /* intentionally empty */
                    }
                }
            } catch {
                /* intentionally empty */
            }
        } // END create-new-thread block

        const preparationThreadId = requestScope.threadId;
        // Reserve the actual new-thread ID, reused by the existing creator
        // after admission. No assistant IDs or saved-row hooks run here.
        // Blank panes use either undefined or the empty string. Neither is a
        // durable thread identity for preparation or the atomic first write.
        const admissionThreadId = preparationThreadId || newId();

        ports.flushForSend();

        const prevAssistantRaw = [...rawMessages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        const prevAssistant = prevAssistantRaw
            ? messages.value.find((m) => m.id === prevAssistantRaw.id)
            : null;
        const assistantHashes = prevAssistantRaw?.file_hashes
            ? parseHashes(prevAssistantRaw.file_hashes)
            : [];

        requestScope.accumulator.reset();
        let { files, model, file_hashes } = sendMessagesParams;
        model ||= projectState?.settings.default_model ?? undefined;
        const {
            extraTextParts,
            online,
            modelVariant,
            thinking,
            reasoningEffort,
            context_hashes,
        } = sendMessagesParams;
        const extendedParams = sendMessagesParams as ExtendedSendMessageParams;
        if (
            (!files || files.length === 0) &&
            Array.isArray(extendedParams.images)
        ) {
            files = extendedParams.images
                .map((img) => {
                    const url = typeof img === 'string' ? img : img.url;
                    if (!url) return null;
                    const provided =
                        typeof img === 'object' ? img.type : undefined;
                    const type =
                        inferMimeFromUrl(url, provided) ||
                        provided ||
                        'application/octet-stream';
                    return { type, url };
                })
                .filter(
                    (
                        f
                    ): f is {
                        type: string;
                        url: string;
                    } => Boolean(f && f.url && f.type)
                );
        }
        if (!model) model = ports.defaultModel;
        const selection = resolveOpenRouterLegacySelection({ model, thinking, online, modelVariant });
        const { catalog, favoriteModels } = useModelStore();
        const requestedThinking = selection.thinking;
        model = selection.requestModel;

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);

        // Verify files exist (no Base64 conversion - that happens in buildOpenRouterMessages)
        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );
        if (isRequestCancelled(requestScope) || threadIdRef.value !== preparationThreadId) {
            return early({ status: 'aborted', requestId, reason: 'aborted' });
        }

        const parts: ContentPart[] = buildParts(
            outgoing,
            hydratedFiles,
            extraTextParts
        );
        // Persist the full user-visible text so reloads and retries keep pasted
        // large-text blocks. The in-flight model input still uses `parts` so
        // image/file parts are preserved for this request.
        const persistedUserText = [outgoing, ...(extraTextParts ?? [])]
            .filter(
                (t): t is string => typeof t === 'string' && t.trim() !== ''
            )
            .join('\n\n');
        let canonicalHistory = sendMessagesParams.historyOverride ?? rawMessages.value.slice();
        let measuredUsage: unknown;
        let sourceFingerprint: string | undefined;
        if (preparationThreadId) {
            try {
                const projection = await resolveThreadProjection(preparationThreadId, requestScope.originDb);
                sourceFingerprint = requestHistoryFingerprint(projection);
                for (const row of [...projection.messages].reverse()) {
                    if (row.role !== 'assistant') continue;
                    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
                        const usage = (row.data as Record<string, unknown>).usage;
                        if (usage) { measuredUsage = usage; break; }
                    }
                }
                if (sendMessagesParams.retryExcludedMessageIds) {
                    const excluded = new Set(sendMessagesParams.retryExcludedMessageIds);
                    if ([...excluded].some((id) => !projection.messages.some((row) => row.id === id && row.thread_id === preparationThreadId))) {
                        return early({ status: 'rejected', requestId, reason: 'unavailable' });
                    }
                    canonicalHistory = projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript(
                        projection.messages.filter((row) => !excluded.has(row.id))));
                } else if (!sendMessagesParams.historyOverride) canonicalHistory = projectTranscriptForOpenRouter(
                    storedMessagesToCanonicalTranscript(projection.messages));
            } catch (error) {
                if (!ownsPreparation()) return early({ status: 'aborted', requestId, reason: 'aborted' });
                toast.add({ title: 'Conversation unavailable', description: presentError(error).message, color: 'warning' });
                return early({ status: 'rejected', requestId, reason: 'unavailable' });
            }
        }
        const startedAt = Date.now();
        recordPreparationFilter('ai.chat.model:filter:select');
        const modelId = await hooks.applyFilters('ai.chat.model:filter:select', model);
        const readiness = await useModelStore().resolveContextModel(modelId, { signal: preparationSignal });
        if (!readiness.ok) throw new ChatContextAdmissionError(readiness);
        const budgetModelMeta = catalog.value.find((entry) => entry.id === readiness.modelId)
            ?? favoriteModels.value.find((entry) => entry.id === readiness.modelId);
        // Model filters can select a different model; its metadata must own
        // the reasoning options sent with the resulting request.
        const reasoning = requestedThinking
            ? resolveReasoningConfig({ model: budgetModelMeta, enabled: true, effort: reasoningEffort })
            : undefined;
        const imageInput = acceptsImageInput(budgetModelMeta);
        // Refuse before any write: silently dropping an image the user just
        // attached would answer a question about content the model never saw.
        if (!imageInput && parts.some((part) => part.type === 'image'))
            return early({ status: 'rejected', requestId, reason: 'unsupported_input',
                error: unsupportedImageInputMessage(budgetModelMeta?.name ?? readiness.modelId) });
        if (requestScope.threadId && initialProjectId) {
            const { buildProjectContext, captureProjectOperation } = await import('~/utils/projects/context');
            requestScope.projectContext = await buildProjectContext(
                captureProjectOperation(preparationSignal, requestScope.threadId), requestScope.threadId,
                persistedUserText, readiness.metadata.architecture?.input_modalities?.includes('image') === true,
                initialProjectId, 'turn', projectState);
        }
        const contextPolicy: ContextRequestPolicy = Object.freeze({ model: readiness.metadata,
            userMaxContextTokens: capturedPreference.maxContextTokens, source: readiness.source,
            requestedCompletionTokens: sendMessagesParams.maxCompletionTokens, measuredUsage });
        const systemMessage = await buildSystemPromptMessage({ threadId: preparationThreadId,
            promptSelection: newPromptSelection, activePromptContent: taskPrompt,
            masterPrompt });
        const candidateUser: ChatMessage = { role: 'user', content: parts,
            file_hashes: file_hashes.length ? serializeFileHashes(file_hashes) : undefined };
        const messagesWithSystemRaw = [...canonicalHistory, ...(requestScope.projectContext?.messages ?? []), candidateUser];
        if (systemMessage) messagesWithSystemRaw.unshift(systemMessage);
        recordPreparationFilter('ai.chat.messages:filter:input');
        const effectiveMessages = await hooks.applyFilters('ai.chat.messages:filter:input', messagesWithSystemRaw);
        const sanitizedEffectiveMessages = (Array.isArray(effectiveMessages) ? effectiveMessages : []).filter(shouldKeepAssistantMessage);
        let orMessages = await buildOpenRouterMessagesForSend({ effectiveMessages: sanitizedEffectiveMessages,
            assistantHashes, prevAssistantId: prevAssistant?.id, contextHashes: context_hashes,
            fileHashes: Array.isArray(file_hashes) ? file_hashes : [], maxImageInputs: 5, imageInclusionPolicy: 'all',
            acceptsImageInput: imageInput, signal: preparationSignal });
        const preparation: ChatSendPreparation = { requestId, workspaceId: requestScope.workspaceId,
            workspaceGeneration, model: modelId, messages: JSON.parse(JSON.stringify(orMessages)) as ChatSendPreparation['messages'],
            editorDoc: sendMessagesParams.editorDoc, signal: preparationSignal };
        recordPreparationFilter('ai.chat.send:filter:prepare');
        const prepared = await hooks.applyFilters('ai.chat.send:filter:prepare', preparation);
        if (!ownsPreparation()) return early({ status: 'aborted', requestId, reason: 'aborted' });
        if (!ownsFilterChain() || preparationHookNames.some((name, index) => (hooks._diagnostics.errors[name] ?? 0) > preparationErrors[index]!))
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'Request filters changed or failed during preparation. Retry the request.' });
        if (prepared.delegation && requestScope.projectContext) return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'This workflow has not declared a project context boundary. Use a normal project chat.' });
        if (prepared.error) return early({ status: 'rejected', requestId, reason: 'unavailable', error: prepared.error.message });
        if (prepared.requestId !== requestId || prepared.workspaceId !== requestScope.workspaceId
            || prepared.workspaceGeneration !== workspaceGeneration || prepared.model !== modelId
            || prepared.signal !== preparationSignal || !Array.isArray(prepared.messages))
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'Request preparation changed ownership. Retry the request.' });
        orMessages = JSON.parse(JSON.stringify(prepared.messages)) as OpenRouterMessage[];
        if (!prepared.delegation && !orMessages.length)
            return early({ status: 'rejected', requestId, reason: 'empty_context', error: 'No model input remained after preparation.' });
        const modalities = getChatModalities(readiness.metadata);
        const toolRegistry = useToolRegistry();
        const modelSupportsTools = openRouterToolCapability(budgetModelMeta) !== 'unsupported';
        const { projectToolEnabled } = await import('~/utils/projects/context');
        const filterProjectTools = (tools: import('~/utils/chat/types').ToolDefinition[]) => withoutOpenRouterOnlyTools(requestScope.projectContext
            ? tools.filter(tool => projectToolEnabled(requestScope.projectContext!.settings, tool.function.name)) : tools, readiness.modelId);
        const chatToolPreferences = await readChatToolPreferences(requestScope.originDb, preparationThreadId, toolDraftId);
        const advertisedToolDefs = JSON.parse(JSON.stringify(filterProjectTools(modelSupportsTools ? toolRegistry.getEnabledDefinitions({
            workspaceId: requestScope.workspaceId, threadId: admissionThreadId }, chatToolPreferences).filter(tool => !options.excludedTools?.includes(tool.function.name)) : []))) as import('~/utils/chat/types').ToolDefinition[];
        let enabledToolDefs = await placeHistoryTools(advertisedToolDefs, { background: !options.forceForeground && backgroundStreamingAllowed.value,
            threadId: preparationThreadId, signal: preparationSignal });
        const hasBrowserTools = enabledToolDefs.some((tool) => tool.runtime === 'client');
        const browserToolCapability = options.forceForeground || !hasBrowserTools || !backgroundStreamingAllowed.value
            ? undefined : await getBackgroundClientToolCapability(preparationSignal);
        const browserToolBridgeAvailable = !browserToolCapability || browserToolCapability.available;
        const allowBackgroundStreaming = !options.forceForeground && !requestScope.projectContext && backgroundStreamingAllowed.value && browserToolBridgeAvailable
            && modalities.length === 1 && modalities[0] === 'text';
        enabledToolDefs = placeServerModelSearch(enabledToolDefs, allowBackgroundStreaming && browserToolCapability?.serverModelSearch === true);
        const foregroundToolDefs = enabledToolDefs.filter((tool) => tool.runtime !== 'server');
        const providerPreparation = { projectContext: requestScope.projectContext, model: modelId, orMessages, modalities, reasoning,
            tools: (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs).length
                ? (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs) : undefined,
            contextPolicy, signal: preparationSignal };
        const lossyScope = { db: requestScope.originDb, generation: workspaceGeneration,
            threadId: preparationThreadId, sourceFingerprint };
        let lossyPreview: Awaited<ReturnType<typeof prepareLossyRequest>> | undefined;
        let contextOmission: Awaited<ReturnType<typeof confirmLossyRequest>>['omission'] | undefined;
        let reviewedLossyMessages: string | undefined;
        if (sendMessagesParams.inspectLossyRequest || sendMessagesParams.lossyConfirmation) {
            const { prepareLossyRequest, confirmLossyRequest, LossyRequestUnavailableError } = await import('~/utils/chat/lossy-request');
            if (!ownsPreparation()) return early({ status: 'aborted', requestId, reason: 'aborted' });
            if (prepared.delegation) return early({ status: 'rejected', requestId, reason: 'unavailable',
                error: 'Delegated requests cannot omit native history. Edit the request or compact the conversation.' });
            if (sendMessagesParams.inspectLossyRequest) {
                try { lossyPreview = await prepareLossyRequest(providerPreparation, lossyScope); }
                catch (error) {
                    if (!(error instanceof LossyRequestUnavailableError)) throw error;
                    return early({ status: 'rejected', requestId, reason: 'context_full', error: error.message });
                }
            } else {
                const confirmed = await confirmLossyRequest(sendMessagesParams.lossyConfirmation!, providerPreparation, lossyScope);
                orMessages = confirmed.messages as OpenRouterMessage[]; contextOmission = confirmed.omission;
                reviewedLossyMessages = JSON.stringify(orMessages);
            }
        } else if (!prepared.delegation) await prepareOpenRouterRequest(providerPreparation);
        if (requestScope.threadId && await resolveChatProject(requestScope.originDb, requestScope.threadId) !== initialProjectId)
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'This chat changed projects during preparation. Retry the request.' });
        if (sourceFingerprint && requestHistoryFingerprint(await resolveThreadProjection(preparationThreadId!, requestScope.originDb)) !== sourceFingerprint)
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'Conversation changed during preparation. Retry the request.' });
        const currentToolPreferences = await readChatToolPreferences(requestScope.originDb, preparationThreadId, toolDraftId);
        if (!ownsPreparation()) return early({ status: 'aborted', requestId, reason: 'aborted' });
        if (JSON.stringify(currentToolPreferences) !== JSON.stringify(chatToolPreferences)
            || !ownsFilterChain() || useAiSettings().settings.value.masterSystemPrompt !== masterPrompt
            || (!preparationThreadId && !requestScope.navigationPendingBeforeSave && (pendingPromptIdRef.value || DEFAULT_PROMPT_SELECTION) !== newPromptSelection)
            || JSON.stringify(filterProjectTools(modelSupportsTools ? toolRegistry.getEnabledDefinitions({ workspaceId: requestScope.workspaceId,
                threadId: admissionThreadId }, currentToolPreferences).filter(tool => !options.excludedTools?.includes(tool.function.name)) : [])) !== JSON.stringify(advertisedToolDefs))
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'Request configuration changed during preparation. Retry the request.' });
        if (!preparationThreadId && !requestScope.navigationPendingBeforeSave && options.toolDraftId?.() !== toolDraftId)
            return early({ status: 'rejected', requestId, reason: 'unavailable', error: 'The active draft changed. Retry the request.' });
        if (lossyPreview) return early({ status: 'rejected', requestId, reason: 'context_full', lossyPreview,
            error: 'Review the listed omissions before sending this one request.' });
        return { done: false as const,
            turn: { requestId, content, sendMessagesParams, workspaceGeneration, toolDraftId, preparationSignal,
                ownsPreparation, newPromptSelection, outgoing, admissionThreadId, files, file_hashes, parts,
                persistedUserText, contextOmission },
            project: { resolveChatProject, initialProjectId, projectAttachmentScope, projectExtractionScope },
            hookState: { preparationHookNames, ownsFilterChain, preparationErrors, recordPreparationFilter,
                captureAction: () => { hadPreparationAction ||= typeof hooks.hasAction === 'function' && Boolean(hooks.hasAction('ai.chat.send:action:before')); },
                hadAction: () => hadPreparationAction, hadFilter: () => hadPreparationFilter,
                markFilter: () => { hadPreparationFilter = true; } },
            model: { startedAt, modelId, reasoning, contextPolicy, systemMessage, effectiveMessages, orMessages,
                prepared, modalities, chatToolPreferences, advertisedToolDefs, enabledToolDefs, browserToolCapability,
                allowBackgroundStreaming, foregroundToolDefs, reviewedLossyMessages },
        };
    };
}
