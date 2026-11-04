import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { ChatRequest as ChatRequestScope } from './requestController';
import type { NativeExecutionInput, StoredMessage } from './nativeExecutionTypes';
import type { NativeRecoveryCheckpoint } from '~/utils/chat/native-recovery';
import { recoverySourceFingerprint, recoveryProjectFingerprint } from '~/utils/chat/native-recovery';
import type { SendMessageParams, SendResult } from '~/utils/chat/types';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { newId, getWriteTxTableNames } from '~/db/util';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { readChatToolPreferences } from '~/utils/chat/tool-preferences';
import { placeHistoryTools } from '~/utils/chat/history-placement';
import { getBackgroundClientToolCapability, prepareOpenRouterRequest } from '~/utils/chat/openrouterStream';
import { getChatModalities } from '~/utils/chat/messages';
import { updateMessageRecord } from './persistence';
import { assistantTranscriptData } from '~/utils/chat/transcript';
import { createForegroundGenerationLease } from '~/utils/chat/generation-lease';
import { resolveOpenRouterLegacySelection, openRouterToolCapability } from '~~/shared/openrouter/selection';
import { resolveReasoningConfig } from '~~/shared/openrouter/reasoning';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { ChatContextAdmissionError, contextAdmissionFailureReason, type ContextRequestPolicy } from '~~/shared/chat/context-budget';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationDefaultsSchema } from '~~/shared/chat/delegation-checkpoint';
import { delegationPreparationFilters, hasUnsafeDelegationFilter, canUseDurableDelegation, placeServerModelSearch, withoutOpenRouterOnlyTools } from './delegationPolicy';

/** Tracks only recovery eligibility; request finalization remains with requestController. */
export function createNativeRecoveryCandidates() {
    const candidates = new WeakMap<ChatRequestScope, { checkpoint: NativeRecoveryCheckpoint; providerAccepted: boolean }>();
    return {
        shouldCleanup(scope: ChatRequestScope, result: SendResult) {
            const candidate = candidates.get(scope);
            return !!candidate && !(result.status === 'failed' && result.reason === 'context_full' && !candidate.providerAccepted);
        },
        prepared(scope: ChatRequestScope, checkpoint: NativeRecoveryCheckpoint) {
            candidates.set(scope, { checkpoint, providerAccepted: false });
        },
        accepted(scope: ChatRequestScope) {
            candidates.get(scope)!.providerAccepted = true;
        },
        acceptedIfPresent(scope: ChatRequestScope) {
            const candidate = candidates.get(scope);
            if (candidate) candidate.providerAccepted = true;
        },
        async cleanup(scope: ChatRequestScope, result: SendResult): Promise<void> {
            const candidate = candidates.get(scope);
            if (!candidate) return;
            try {
                await scope.originDb.transaction('rw', scope.originDb.chat_request_recoveries, async () => {
                    const saved = await scope.originDb.chat_request_recoveries.get(candidate.checkpoint.thread_id);
                    if (saved?.request_id === scope.requestId) await scope.originDb.chat_request_recoveries.delete(saved.thread_id);
                });
            } catch {
                if (result.status === 'failed') result.error += ' Local recovery cleanup failed. Keep this draft and retry after local storage is available.';
            }
        },
    };
}

/** Recovery retains the original checkpoint and request controller; it owns no second lifecycle. */
export function createNativeRecovery(ports: {
    defaultModel: string;
    forceForeground?: boolean;
    excludedTools?: readonly string[];
    backgroundAllowed: () => boolean;
    taskPrompt: () => unknown;
    hooks: TypedHookEngine;
    onAdmitted: (scope: ChatRequestScope, userId: string, assistantId: string, streamId: string) => void;
    execute: (input: NativeExecutionInput) => Promise<SendResult>;
}) {
    return async function recoverNativeTurn(requestScope: ChatRequestScope, checkpoint: NativeRecoveryCheckpoint, params: SendMessageParams): Promise<SendResult> {
        const requestId = requestScope.requestId; const db = requestScope.originDb; const generation = getWorkspaceGeneration();
        const signal = requestScope.abortController!.signal;
        const owns = () => !requestScope.cancelled && !signal.aborted && requestScope.ownsView()
            && getDb() === db && getWorkspaceGeneration() === generation;
        const unavailable = (error: string): SendResult => ({ status: 'failed', requestId, reason: 'unavailable', error,
            userMessageId: checkpoint.user_message_id, assistantMessageId: checkpoint.assistant_message_id });
        const [userDbMsg, savedAssistant] = await Promise.all([db.messages.get(checkpoint.user_message_id), db.messages.get(checkpoint.assistant_message_id)]);
        if (!owns()) return { status: 'aborted', requestId, reason: 'aborted' };
        if (!userDbMsg || userDbMsg.deleted || userDbMsg.role !== 'user' || userDbMsg.thread_id !== checkpoint.thread_id
            || !savedAssistant || savedAssistant.deleted || savedAssistant.pending || savedAssistant.role !== 'assistant'
            || savedAssistant.thread_id !== checkpoint.thread_id || typeof (savedAssistant.data as Record<string, unknown> | null)?.background_job_id === 'string'
            || typeof (savedAssistant.data as Record<string, unknown> | null)?.superseded_by === 'string')
            return unavailable('This saved attempt is no longer available for initial recovery.');
        const assistantData = savedAssistant.data as Record<string, unknown> | null;
        if (savedAssistant.error !== 'context_full' || assistantData?.request_id !== checkpoint.request_id)
            return unavailable('This attempt was not an initial context rejection. Use its normal retry or continuation.');
        if (assistantData.turn_id !== userDbMsg.id || assistantData.parent_turn_id !== userDbMsg.id)
            return unavailable('The saved assistant no longer belongs to this user turn.');
        if (assistantData.content || assistantData.reasoning_text || savedAssistant.file_hashes)
            return unavailable('This generation already has output. Use its normal continuation or compact the conversation.');
        const masterPrompt = useAiSettings().settings.value.masterSystemPrompt; const taskPrompt = ports.taskPrompt();
        if (checkpoint.source_fingerprint !== await recoverySourceFingerprint(db, checkpoint.thread_id, savedAssistant.id, masterPrompt, taskPrompt))
            return unavailable('The saved conversation changed. Edit the draft to prepare a new request.');
        const { resolveChatProject } = await import('~/db/project-workspace');
        const projectId = await resolveChatProject(db, checkpoint.thread_id);
        requestScope.expectedProjectId = projectId;
        const { projectToolEnabled } = await import('~/utils/projects/context');
        const store = useModelStore(); const preference = await useAiSettings().captureContextPreference();
        const selection = resolveOpenRouterLegacySelection({ ...params, model: params.model || ports.defaultModel });
        const modelId = selection.requestModel;
        const readiness = await store.resolveContextModel(modelId, { signal });
        if (!readiness.ok) return { status: 'failed', requestId, reason: readiness.code,
            error: 'Refresh this model’s capacity before recovering the saved turn.', userMessageId: userDbMsg.id, assistantMessageId: savedAssistant.id };
        const metadata = store.catalog.value.find((row) => row.id === readiness.modelId) ?? store.favoriteModels.value.find((row) => row.id === readiness.modelId);
        const reasoning = selection.thinking
            ? resolveReasoningConfig({ model: metadata, enabled: true, effort: params.reasoningEffort }) : undefined;
        if (projectId) {
            if (typeof checkpoint.project_query !== 'string')
                return unavailable('The saved attempt lacks its admitted project query. Edit the draft to prepare a fresh request.');
            const { buildProjectContext, captureProjectOperation } = await import('~/utils/projects/context');
            const snapshot = await buildProjectContext(captureProjectOperation(signal, checkpoint.thread_id), checkpoint.thread_id,
                checkpoint.project_query,
                readiness.metadata.architecture?.input_modalities?.includes('image') === true, projectId);
            if (!snapshot || !checkpoint.project_fingerprint || await recoveryProjectFingerprint(snapshot) !== checkpoint.project_fingerprint)
                return unavailable('Project context changed. Edit the draft to prepare a fresh request.');
            requestScope.projectContext = snapshot;
        } else if (checkpoint.project_fingerprint) return unavailable('The saved chat changed projects. Prepare a fresh request.');
        const filterProjectTools = (tools: import('~/utils/chat/types').ToolDefinition[]) => withoutOpenRouterOnlyTools(requestScope.projectContext
            ? tools.filter(tool => projectToolEnabled(requestScope.projectContext!.settings, tool.function.name)) : tools, modelId);
        const advertisedToolDefs = openRouterToolCapability(metadata) === 'unsupported' ? []
            : filterProjectTools(useToolRegistry().getEnabledDefinitions({ workspaceId: requestScope.workspaceId, threadId: checkpoint.thread_id }, await readChatToolPreferences(db, checkpoint.thread_id))
                .filter(tool => !ports.excludedTools?.includes(tool.function.name)));
        if (advertisedToolDefs.length !== checkpoint.tools.length || advertisedToolDefs.some((tool, index) => !toolDefinitionEquals(tool, checkpoint.tools[index]!)))
            return unavailable('The saved attempt’s tools changed or this model cannot use them. Restore its tools or edit the draft for a new request.');
        let enabledToolDefs = await placeHistoryTools(structuredClone(advertisedToolDefs), { background: !ports.forceForeground && !projectId && ports.backgroundAllowed(), threadId: checkpoint.thread_id, signal });
        const hasBrowserTools = enabledToolDefs.some((tool) => tool.runtime === 'client');
        const browserToolCapability = ports.forceForeground || !hasBrowserTools || !ports.backgroundAllowed()
            ? undefined : await getBackgroundClientToolCapability(signal);
        const bridgeReady = !browserToolCapability || browserToolCapability.available;
        const modalities = getChatModalities(readiness.metadata); const allowBackgroundStreaming = !ports.forceForeground && !projectId && ports.backgroundAllowed() && bridgeReady && modalities.length === 1 && modalities[0] === 'text';
        enabledToolDefs = placeServerModelSearch(enabledToolDefs, allowBackgroundStreaming && browserToolCapability?.serverModelSearch === true);
        const foregroundToolDefs = enabledToolDefs.filter((tool) => tool.runtime !== 'server');
        const contextPolicy: ContextRequestPolicy = { model: readiness.metadata, source: readiness.source,
            userMaxContextTokens: preference.maxContextTokens, requestedCompletionTokens: params.maxCompletionTokens };
        const orMessages = structuredClone(checkpoint.messages);
        const savedDelegationDefaults = DelegationDefaultsSchema.safeParse(checkpoint.delegation_defaults);
        const delegationDefaults = allowBackgroundStreaming && browserToolCapability?.defaultsCapture
            && enabledToolDefs.some(tool => tool.function.name === DELEGATE_CHAT_TOOL) && savedDelegationDefaults.success
            && !delegationPreparationFilters.some(name => hasUnsafeDelegationFilter(ports.hooks, name)) && !ports.hooks.hasAction('ai.chat.send:action:before')
            ? savedDelegationDefaults.data : undefined;
        const durableDelegation = canUseDurableDelegation(enabledToolDefs, delegationDefaults,
            allowBackgroundStreaming && browserToolCapability?.durableDelegation === true);
        try {
            await prepareOpenRouterRequest({ projectContext: requestScope.projectContext, model: modelId, orMessages, modalities, reasoning, contextPolicy, signal,
                tools: (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs).length ? (allowBackgroundStreaming ? enabledToolDefs : foregroundToolDefs) : undefined });
        } catch (error) {
            if (!(error instanceof ChatContextAdmissionError)) throw error;
            return { status: 'failed', requestId, reason: contextAdmissionFailureReason(error) ?? 'context_full',
                error: error.message, userMessageId: userDbMsg.id, assistantMessageId: savedAssistant.id };
        }
        if (!owns()) return { status: 'aborted', requestId, reason: 'aborted' };
        if (JSON.stringify(advertisedToolDefs) !== JSON.stringify(openRouterToolCapability(metadata) === 'unsupported' ? []
            : filterProjectTools(useToolRegistry().getEnabledDefinitions({ workspaceId: requestScope.workspaceId, threadId: checkpoint.thread_id }, await readChatToolPreferences(db, checkpoint.thread_id))
                .filter(tool => !ports.excludedTools?.includes(tool.function.name)))))
            return unavailable('Tool selection changed during recovery. Retry the saved attempt again.');
        const newStreamId = newId();
        const reset = await db.transaction('rw', [...new Set([...getWriteTxTableNames(db, 'messages', { includeTombstones: true }), 'threads', 'projects', 'posts', 'chat_request_recoveries'])], async () => {
            if (!owns() || useAiSettings().settings.value.masterSystemPrompt !== masterPrompt || ports.taskPrompt() !== taskPrompt
                || checkpoint.source_fingerprint !== await recoverySourceFingerprint(db, checkpoint.thread_id, savedAssistant.id, masterPrompt, taskPrompt)) return false;
            const current = await db.messages.get(savedAssistant.id);
            if (!current || current.clock !== savedAssistant.clock || current.pending || current.deleted) return false;
            await updateMessageRecord(db, savedAssistant.id, { pending: true, error: null, stream_id: newStreamId,
                data: { ...assistantTranscriptData({ turnId: userDbMsg.id, requestId, generationId: newStreamId, mode: 'foreground' }),
                    generation_state: 'streaming', content: '', reasoning_text: null, tool_calls: null, background_job_id: undefined,
                    background_admission_id: undefined, background_job_status: undefined, ...createForegroundGenerationLease(requestId) } });
            return true;
        });
        if (!reset) return unavailable('The saved attempt changed before recovery could start.');
        requestScope.userMessageId = userDbMsg.id; requestScope.assistantMessageId = savedAssistant.id;
        const assistantDbMsg = await db.messages.get(savedAssistant.id) as StoredMessage;
        if (!owns()) throw new DOMException('Recovery canceled after admission.', 'AbortError');
        requestScope.userMessageId = userDbMsg.id; requestScope.assistantMessageId = assistantDbMsg.id; requestScope.assistantRecord = assistantDbMsg;
        ports.onAdmitted(requestScope, userDbMsg.id, assistantDbMsg.id, newStreamId);
        return await ports.execute({ requestScope, userDbMsg, assistantDbMsg, newStreamId, modelId, orMessages, modalities, reasoning, contextPolicy,
            enabledToolDefs, foregroundToolDefs, allowBackgroundStreaming, delegationDefaults, durableDelegation, startedAt: Date.now(),
            recoveryInput: { ...checkpoint.input, ...params, content: checkpoint.input.content }, projectQuery: checkpoint.project_query, advertisedToolDefs });
    }

}
