import type { Ref } from 'vue';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { PaneContext } from '~~/types/chat-internal';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type { ChatMessage, ContentPart, SendMessageParams, SendResult } from '~/utils/chat/types';
import type { confirmLossyRequest } from '~/utils/chat/lossy-request';
import { createThreadInDb, type CreateThreadContext } from '~/db/threads';
import { appendTurnMessagesToDb } from '~/db/messages';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { getKvRecordByName, setKvByName } from '~/db/kv';
import { nowSec, newId } from '~/db/util';
import { serializeFileHashes } from '~/db/files-util';
import { chatToolPreferenceKey } from '~/utils/chat/tool-preferences';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { assistantTranscriptData, userTranscriptData } from '~/utils/chat/transcript';
import { createForegroundGenerationLease } from '~/utils/chat/generation-lease';
import { makeAssistantPersister, startForegroundGenerationHeartbeat } from './persistence';
import { deriveThreadTitle } from '~/utils/chat/thread-title';
import { isMeaningfulTitleInput } from '~~/shared/titles/title';
import { errorDiagnostics } from '~~/shared/errors';
import { err, reportError } from '~/utils/errors';
import { publishRequest, type ChatRequest } from './requestController';
import type { createChatViewProjection } from './viewProjection';
import type { StoredMessage } from './nativeExecutionTypes';

type GlobalWithPaneApi = typeof globalThis & { __or3MultiPaneApi?: UseMultiPaneApi };

/** Commits and publishes the user turn before assistant creation or delegation. */
export async function acceptUserTurn(input: {
    requestScope: ChatRequest;
    content: string;
    outgoing: string;
    sendMessagesParams: SendMessageParams;
    admissionThreadId: string;
    newPromptSelection: string;
    toolDraftId: string | undefined;
    workspaceGeneration: number;
    preparationSignal: AbortSignal;
    persistedUserText: string;
    parts: ContentPart[];
    files: SendMessageParams['files'];
    file_hashes: string[];
    contextOmission: Awaited<ReturnType<typeof confirmLossyRequest>>['omission'] | undefined;
    initialProjectId: string | null;
    projectAttachmentScope?: WorkspaceOperationScope;
    projectExtractionScope?: WorkspaceOperationScope;
    resolveChatProject: typeof import('~/db/project-workspace')['resolveChatProject'];
}, ports: {
    view: Pick<ReturnType<typeof createChatViewProjection>, 'messages' | 'rawMessages'>;
    threadIdRef: Ref<string | undefined>;
    hooks: TypedHookEngine;
    limits: CreateThreadContext['limits'];
    getActivePaneContext: () => PaneContext | null;
}): Promise<{ result: SendResult } | { userDbMsg: Awaited<ReturnType<typeof appendTurnMessagesToDb>>[0]; assistantDbMsg: StoredMessage; requestThreadId: string; stopAcceptanceHeartbeat: () => void }> {
    const { requestScope, content, outgoing, sendMessagesParams, admissionThreadId, newPromptSelection,
        toolDraftId, workspaceGeneration, preparationSignal, persistedUserText, parts, files, file_hashes,
        contextOmission, initialProjectId, projectAttachmentScope, projectExtractionScope, resolveChatProject } = input;
    const { messages, rawMessages } = ports.view;
    const { threadIdRef, hooks, getActivePaneContext } = ports;
    const requestId = requestScope.requestId;
    if (!requestScope.threadId) {
        const newThread = await createThreadInDb(
            requestScope.originDb,
            {
                id: admissionThreadId,
                title: deriveThreadTitle(content),
                title_source: 'temporary',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: newPromptSelection || null,
            },
            {
                hooks,
                limits: ports.limits,
            }
        );
        if (requestScope.cancelled) {
            return { result: { status: 'aborted', requestId, reason: 'aborted' } };
        }
        // A later new draft in this tab inherits the dashboard default.
        const draftKey = chatToolPreferenceKey(undefined, toolDraftId);
        const { row: draftTools } = await getKvRecordByName(draftKey, requestScope.originDb);
        if (draftTools?.value) await setKvByName(draftKey, null, requestScope.originDb, {
            isValid: () => getDb() === requestScope.originDb && getWorkspaceGeneration() === workspaceGeneration,
            ifClock: draftTools.clock,
        });
        requestScope.threadId = newThread.id;
        threadIdRef.value = newThread.id;
        // Bind thread to active pane immediately (before first user message hook) if multi-pane present.
        try {
            const mpApi = (globalThis as GlobalWithPaneApi)
                .__or3MultiPaneApi;
            if (mpApi?.panes.value && mpApi.activePaneIndex.value >= 0) {
                const pane = mpApi.panes.value[mpApi.activePaneIndex.value];
                if (pane && pane.mode === 'chat' && !pane.threadId) {
                    if (typeof mpApi.setPaneThread === 'function') {
                        try {
                            await mpApi.setPaneThread(
                                mpApi.activePaneIndex.value,
                                newThread.id
                            );
                        } catch {
                            pane.threadId = newThread.id;
                        }
                    } else {
                        pane.threadId = newThread.id;
                    }
                }
            }
        } catch {
            /* intentionally empty */
        }
    }
    const requestThreadId = requestScope.threadId!;
    const nextUserMessageId = newId();
    const nextAssistantId = newId();
    const streamId = newId();
    let stopAcceptanceHeartbeat = () => {};
    const [userDbMsg, assistantDbMsg] = await appendTurnMessagesToDb(requestScope.originDb, {
        id: nextUserMessageId,
        thread_id: requestThreadId,
        role: 'user',
        data: {
            ...userTranscriptData(nextUserMessageId),
            ...(sendMessagesParams.cardOrigin ? { card_origin: sendMessagesParams.cardOrigin } : {}),
            content: persistedUserText,
            attachments: files ?? [],
            ...(contextOmission ? { context_omission: contextOmission } : {}),
        },
        file_hashes: file_hashes.length
            ? serializeFileHashes(file_hashes)
            : undefined,
    }, {
        id: nextAssistantId, thread_id: requestThreadId, role: 'assistant', stream_id: streamId, pending: true,
        data: { ...assistantTranscriptData({ turnId: nextUserMessageId, requestId, generationId: streamId, mode: 'foreground' }),
            content: '', attachments: [], reasoning_text: null, generation_state: 'streaming', ...createForegroundGenerationLease(requestId) },
    }, { replace: sendMessagesParams.retryReplacement, onCommitted: (user, assistant) => {
        requestScope.userMessageId = user.id;
        requestScope.assistantMessageId = assistant.id;
        requestScope.assistantRecord = assistant as StoredMessage;
        requestScope.streamId = streamId;
        requestScope.persistAssistant = makeAssistantPersister(requestScope.originDb, assistant as StoredMessage, [], requestId);
        stopAcceptanceHeartbeat = startForegroundGenerationHeartbeat(requestScope.originDb, assistant.id, requestId, preparationSignal);
        // Project-source bindings still need their existing intake step before
        // the composer may acknowledge the turn.
        if (!initialProjectId || !projectAttachmentScope) publishRequest(requestScope, {
            status: 'persisted', requestId, userMessageId: user.id,
        });
    } }).catch((error: unknown) => {
        // A storage transaction abort is a failed save, not a user Stop.
        // Keep app-owned save guidance rather than cancellation copy.
        if (error instanceof Error && error.name === 'AbortError'
            && !requestScope.cancelled && !preparationSignal.aborted) {
            throw err('ERR_DB_WRITE_FAILED', 'Could not save the message locally.', {
                cause: error, tags: { domain: 'chat', stage: 'user-persist' },
            });
        }
        throw error;
    });
    if (isMeaningfulTitleInput(persistedUserText) && !rawMessages.value.some(message => message.role === 'user'
        && isMeaningfulTitleInput(typeof message.content === 'string' ? message.content
            : message.content.filter(part => part.type === 'text').map(part => part.text).join(' ')))) void import('~/utils/titles/generate')
        .then(({ generateAutomaticTitle }) => generateAutomaticTitle(requestScope.originDb, { type: 'chat', id: requestThreadId, content: persistedUserText, sourceMessage: { id: userDbMsg.id, clock: userDbMsg.clock } }))
        .catch(() => { /* Auxiliary naming cannot reject the primary send. */ });
    requestScope.userMessageId = userDbMsg.id;
    // Show the durable turn even if attachment intake is subsequently stopped.
    const rawUser: ChatMessage = {
        role: 'user',
        content: parts,
        id: userDbMsg.id,
        data: userDbMsg.data as ChatMessage['data'],
        file_hashes: userDbMsg.file_hashes,
    };
    if (requestScope.ownsView()) {
        rawMessages.value.push(rawUser);
        messages.value.push(ensureUiMessage(rawUser));
    }
    // Save source bindings before acknowledging the committed turn. Only
    // extraction runs in the background (the intake lease covers crashes).
    if (initialProjectId && projectAttachmentScope) {
        const scope = projectAttachmentScope;
        preparationSignal.throwIfAborted();
        let rejectCancellation!: (reason: unknown) => void;
        const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
        const onAbort = () => rejectCancellation(preparationSignal.reason);
        preparationSignal.addEventListener('abort', onAbort, { once: true });
        try {
            // Hooks may keep awaiting their own work after Stop. Release the
            // send immediately; the canceled scope fences any late writes.
            await Promise.race([cancellation, (async () => {
                scope.assertCurrent('write');
                const { addProjectUpload, addExistingProjectFile } = await import('~/utils/projects/source-intake');
                const { getFileBlob } = await import('~/db/files');
                scope.assertCurrent('write');
                if (await resolveChatProject(scope.db, requestThreadId) !== initialProjectId)
                    throw new Error('This chat changed projects before its attachments were added.');
                const options = { background: true, backgroundScope: projectExtractionScope };
                for (const hash of new Set(file_hashes)) {
                    const meta = await scope.db.file_meta.get(hash); const blob = await getFileBlob(hash, scope.db); scope.assertCurrent('write');
                    if (!meta || !blob || meta.deleted) throw new Error('An attachment is unavailable.');
                    await addProjectUpload(scope, initialProjectId, new File([blob], meta.name, { type: meta.mime_type }), undefined, options);
                }
                // Text uploads and Files handoffs enter the composer as references.
                if (sendMessagesParams.editorDoc) {
                    const { collectMentions } = await import('~/plugins/ChatMentions/useChatMentions');
                    const references = collectMentions(sendMessagesParams.editorDoc as unknown as Parameters<typeof collectMentions>[0]);
                    for (const reference of references.filter(item => item.source === 'file')) {
                        await addExistingProjectFile(scope, initialProjectId, reference.id, options);
                    }
                }
            })()]);
        } catch (error) {
            if (preparationSignal.aborted) throw error;
            reportError(error, { message: 'Message sent, but its attachments could not be added to project knowledge.', toast: true });
        } finally {
            preparationSignal.removeEventListener('abort', onAbort);
        }
    }
    preparationSignal.throwIfAborted();
    publishRequest(requestScope, {
        status: 'persisted',
        requestId,
        userMessageId: userDbMsg.id,
    });
    if (sendMessagesParams.onUserPersisted) {
        try {
            await sendMessagesParams.onUserPersisted(userDbMsg.id);
        } catch (error) {
            reportError(
                err('ERR_INTERNAL', 'Failed to finalize retried turn', {
                    severity: 'error',
                    tags: { domain: 'chat', stage: 'retry-persisted' },
                }),
                { toast: true }
            );
            if (import.meta.dev) console.warn('[useChat] retry persistence callback failed', errorDiagnostics(error));
        }
    }
    try {
        const ctx = getActivePaneContext();
        if (ctx) {
            void hooks.doAction('ui.pane.msg:action:sent', {
                pane: ctx.pane,
                paneIndex: ctx.paneIndex,
                message: {
                    id: userDbMsg.id,
                    threadId: requestThreadId,
                    length: outgoing.length,
                    fileHashes: userDbMsg.file_hashes || null,
                },
            });
        }
    } catch (e) {
        if (import.meta.dev) {
            console.warn('[useChat] pane hook failed', errorDiagnostics(e));
        }
    }

    return { userDbMsg, assistantDbMsg: assistantDbMsg as StoredMessage, requestThreadId, stopAcceptanceHeartbeat };
}
