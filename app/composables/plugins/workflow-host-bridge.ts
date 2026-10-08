/** Host services for the trusted Workflows package, bound by the V2 client loader. */
import { watch } from 'vue';
import { HTTPClient } from '@openrouter/sdk';
import { useNuxtApp } from '#app';
import { useAppConfig, useHooks, useRuntimeConfig, useToast } from '#imports';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue';
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue';
import UIcon from '@nuxt/ui/components/Icon.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import UModal from '@nuxt/ui/components/Modal.vue';
import UPopover from '@nuxt/ui/components/Popover.vue';
import UTabs from '@nuxt/ui/components/Tabs.vue';
import UTextarea from '@nuxt/ui/components/Textarea.vue';
import UTooltip from '@nuxt/ui/components/Tooltip.vue';
import { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
import MessageAttachmentsGallery from '~/components/chat/MessageAttachmentsGallery.vue';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useOr3Config } from '~/composables/useOr3Config';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { useSidebarMultiPane, useSidebarPostsApi } from '~/composables/sidebar/useSidebarEnvironment';
import { useActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { usePostsList } from '~/composables/posts/usePostsList';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { getGlobalSidebarLayoutApi, closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { programmaticPrefill } from '~/composables/chat/useChatInputBridge';
import { parseHashes } from '~/utils/files/attachments';
import { useModelStore } from '~/composables/chat/useModelStore';
import { getDb, getActiveWorkspaceId, getWorkspaceGeneration } from '~/db/client';
import { resolveChatProject } from '~/db/project-workspace';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { createOpenRouterClient, DEFAULT_HEADERS, wrapLegacyChatSendArgs } from '~~/shared/openrouter';
import { createOrRefFile, changeRefCount } from '~/db/files';
import { dataUrlToBlob } from '~/utils/chat/files';
import { hasSupportedRasterBlobSignature, isSupportedRasterMimeType } from '~~/shared/files/file-kind';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { nowSec, nextClock, getWriteTxTableNames } from '~/db/util';
import { markChatSendHandled } from '~/utils/chat/send-interception';
import { abortBackgroundJob, pollJobStatus, isBackgroundStreamingEnabled } from '~/utils/chat/openrouterStream';
import { ensureBackgroundJobTracker } from '~/utils/chat/useAi-internal/backgroundJobs';
import { reportError } from '~/utils/errors';

import { createScopedRecordStore } from './trusted-production-stores';
import { createLegacyWorkflowRecordAccess } from './workflow-records-compat';
import { isWorkflowMessageData } from '~/utils/chat/workflow-types';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import type { Message } from '~/db/schema';

interface WorkflowRequestOrigin { threadId: string; messageId: string; streamId: string }

let warnedLegacyWorkflowOrigin = false;
function warnLegacyWorkflowOrigin() {
    if (warnedLegacyWorkflowOrigin) return;
    warnedLegacyWorkflowOrigin = true;
    console.warn('[workflows] This Workflows package predates run origins. Update it before using workflows in workspaces with projects.');
}

function getPostsApi(): PanePluginApi | null {
    return (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi ?? null;
}

async function persistGeneratedImage(scope: WorkspaceOperationScope, original: Message, dataUrl: string): Promise<string> {
    const db = scope.db;
    const assertCurrent = () => scope.assertCurrent('write');
    assertCurrent();
    if (dataUrl.length > 28 * 1024 * 1024) throw new Error('Generated image exceeds the file limit.');
    const blob = dataUrlToBlob(dataUrl);
    if (!blob || !isSupportedRasterMimeType(blob.type) || !(await hasSupportedRasterBlobSignature(blob, blob.type))) {
        throw new Error('Generated output is not a supported raster image.');
    }
    assertCurrent();
    const file = await createOrRefFile(blob, 'workflow-generated-image', { assertCurrent });
    try {
        await db.transaction('rw', getWriteTxTableNames(db, ['messages', 'file_meta', 'threads', 'projects']), async () => {
            assertCurrent();
            const message = await db.messages.get(original.id);
            if (!message || message.deleted || message.thread_id !== original.thread_id
                || message.stream_id !== original.stream_id || !isWorkflowMessageData(message.data))
                throw new Error('The workflow message is no longer available.');
            if (await resolveChatProject(db, original.thread_id))
                throw new Error('This workflow cannot capture project context. Use a normal project chat.');
            assertCurrent();
            const hashes = parseHashes(message.file_hashes);
            if (hashes.includes(file.hash)) {
                await changeRefCount(file.hash, -1, db);
            } else {
                if (hashes.length >= 6) throw new Error('A workflow message may attach at most six generated images.');
                await db.messages.put({
                    ...message,
                    file_hashes: JSON.stringify([...hashes, file.hash]),
                    updated_at: nowSec(),
                    clock: nextClock(message.clock),
                });
            }
        });
    } catch (error) {
        await changeRefCount(file.hash, -1, db);
        throw error;
    }
    return file.hash;
}

/** Resolve only while a Nuxt plugin setup context is active. */
export function createWorkflowHostBridge(signal?: AbortSignal) {
    const nuxtApp = useNuxtApp();
    const modelStore = useModelStore();
    const hooks = useHooks();
    const runtimeConfig = useRuntimeConfig();
    const session = useSessionContext();
    const { apiKey } = useUserApiKey();
    const toast = useToast();
    const activationDb = getDb();
    const activationGeneration = getWorkspaceGeneration();
    const workflowFeatures = useOr3Config().features.workflows;
    const appConfig = useAppConfig() as { workflowSlashCommands?: { enabled?: boolean } };
    const assertOriginWorkspace = () => {
        if (getDb() !== activationDb || getWorkspaceGeneration() !== activationGeneration || signal?.aborted)
            throw new Error('Workflow workspace changed');
    };
    const captureWrite = (threadId: string, operationSignal?: AbortSignal) => {
        assertOriginWorkspace();
        const scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
            threadId, messageId: null, requestId: crypto.randomUUID(), callId: crypto.randomUUID(),
            abortSignal: signal && operationSignal ? AbortSignal.any([signal, operationSignal])
                : operationSignal ?? signal ?? new AbortController().signal });
        scope.assertCurrent('write');
        return scope;
    };
    const workflowClient = (key: string, input?: WorkflowRequestOrigin) => {
        // Old installed artifacts lack an origin, never inferred from the active
        // pane. Transition: without a run identity no project chat can be fenced,
        // so they run only in workspaces that have no projects.
        const origin = input && { ...input };
        const scope = origin?.threadId && origin.messageId ? captureWrite(origin.threadId) : null;
        const httpClient = new HTTPClient({ fetcher: async (request, init) => {
            if (!origin?.messageId || !scope) {
                assertOriginWorkspace();
                if (await activationDb.projects.filter(project => !project.deleted).count())
                    throw new Error('Workflow request origin is required in workspaces with projects. Update the Workflows package.');
                warnLegacyWorkflowOrigin();
                assertOriginWorkspace();
                return fetch(request, init);
            }
            await scope.db.transaction('r', ['messages', 'threads', 'projects'], async () => {
                scope.assertCurrent('write');
                const [row, thread] = await Promise.all([scope.db.messages.get(origin.messageId), scope.db.threads.get(origin.threadId)]);
                if (!row || row.deleted || !isWorkflowMessageData(row.data) || row.thread_id !== origin.threadId
                    || row.stream_id !== origin.streamId || !thread || thread.deleted)
                    throw new Error('The originating workflow message is no longer available.');
                if (await resolveChatProject(scope.db, origin.threadId))
                    throw new Error('This workflow cannot capture project context. Use a normal project chat.');
                scope.assertCurrent('write');
            });
            scope.assertCurrent('write');
            return fetch(request, init);
        } });
        return createOpenRouterClient({ apiKey: key, httpClient });
    };
    const scopedRecords = createScopedRecordStore(activationDb, {
        postType: 'workflow-entry', messageType: 'workflow-execution',
    }, assertOriginWorkspace);
    const records = { ...scopedRecords, messages: {
        ...scopedRecords.messages,
        async updateData(input: Parameters<typeof scopedRecords.messages.updateData>[0]) {
            const updates = structuredClone(input);
            const scope = captureWrite('workflow-records');
            await activationDb.transaction('rw', getWriteTxTableNames(activationDb, ['messages', 'threads', 'projects']), async () => {
                scope.assertCurrent('write');
                for (const update of updates) {
                    const row = await activationDb.messages.get(update.id);
                    if (!row || row.deleted || !isWorkflowMessageData(row.data) || row.clock !== update.ifClock
                        || JSON.stringify(row.data) !== JSON.stringify(update.ifData)) continue;
                    if (await resolveChatProject(activationDb, row.thread_id))
                        throw new Error('This workflow cannot capture project context. Use a normal project chat.');
                }
                scope.assertCurrent('write');
                await scopedRecords.messages.updateData(updates);
                scope.assertCurrent('write');
            });
        },
    } };
    const legacyRecords = createLegacyWorkflowRecordAccess(records);

    return {
        workflowFeatures,
        workflowSlashEnabled: appConfig.workflowSlashCommands?.enabled !== false,
        records,
        // Retain the old private contract until existing artifacts are upgraded.
        searchWorkflows: legacyRecords.searchWorkflows,
        reconcileInterruptedRuns: legacyRecords.reconcileInterruptedRuns,
        ports: {
            uiComponents: {
                UBadge, UButton, UDropdownMenu, UFieldGroup, UIcon, UInput,
                UModal, UPopover, UTabs, UTextarea, UTooltip,
            },
            useIcon,
            useToast,
            useOr3Config,
            useResponsiveState,
            useSidebarMultiPane,
            useSidebarPostsApi,
            getPostsApi,
            useToolRegistry,
            usePostsList,
            useActiveSidebarPage,
            getGlobalMultiPaneApi,
            clearWorkflowPanes() {
                const api = getGlobalMultiPaneApi();
                if (!api) return;
                api.panes.value.forEach((pane, index) => {
                    if (pane.mode !== 'or3-workflows') return;
                    api.updatePane(index, {
                        mode: 'chat', threadId: '', documentId: undefined,
                        pendingThreadId: undefined, messages: [], validating: false,
                    });
                });
            },
            getGlobalSidebarLayoutApi,
            getWorkspaceResourceNavigationApi,
            closeSidebarIfMobile,
            programmaticPrefill,
            parseHashes,
            useThemeOverrides,
            theme: nuxtApp.$theme,
            workflowSlash: nuxtApp.$workflowSlash,
            messageAttachmentsGallery: MessageAttachmentsGallery,
            streamMarkdown: StreamMarkdown,
            useShikiHighlighter,
        },
        modelSource: {
            getFavorites: () => modelStore.getFavoriteModels(),
            subscribe(listener: (models: typeof modelStore.favoriteModels.value) => void) {
                return watch(modelStore.favoriteModels, listener, { deep: true });
            },
        },
        sendPorts: {
            getWorkflowById: legacyRecords.getWorkflowById,
            getWorkflowByName: legacyRecords.getWorkflowByName,
            listWorkflowNames: legacyRecords.listWorkflowNames,
            getMessage: legacyRecords.getMessage,
            getApiKey: () => apiKey.value || null,
            requestApiKeyLogin: () => window.dispatchEvent(new CustomEvent('openrouter:login')),
            async upsertWorkflowMessage(input: {
                id: string; threadId: string; streamId: string; data: unknown; pending: boolean;
            }) {
                input = { ...input, data: structuredClone(input.data) };
                if (!isWorkflowMessageData(input.data)) throw new Error('Invalid workflow message data.');
                const scope = captureWrite(input.threadId);
                const db = scope.db;
                await db.transaction('rw', getWriteTxTableNames(db, ['messages', 'threads', 'projects']), async () => {
                    scope.assertCurrent('write');
                    if (await resolveChatProject(db, input.threadId))
                        throw new Error('This workflow cannot capture project context. Use a normal project chat.');
                    const previous = await db.messages.get(input.id);
                    if (previous && (previous.deleted || previous.thread_id !== input.threadId
                        || previous.stream_id !== input.streamId || !isWorkflowMessageData(previous.data)))
                        throw new Error('The workflow message identity changed.');
                    scope.assertCurrent('write');
                    const timestamp = nowSec();
                    await db.messages.put(previous ? {
                        ...previous,
                        data: input.data as Message['data'],
                        pending: input.pending,
                        updated_at: timestamp,
                        clock: nextClock(previous.clock),
                    } : {
                        id: input.id,
                        role: 'assistant',
                        data: input.data as Message['data'],
                        pending: input.pending,
                        created_at: timestamp,
                        updated_at: timestamp,
                        error: null,
                        deleted: false,
                        thread_id: input.threadId,
                        index: Date.now(),
                        clock: nextClock(),
                        stream_id: input.streamId,
                        file_hashes: null,
                    });
                    scope.assertCurrent('write');
                });
            },
            markChatSendHandled,
            emitWorkflowState: (messageId: string, state: unknown) => {
                void hooks.doAction('workflow.execution:action:state_update', { messageId, state });
            },
            emitNodeComplete: (messageId: string, nodeId: string) => {
                void hooks.doAction('workflow.execution:action:node_complete', { messageId, nodeId });
            },
            emitRunStart: (messageId: string, workflowId: string) =>
                hooks.doAction('workflow.execution:action:start', { messageId, workflowId }),
            emitRunComplete: (messageId: string, workflowId: string, finalOutput: string) =>
                hooks.doAction('workflow.execution:action:complete', { messageId, workflowId, finalOutput }),
            canStartBackground() {
                return runtimeConfig.public.backgroundStreaming.enabled === true &&
                    isBackgroundStreamingEnabled(true) &&
                    Boolean(session.data.value?.session?.authenticated && session.data.value.session.user?.id);
            },
            getModelCatalog: () => modelStore.catalog.value,
            async startBackground(input: Record<string, unknown>) {
                const response = await fetch('/api/plugins/or3-workflows/workflows/background', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-or3-openrouter-key': String(input.apiKey || '') },
                    credentials: 'include',
                    body: JSON.stringify(input),
                });
                if (!response.ok) throw new Error(`Background workflow admission failed (${response.status})`);
                const result: unknown = await response.json();
                if (!result || typeof result !== 'object' || !('jobId' in result) || typeof result.jobId !== 'string') {
                    throw new Error('Invalid background workflow response');
                }
                return { jobId: result.jobId };
            },
            trackBackground(jobId: string, threadId: string, messageId: string) {
                ensureBackgroundJobTracker({
                    jobId,
                    userId: session.data.value?.session?.user?.id || '',
                    threadId,
                    messageId,
                    originDb: activationDb,
                    initialContent: '',
                    useSse: true,
                });
            },
            abortBackground: abortBackgroundJob,
            async backgroundStatus(jobId: string) {
                try { return (await pollJobStatus(jobId)).status; }
                catch { return 'missing' as const; }
            },
            async loadModelCatalog() {
                if (modelStore.catalog.value.length) return modelStore.catalog.value;
                try { return await modelStore.fetchModels({ ttlMs: 60 * 60 * 1000 }); }
                catch { return []; }
            },
            async completeCaption(input: { modelId: string; apiKey: string; imageUrls: string[]; origin?: WorkflowRequestOrigin }) {
                const result = await workflowClient(input.apiKey, input.origin).chat.send(
                    wrapLegacyChatSendArgs({
                        model: input.modelId,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Provide a concise, plain-text description of the image(s) for downstream text-only models.' },
                                ...input.imageUrls.map((url) => ({ type: 'image_url' as const, imageUrl: { url } })),
                            ],
                        }],
                        stream: false as const,
                    })
                );
                const content: unknown = (result as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
                if (typeof content === 'string') return content;
                if (!Array.isArray(content)) return null;
                return content.map((part: unknown) => part && typeof part === 'object' && 'text' in part &&
                    typeof part.text === 'string' ? part.text : '').join('').trim() || null;
            },
            async respondBackgroundHitl(requestId: string, jobId: string, response: { action: string; data?: unknown }) {
                const result = await fetch('/api/plugins/or3-workflows/workflows/hitl', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ requestId, jobId, action: response.action, data: response.data }),
                });
                return result.ok;
            },
            reportError: (error: unknown, message: string) => reportError(error, { code: 'ERR_INTERNAL', message, toast: true }),
            notify: (message: string, kind: 'info' | 'warning' | 'error') => toast.add({ title: message, color: kind }),
        },
        activity: {
            store: legacyRecords.activityStore,
            updates: {
                subscribe(listener: (messageId: string, state: WorkflowMessageData) => void) {
                    return hooks.on('workflow.execution:action:state_update', ({ messageId, state }) => {
                        if (isWorkflowMessageData(state)) listener(messageId, state);
                    });
                },
            },
        },
        executionPorts: {
            listWorkflowsWithMeta: legacyRecords.listWorkflowsWithMeta,
            loadConversationHistory: async (...args: Parameters<typeof legacyRecords.loadConversationHistory>) => {
                const { resolveChatProject } = await import('~/db/project-workspace');
                if (await resolveChatProject(activationDb, args[0])) throw new Error('This workflow cannot capture project context.');
                return legacyRecords.loadConversationHistory(...args);
            },
            toolRegistry: useToolRegistry,
            createOpenRouterClient: (apiKey: string, origin?: WorkflowRequestOrigin) => ({
                client: workflowClient(apiKey, origin),
                headers: DEFAULT_HEADERS,
                apiKey,
                metadata: 'disabled' as const,
            }),
            persistGeneratedImage: async (messageId: string, dataUrl: string, operationSignal?: AbortSignal) => {
                assertOriginWorkspace();
                const original = await activationDb.messages.get(messageId);
                assertOriginWorkspace();
                if (!original || original.deleted || !isWorkflowMessageData(original.data))
                    throw new Error('The workflow message is no longer available.');
                const scope = captureWrite(original.thread_id, operationSignal);
                if (await resolveChatProject(scope.db, original.thread_id))
                    throw new Error('This workflow cannot capture project context. Use a normal project chat.');
                scope.assertCurrent('write');
                return persistGeneratedImage(scope, original, dataUrl);
            },
        },
    };
}
