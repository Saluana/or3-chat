import { ref, computed, watch, onScopeDispose } from 'vue';
import { useToast, useAppConfig, useRuntimeConfig } from '#imports';
import { nowSec, newId } from '~/db/util';
import { create, tx, upsert, type Message } from '~/db';
import { getDb } from '~/db/client';
import { createOrRefFile } from '~/db/files';
import {
    serializeFileHashes,
    MAX_MESSAGE_FILE_HASHES,
} from '~/db/files-util';
import { normalizeFileUrl, hashToContentPart } from '~/utils/chat/useAi-internal/files';
import {
    parseHashes,
    mergeAssistantFileHashes,
} from '~/utils/files/attachments';
import { getThreadSystemPrompt } from '~/db/threads';
import { messagesByThread } from '~/db/messages';
import { getPrompt } from '~/db/prompts';
import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    ToolCall,
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    deriveMessageContent,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import {
    openRouterStream,
    pollJobStatus,
    startBackgroundStream,
    subscribeBackgroundJobStream,
    abortBackgroundJob,
    isBackgroundStreamingEnabled,
    type BackgroundJobStatus,
} from '../../utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import {
    promptJsonToString,
    composeSystemPrompt,
} from '~/utils/chat/prompt-utils';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { resolveDefaultModel } from '~/core/auth/models-service';
import { state } from '~/state/global';
// Import paths aligned with tests' vi.mock targets
import { useUserApiKey } from '#imports';
import { useActivePrompt } from '#imports';
import { getDefaultPromptId } from '#imports';
import { useHooks } from '#imports';
import { consumeWorkflowHandlingFlag } from '~/plugins/workflow-slash-commands.client';
import { NotificationService } from '~/core/notifications/notification-service';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { retryMessageImpl, continueMessageImpl } from '~/utils/chat/useAi-internal';
// settings/model store are provided elsewhere at runtime; keep dynamic access guards
import type {
    ChatSettings,
    ModelInfo,
    PaneContext,
    ExtendedSendMessageParams,
    ModelInputMessage,
} from '../../../types/chat-internal';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { ORMessage } from '~/core/auth/openrouter-build';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import {
    BACKGROUND_JOB_POLL_INTERVAL_MS,
    BACKGROUND_JOB_POLL_INTERVAL_ACTIVE_MS,
    BACKGROUND_JOB_PERSIST_INTERVAL_MS,
    BACKGROUND_JOB_MUTED_KEY,
    type BackgroundJobUpdate,
    type BackgroundJobSubscriber,
    type BackgroundJobTracker,
    backgroundJobTrackers,
    primeBackgroundJobUpdate,
    stopBackgroundJobTracking,
    ensureBackgroundJobTracker,
    subscribeBackgroundJob
} from '~/utils/chat/useAi-internal';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

type GlobalWithPaneApi = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
};

type StoredMessage = Message & {
    data?: {
        content?: string;
        reasoning_text?: string | null;
        tool_calls?: ToolCallInfo[] | null;
        background_job_id?: string;
        background_job_status?: BackgroundJobStatus['status'];
        background_job_error?: string | null;
        [key: string]: unknown;
    } | null;
    content?: string | ContentPart[];
    file_hashes?: string | null;
    reasoning_text?: string | null;
    stream_id?: string | null;
};

type OpenRouterMessage =
    | ORMessage
    | {
          role: 'tool';
          [key: string]: unknown;
      };

// Per-instance streaming tail state

export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    // Messages and basic state
    const messages = ref<UiChatMessage[]>(msgs.map((m) => ensureUiMessage(m)));
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const abortController = ref<AbortController | null>(null);
    const aborted = ref<boolean>(false);
    const { apiKey, setKey } = useUserApiKey();
    const runtimeConfig = useRuntimeConfig();
    const sessionContext =
        runtimeConfig.public.ssrAuthEnabled === true ? useSessionContext() : null;
    const notificationUserId = computed(() =>
        resolveNotificationUserId(sessionContext?.data.value?.session)
    );
    const openRouterConfig = computed(() => runtimeConfig.public.openRouter);
    const requireUserKey = computed(
        () => openRouterConfig.value.requireUserKey === true
    );
    const allowUserOverride = computed(
        () =>
            openRouterConfig.value.allowUserOverride !== false ||
            requireUserKey.value
    );
    const hasInstanceKey = computed(
        () =>
            openRouterConfig.value.hasInstanceKey === true &&
            !requireUserKey.value
    );
    const effectiveApiKey = computed(() =>
        allowUserOverride.value ? apiKey.value : null
    );
    const guestAccessEnabled = computed(
        () => runtimeConfig.public.guestAccessEnabled === true
    );
    const limitsConfig = computed(() => runtimeConfig.public.limits);
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);
    const cleanupFns: Array<() => void> = [];

    watch(
        () => notificationUserId.value,
        (nextUserId) => {
            if (!nextUserId) return;
            for (const tracker of backgroundJobTrackers.values()) {
                tracker.userId = nextUserId;
            }
        },
        { immediate: true }
    );

    if (import.meta.dev) {
        if (state.value.openrouterKey && apiKey.value) {
            setKey(state.value.openrouterKey);
        }
    }

    const streamAcc = createStreamAccumulator();
    const streamState = streamAcc.state;
    const streamId = ref<string | undefined>(undefined);
    const backgroundJobId = ref<string | null>(null);
    const backgroundJobMode = ref<'none' | 'background'>('none');
    const backgroundJobInfo = ref<{
        jobId: string;
        threadId: string;
        messageId: string;
    } | null>(null);
    const backgroundJobDisposers: Array<() => void> = [];
    const attachedBackgroundJobs = new Set<string>();
    const detached = ref<boolean>(false);
    const isDetached = () => detached.value;
    function resetStream() {
        streamAcc.reset();
        streamId.value = undefined;
    }

    const backgroundStreamingConfig = computed(() =>
        (runtimeConfig.public as { backgroundStreaming?: { enabled?: boolean } })
            .backgroundStreaming
    );
    const backgroundStreamingAllowed = computed(
        () => {
            if (runtimeConfig.public.ssrAuthEnabled !== true) return false;
            if (backgroundStreamingConfig.value?.enabled !== true) return false;
            if (!isBackgroundStreamingEnabled()) return false;
            const session = sessionContext?.data.value?.session;
            return Boolean(session?.authenticated && session?.workspace?.id);
        }
    );

    async function enforceClientLimits(isNewThread: boolean): Promise<boolean> {
        const limits = limitsConfig.value;
        if (limits.enabled === false) return true;

        const toast = useToast();

        const maxConversations =
            typeof limits.maxConversations === 'number'
                ? limits.maxConversations
                : 0;
        if (isNewThread && maxConversations > 0) {
            const threadCount = await getDb().threads
                .filter((thread) => thread.deleted !== true)
                .count();
            if (threadCount >= maxConversations) {
                toast.add({
                    title: 'Conversation limit reached',
                    description:
                        'You have reached the maximum number of conversations allowed for this instance.',
                    color: 'warning',
                    duration: 4000,
                });
                return false;
            }
        }

        const maxMessagesPerDay =
            typeof limits.maxMessagesPerDay === 'number'
                ? limits.maxMessagesPerDay
                : 0;
        if (maxMessagesPerDay > 0) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const startOfDaySec = Math.floor(startOfDay.getTime() / 1000);
            const messageCount = await getDb().messages
                .where('created_at')
                .aboveOrEqual(startOfDaySec)
                .and((msg) => msg.deleted !== true)
                .count();
            if (messageCount >= maxMessagesPerDay) {
                toast.add({
                    title: 'Daily message limit reached',
                    description:
                        'You have reached the maximum messages per day for this instance.',
                    color: 'warning',
                    duration: 4000,
                });
                return false;
            }
        }

        return true;
    }

    async function getSystemPromptContent(): Promise<string | null> {
        if (!threadIdRef.value) return null;
        try {
            const promptId = await getThreadSystemPrompt(threadIdRef.value);
            if (promptId) {
                const prompt = await getPrompt(promptId);
                if (prompt) return promptJsonToString(prompt.content);
            }
        } catch (e) {
            console.warn('Failed to load thread system prompt', e);
        }
        return activePromptContent.value
            ? promptJsonToString(
                  activePromptContent.value as Parameters<
                      typeof promptJsonToString
                  >[0]
              )
            : null;
    }

    // Helpers to reduce duplication and improve clarity/perf
    function getActivePaneContext(): PaneContext | null {
        try {
            const mpApi = (globalThis as GlobalWithPaneApi).__or3MultiPaneApi;
            if (!mpApi?.panes.value) return null;
            const pane = mpApi.panes.value.find(
                (p) => p.mode === 'chat' && p.threadId === threadIdRef.value
            );
            if (!pane) return null;
            const paneIndex = mpApi.panes.value.indexOf(pane);
            return { mpApi, pane, paneIndex };
        } catch {
            return null;
        }
    }

    async function updateMessageRecord(
        id: string,
        patch: Partial<StoredMessage>,
        existing?: StoredMessage | null
    ): Promise<void> {
        const base =
            existing ??
            ((await getDb().messages.get(id)) as StoredMessage | undefined);
        if (!base) return;

        // If error is being updated, also update data.error for reliable sync
        // (data uses v.any() and syncs reliably; top-level error may not)
        let finalPatch = patch;
        if ('error' in patch) {
            const baseData = base.data && typeof base.data === 'object'
                ? (base.data as Record<string, unknown>)
                : {};
            const patchData = patch.data && typeof patch.data === 'object'
                ? (patch.data as Record<string, unknown>)
                : {};
            finalPatch = {
                ...patch,
                data: {
                    ...baseData,
                    ...patchData,
                    error: patch.error, // Sync error to data.error
                },
            };
        }

        await upsert.message({
            ...base,
            ...finalPatch,
            updated_at: finalPatch.updated_at ?? nowSec(),
        });
    }

    function makeAssistantPersister(
        assistantDbMsg: StoredMessage,
        assistantFileHashes: string[]
    ) {
        // Cache last serialized file hashes to avoid recomputing on each write
        let lastSerialized: string | null = assistantDbMsg.file_hashes || null;
        return async function persist({
            content,
            reasoning,
            toolCalls,
            finalize = false, // When true, clears pending flag to trigger sync
        }: {
            content?: string;
            reasoning?: string | null;
            toolCalls?: ToolCallInfo[] | null;
            finalize?: boolean;
        }) {
            const baseData =
                assistantDbMsg.data && typeof assistantDbMsg.data === 'object'
                    ? (assistantDbMsg.data as Record<string, unknown>)
                    : {};
            const serialized = assistantFileHashes.length
                ? serializeFileHashes(assistantFileHashes)
                : lastSerialized;
            if (
                serialized !== lastSerialized ||
                content != null ||
                reasoning != null ||
                toolCalls != null ||
                finalize
            ) {
                const payload: StoredMessage = {
                    ...assistantDbMsg,
                    pending: finalize ? false : assistantDbMsg.pending, // Clear pending on finalize
                    data: {
                        ...baseData,
                        content:
                            content ??
                            (typeof baseData.content === 'string'
                                ? baseData.content
                                : ''),
                        reasoning_text:
                            reasoning ??
                            (typeof baseData.reasoning_text === 'string'
                                ? baseData.reasoning_text
                                : null),
                        ...(toolCalls
                            ? {
                                  tool_calls: toolCalls.map((t) => ({ ...t })),
                              }
                            : {}),
                    },
                    file_hashes: serialized,
                    updated_at: nowSec(),
                };
                await upsert.message(payload);
                lastSerialized = serialized ?? null;
            }
            return lastSerialized;
        };
    }

    function shouldKeepAssistantMessage(m: ChatMessage): boolean {
        if (m.role !== 'assistant') return true;
        const c = m.content;
        if (typeof c === 'string') return c.trim().length > 0;
        if (Array.isArray(c)) {
            return c.some((p) => {
                if (p.type === 'text') return p.text.trim().length > 0;
                // image and file parts are always considered non-empty
                return true;
            });
        }
        return true;
    }

    async function applyWorkflowResultToMessages(
        messageId: string,
        finalOutput: string
    ) {
        if (!messageId || !finalOutput) return;
        let updated = false;

        const rawIdx = rawMessages.value.findIndex((m) => m.id === messageId);
        const existingRaw = rawIdx !== -1 ? rawMessages.value[rawIdx] : null;
        if (existingRaw) {
            const next: ChatMessage = {
                ...existingRaw,
                role: existingRaw.role,
                content: finalOutput,
            };
            rawMessages.value.splice(rawIdx, 1, next);
            updated = true;
        }

        const uiIdx = messages.value.findIndex((m) => m.id === messageId);
        const existingUi = uiIdx !== -1 ? messages.value[uiIdx] : null;
        if (existingUi) {
            const next: UiChatMessage = { ...existingUi, text: finalOutput };
            messages.value.splice(uiIdx, 1, next);
            updated = true;
        }

        if (!updated && threadIdRef.value) {
            try {
                const row = await getDb().messages.get(messageId);
                if (row && row.thread_id === threadIdRef.value) {
                    const data =
                        (row.data as Record<string, unknown> | null) || null;
                    const content =
                        deriveMessageContent({
                            content: (
                                row as {
                                    content?: string | ContentPart[] | null;
                                }
                            ).content,
                            data,
                        }) || finalOutput;
                    const chatMsg: ChatMessage = {
                        role: row.role as ChatMessage['role'],
                        content,
                        id: row.id,
                        stream_id: row.stream_id ?? undefined,
                        file_hashes: row.file_hashes ?? undefined,
                        reasoning_text:
                            data &&
                            typeof data === 'object' &&
                            typeof (data as { reasoning_text?: unknown })
                                .reasoning_text === 'string'
                                ? (data as { reasoning_text: string })
                                      .reasoning_text
                                : null,
                        data: data || null,
                        index:
                            typeof row.index === 'number'
                                ? row.index
                                : typeof row.index === 'string'
                                ? Number(row.index) || null
                                : null,
                        created_at:
                            typeof row.created_at === 'number'
                                ? row.created_at
                                : null,
                    };
                    rawMessages.value.push(chatMsg);
                    messages.value.push(
                        ensureUiMessage({
                            ...chatMsg,
                            data,
                        })
                    );
                }
            } catch {
                /* intentionally empty */
            }
        }
    }

    cleanupFns.push(
        hooks.on(
            'workflow.execution:action:state_update',
            (payload: {
                messageId: string;
                state?: { executionState?: string; finalOutput?: string };
            }) => {
                const state = payload.state || {};
                const executionState = state.executionState;
                const isDone =
                    executionState &&
                    executionState !== 'running' &&
                    executionState !== 'idle';
                const finalOutput =
                    typeof state.finalOutput === 'string'
                        ? state.finalOutput
                        : '';
                if (!isDone || !finalOutput) return;
                void applyWorkflowResultToMessages(
                    payload.messageId,
                    finalOutput
                );
            }
        )
    );

    let historySyncInFlight = false;
    async function ensureHistorySynced() {
        if (historySyncInFlight) return;
        if (threadIdRef.value && historyLoadedFor.value !== threadIdRef.value) {
            historySyncInFlight = true;
            try {
                if (detached.value) detached.value = false;
                const { ensureThreadHistoryLoaded } = await import(
                    '~/utils/chat/history'
                );
                await ensureThreadHistoryLoaded(
                    threadIdRef,
                    historyLoadedFor,
                    rawMessages
                );
                messages.value = rawMessages.value
                    .filter((m: ChatMessage) => m.role !== 'tool')
                    .map((m) => ensureUiMessage(m));
                await reattachBackgroundJobs();
            } finally {
                historySyncInFlight = false;
            }
        }
    }

    const tailAssistant = ref<UiChatMessage | null>(null);
    let lastSuppressedAssistantId: string | null = null;
    function flushTailAssistant() {
        const tail = tailAssistant.value;
        if (!tail) return;
        if (!messages.value.find((m) => m.id === tail.id)) {
            messages.value.push(tail);
        }
        tailAssistant.value = null;
    }

    function resolveUiMessage(messageId: string): UiChatMessage | null {
        if (tailAssistant.value?.id === messageId) return tailAssistant.value;
        return messages.value.find((m) => m.id === messageId) ?? null;
    }

    function clearBackgroundJobSubscriptions(options?: {
        keepTracking?: boolean;
    }): void {
        if (!backgroundJobDisposers.length) return;
        for (const jobId of attachedBackgroundJobs) {
            const tracker = backgroundJobTrackers.get(jobId);
            if (tracker && !options?.keepTracking) {
                stopBackgroundJobTracking(tracker);
            }
        }
        for (const dispose of backgroundJobDisposers.splice(0, backgroundJobDisposers.length)) {
            try {
                dispose();
            } catch {
                /* intentionally empty */
            }
        }
        attachedBackgroundJobs.clear();
    }

    function attachBackgroundJobToUi(params: {
        jobId: string;
        userId: string;
        messageId: string;
        threadId: string;
        initialContent?: string;
        isReattach?: boolean;
        useSse?: boolean;
    }): BackgroundJobTracker {
        const tracker = ensureBackgroundJobTracker({
            jobId: params.jobId,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            // Seed with DB content - server must have MORE to update
            initialContent: params.initialContent,
            useSse: params.useSse,
        });
        if (params.isReattach && typeof params.initialContent === 'string') {
            // Set tracker baseline to DB content
            // Server must have MORE content to trigger an update
            if (params.initialContent.length > tracker.lastContent.length) {
                tracker.lastContent = params.initialContent;
                tracker.lastPersistedLength = params.initialContent.length;
            }
            tracker.lastPersistAt = 0;
            // Sync UI with DB content (don't clear it)
            const target = resolveUiMessage(params.messageId);
            if (target && params.initialContent.length > target.text.length) {
                target.text = params.initialContent;
            }
        }
        if (params.isReattach && tailAssistant.value?.id === params.messageId) {
            // Seed stream accumulator with current content
            streamAcc.reset();
            if (params.initialContent) {
                streamAcc.append(params.initialContent, { kind: 'text' });
            }
        }
        if (!attachedBackgroundJobs.has(params.jobId)) {
            const subscriber: BackgroundJobSubscriber = {
                onUpdate: ({ content, delta }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    const currentLen = target.text.length;
                    // Only update if server has MORE content than current UI
                    if (content.length < currentLen) {
                        return;
                    }
                    if (target.pending && delta) target.pending = false;
                    target.text = content;
                    if (tailAssistant.value?.id === params.messageId) {
                        // Replace accumulator with full content
                        streamAcc.reset();
                        streamAcc.append(content, { kind: 'text' });
                    } else if (delta) {
                        messages.value = [...messages.value];
                    }
                },
                onComplete: ({ content }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.text = content;
                    target.pending = false;
                    if (tailAssistant.value?.id === params.messageId) {
                        // Ensure stream accumulator has full content before finalizing
                        streamAcc.reset();
                        if (content) {
                            streamAcc.append(content, { kind: 'text' });
                        }
                        streamAcc.finalize();
                    } else {
                        messages.value = [...messages.value];
                    }
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onError: ({ status }) => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.pending = false;
                    target.error = status.error || 'Background response failed';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({
                        error: new Error(target.error || 'Background response failed'),
                    });
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
                onAbort: () => {
                    if (detached.value) {
                        return;
                    }
                    const target = resolveUiMessage(params.messageId);
                    if (!target) return;
                    target.pending = false;
                    target.error = 'stopped';
                    if (tailAssistant.value?.id !== params.messageId) {
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({ aborted: true });
                    void updateMessageRecord(params.messageId, {
                        pending: false,
                        error: 'stopped',
                    });
                    if (backgroundJobId.value === params.jobId) {
                        loading.value = false;
                        backgroundJobId.value = null;
                        backgroundJobMode.value = 'none';
                        backgroundJobInfo.value = null;
                    }
                },
            };
            const unsubscribe = subscribeBackgroundJob(tracker, subscriber);
            attachedBackgroundJobs.add(params.jobId);
            backgroundJobDisposers.push(unsubscribe);
            if (params.isReattach && !tracker.polling && !tracker.streaming) {
                // Only prime if polling hasn't started yet
                void primeBackgroundJobUpdate(tracker);
            }
            // If polling is already running, resetting tracker.lastContent = ''
            // will cause next poll to fetch full content automatically
        }
        return tracker;
    }

    async function reattachBackgroundJobs(): Promise<void> {
        if (!backgroundStreamingAllowed.value || !threadIdRef.value) return;

        try {
            const dbMessages = (await messagesByThread(threadIdRef.value)) as
                | StoredMessage[]
                | undefined;
            const list = Array.isArray(dbMessages) ? dbMessages : [];
            for (const msg of list) {
                if (msg.role !== 'assistant' || !msg.pending || !msg.data) continue;
                const data = msg.data as Record<string, unknown>;
                const jobId =
                    typeof data.background_job_id === 'string'
                        ? data.background_job_id
                        : null;
                const status =
                    typeof data.background_job_status === 'string'
                        ? data.background_job_status
                        : 'streaming';
                if (!jobId || status !== 'streaming') continue;

                const initialContent =
                    typeof data.content === 'string'
                        ? data.content
                        : typeof msg.content === 'string'
                        ? msg.content
                        : '';

                attachBackgroundJobToUi({
                    jobId,
                    userId: notificationUserId.value,
                    messageId: msg.id,
                    threadId: threadIdRef.value,
                    initialContent,
                    isReattach: true,
                    useSse: backgroundStreamingAllowed.value,
                });

                if (!backgroundJobId.value) backgroundJobId.value = jobId;
                if (backgroundJobMode.value === 'none') {
                    backgroundJobMode.value = 'background';
                }
            }
        } catch {
            /* intentionally empty */
        }
    }

    async function sendMessage(
        contentOrParams: string | (SendMessageParams & { content: string }),
        maybeParams?: SendMessageParams
    ) {
        let content: string;
        let sendMessagesParams: SendMessageParams;

        if (typeof contentOrParams === 'string') {
            content = contentOrParams;
            sendMessagesParams = maybeParams || {
                files: [],
                model: DEFAULT_AI_MODEL,
                file_hashes: [],
                online: false,
                context_hashes: [],
            };
        } else {
            content = contentOrParams.content;
            sendMessagesParams = contentOrParams;
        }

        const hasKey =
            Boolean(effectiveApiKey.value) || hasInstanceKey.value;
        if (!hasKey) {
            if (allowUserOverride.value && guestAccessEnabled.value) {
                // Guest access enabled - trigger OpenRouter login
                const openrouter = useOpenRouterAuth();
                openrouter.startLogin();
            } else if (!allowUserOverride.value) {
                useToast().add({
                    title: 'Instance key required',
                    description:
                        'This deployment requires a managed OpenRouter key. Contact your administrator.',
                    color: 'warning',
                    duration: 4000,
                });
            } else {
                // allowUserOverride is true but guestAccessEnabled is false - no action
                // User must authenticate via SSR auth first
                useToast().add({
                    title: 'Sign in required',
                    description:
                        'Please sign in to continue chatting.',
                    color: 'info',
                    duration: 4000,
                });
            }
            return;
        }

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        if (
            !outgoing ||
            typeof outgoing !== 'string' ||
            outgoing.trim() === ''
        ) {
            useToast().add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                duration: 3000,
            });
            return;
        }

        const canSend = await enforceClientLimits(!threadIdRef.value);
        if (!canSend) return;

        if (!threadIdRef.value) {
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {
                    /* intentionally empty */
                }
            }
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
                        recommendedDefault: () => DEFAULT_AI_MODEL,
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
                        useToast().add({
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
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
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
        } // END create-new-thread block

        if (
            tailAssistant.value &&
            lastSuppressedAssistantId &&
            tailAssistant.value.id === lastSuppressedAssistantId
        ) {
            tailAssistant.value = null;
            lastSuppressedAssistantId = null;
        } else {
            flushTailAssistant();
            lastSuppressedAssistantId = null; // clear in normal path too
        }

        const prevAssistantRaw = [...rawMessages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        const prevAssistant = prevAssistantRaw
            ? messages.value.find((m) => m.id === prevAssistantRaw.id)
            : null;
        const assistantHashes = prevAssistantRaw?.file_hashes
            ? parseHashes(prevAssistantRaw.file_hashes)
            : [];

        streamAcc.reset();
        let { files, model, file_hashes } = sendMessagesParams;
        const { extraTextParts, online, context_hashes } = sendMessagesParams;
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
        if (!model) model = DEFAULT_AI_MODEL;
        if (online === true) model = model + ':online';

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);

        // Helper: convert a Blob to a data URL (used only for API preparation)
        const blobToDataUrl = (blob: Blob): Promise<string> =>
            new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onerror = () =>
                    reject(fr.error ?? new Error('FileReader error'));
                fr.onload = () => resolve(fr.result as string);
                fr.readAsDataURL(blob);
            });

        // Verify files exist (no Base64 conversion - that happens in buildOpenRouterMessages)
        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );

        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes: file_hashes.length
                ? serializeFileHashes(file_hashes)
                : undefined,
        });
        const parts: ContentPart[] = buildParts(
            outgoing,
            hydratedFiles,
            extraTextParts
        );
        const rawUser: ChatMessage = {
            role: 'user',
            content: parts,
            id: userDbMsg.id,
            file_hashes: userDbMsg.file_hashes,
        };
        recordRawMessage(rawUser);
        rawMessages.value.push(rawUser);
        messages.value.push(ensureUiMessage(rawUser));

        try {
            const ctx = getActivePaneContext();
            if (ctx) {
                void hooks.doAction('ui.pane.msg:action:sent', {
                    pane: ctx.pane,
                    paneIndex: ctx.paneIndex,
                    message: {
                        id: userDbMsg.id,
                        threadId: threadIdRef.value,
                        length: outgoing.length,
                        fileHashes: userDbMsg.file_hashes || null,
                    },
                });
            }
        } catch (e) {
            if (import.meta.dev) {
                console.warn('[useChat] pane hook failed', e);
            }
        }

        loading.value = true;
        streamId.value = undefined;
        backgroundJobId.value = null;
        detached.value = false;

        let currentModelId: string | undefined;
        try {
            const startedAt = Date.now();
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );
            currentModelId = modelId;

            const messagesWithSystemRaw = [...rawMessages.value];
            const threadSystemText = await getSystemPromptContent();
            let finalSystem: string | null = null;
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const master = settingsValue?.masterSystemPrompt ?? '';
                finalSystem = composeSystemPrompt(
                    master,
                    threadSystemText || null
                );
            } catch {
                finalSystem = (threadSystemText || '').trim() || null;
            }
            if (finalSystem && finalSystem.trim()) {
                messagesWithSystemRaw.unshift({
                    role: 'system',
                    content: finalSystem,
                    id: `system-${newId()}`,
                });
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystemRaw
            );

            // Remove prior empty assistant placeholder messages
            const sanitizedEffectiveMessages = (
                Array.isArray(effectiveMessages) ? effectiveMessages : []
            ).filter(shouldKeepAssistantMessage);

            const isModelMessage = (
                m: ChatMessage
            ): m is ChatMessage & { role: 'user' | 'assistant' | 'system' } =>
                m.role !== 'tool';

            const { buildOpenRouterMessages } = await import(
                '~/core/auth/openrouter-build'
            );

            // Load thread history if not already loaded
            await ensureHistorySynced();

            const modelInputMessages: ModelInputMessage[] =
                sanitizedEffectiveMessages.filter(isModelMessage).map(
                    (m): ModelInputMessage => ({
                        role: m.role,
                        content: m.content,
                        id: m.id,
                        file_hashes: m.file_hashes,
                        name: m.name,
                        tool_call_id: m.tool_call_id,
                    })
                );
            if (assistantHashes.length && prevAssistant?.id) {
                const target = modelInputMessages.find(
                    (m) => m.id === prevAssistant.id
                );
                if (target) target.file_hashes = null;
            }
            const contextHashesList = Array.isArray(context_hashes)
                ? context_hashes.slice(0, MAX_MESSAGE_FILE_HASHES)
                : [];
            if (contextHashesList.length) {
                const seenContext = new Set<string>(
                    Array.isArray(file_hashes) ? file_hashes : []
                );
                const contextParts: ContentPart[] = [];
                for (const h of contextHashesList) {
                    if (!h || seenContext.has(h)) continue;
                    if (contextParts.length >= MAX_MESSAGE_FILE_HASHES) break;
                    const part = await hashToContentPart(h);
                    if (part) {
                        contextParts.push(part);
                        seenContext.add(h);
                    }
                }
                if (contextParts.length) {
                    const lastUserIdx = [...modelInputMessages]
                        .map((m, idx: number) => (m.role === 'user' ? idx : -1))
                        .filter((idx) => idx >= 0)
                        .pop();
                    if (lastUserIdx != null && lastUserIdx >= 0) {
                        const target = modelInputMessages[lastUserIdx];
                        if (target) {
                            if (!Array.isArray(target.content)) {
                                if (typeof target.content === 'string') {
                                    target.content = [
                                        { type: 'text', text: target.content },
                                    ];
                                } else {
                                    target.content = [];
                                }
                            }
                            target.content.push(...contextParts);
                        }
                    }
                }
            }
            let orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(
                modelInputMessages,
                {
                    maxImageInputs: 16,
                    imageInclusionPolicy: 'all',
                    debug: false,
                }
            );
            trimOrMessagesImages(
                orMessages as Parameters<typeof trimOrMessagesImages>[0],
                5
            );
            if (orMessages.length === 0) return;

            // modalities controls OUTPUT format, not input capability
            // Only request image output for actual image generation models
            const isImageGenerationModel = /dall-e|stable-diffusion|midjourney|imagen/i.test(modelId);
            const modalities = isImageGenerationModel ? ['image', 'text'] : ['text'];

            const newStreamId = newId();
            streamId.value = newStreamId;
            const assistantDbMsg = (await tx.appendMessage({
                thread_id: threadIdRef.value,
                role: 'assistant',
                stream_id: newStreamId,
                pending: true, // Mark as streaming - HookBridge will skip sync until finalized
                data: { content: '', attachments: [], reasoning_text: null },
            })) as StoredMessage;
            // Track file hashes across loop iterations
            const assistantFileHashes: string[] = [];
            const persistAssistant = makeAssistantPersister(
                assistantDbMsg,
                assistantFileHashes
            );

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? effectiveMessages.length
                    : undefined,
            });

            const toolRegistry = useToolRegistry();
            const enabledToolDefs = toolRegistry.getEnabledDefinitions();

            // Track tool calls across all loop iterations (persists state)
            const activeToolCalls = new Map<string, ToolCallInfo>();

            aborted.value = false;
            abortController.value = null;
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;

            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages }
            );

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

            // Check if a workflow is handling this request - skip AI call
            if (consumeWorkflowHandlingFlag()) {
                // Seed UI with assistant placeholder so workflow state can render immediately
                const workflowAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };
                recordRawMessage(workflowAssistant);
                rawMessages.value.push(workflowAssistant);
                const uiAssistant = ensureUiMessage(workflowAssistant);
                uiAssistant.pending = true;
                messages.value.push(uiAssistant);
                loading.value = false;
                abortController.value = null;
                return;
            }

            // Also skip if messages array is empty (e.g., workflow returned empty)
            if (orMessages.length === 0) {
                loading.value = false;
                return;
            }

            const allowBackgroundStreaming =
                backgroundStreamingAllowed.value &&
                enabledToolDefs.length === 0 &&
                modalities.length === 1 &&
                modalities[0] === 'text';

            if (allowBackgroundStreaming) {
                backgroundJobMode.value = 'background';

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                recordRawMessage(rawAssistant);
                rawMessages.value.push(rawAssistant);
                const uiAssistant = ensureUiMessage(rawAssistant);
                uiAssistant.pending = true;
                tailAssistant.value = uiAssistant;

                try {
                    const result = await startBackgroundStream({
                        apiKey: effectiveApiKey.value,
                        model: modelId,
                        orMessages: orMessages as Parameters<
                            typeof startBackgroundStream
                        >[0]['orMessages'],
                        modalities,
                        threadId: threadIdRef.value!,
                        messageId: assistantDbMsg.id,
                        tools:
                            enabledToolDefs.length > 0
                                ? enabledToolDefs
                                : undefined,
                    });

                    backgroundJobId.value = result.jobId;
                    backgroundJobInfo.value = {
                        jobId: result.jobId,
                        threadId: threadIdRef.value!,
                        messageId: assistantDbMsg.id,
                    };

                    if (assistantDbMsg.data && typeof assistantDbMsg.data === 'object') {
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
                    await updateMessageRecord(assistantDbMsg.id, {
                        data: {
                            background_job_id: result.jobId,
                            background_job_status: 'streaming',
                        },
                    });

                    const tracker = attachBackgroundJobToUi({
                        jobId: result.jobId,
                        userId: notificationUserId.value,
                        messageId: assistantDbMsg.id,
                        threadId: threadIdRef.value!,
                        initialContent: '',
                        useSse: backgroundStreamingAllowed.value,
                    });

                    await tracker.completion;
                } catch (error) {
                    const errMessage =
                        error instanceof Error
                            ? error.message
                            : 'Background stream failed';
                    const target = resolveUiMessage(assistantDbMsg.id);
                    if (target) {
                        target.pending = false;
                        target.error = errMessage;
                        messages.value = [...messages.value];
                    }
                    streamAcc.finalize({ error: new Error(errMessage) });
                    loading.value = false;
                    backgroundJobId.value = null;
                    backgroundJobMode.value = 'none';
                    backgroundJobInfo.value = null;
                }

                return;
            }

            abortController.value = new AbortController();

            let continueLoop = true;
            let loopIteration = 0;
            const MAX_TOOL_ITERATIONS = 10; // Prevent infinite loops

            while (continueLoop && loopIteration < MAX_TOOL_ITERATIONS) {
                continueLoop = false;
                loopIteration++;

                const stream = openRouterStream({
                    apiKey: effectiveApiKey.value,
                    model: modelId,
                    orMessages: orMessages as Parameters<
                        typeof openRouterStream
                    >[0]['orMessages'],
                    modalities,
                    tools:
                        enabledToolDefs.length > 0
                            ? enabledToolDefs
                            : undefined,
                    signal: abortController.value.signal,
                });

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                if (loopIteration === 1) {
                    recordRawMessage(rawAssistant);
                    rawMessages.value.push(rawAssistant);
                    const uiAssistant = ensureUiMessage(rawAssistant);
                    uiAssistant.pending = true;
                    tailAssistant.value = uiAssistant;
                }

                const current =
                    tailAssistant.value || ensureUiMessage(rawAssistant);
                let chunkIndex = 0;
                const WRITE_INTERVAL_MS = 500;
                let lastPersistAt = 0;
                const pendingToolCalls: ToolCall[] = [];

                try {
                    for await (const ev of stream) {
                        if (ev.type === 'tool_call') {
                            // Tool call detected - enqueue for execution after stream closes
                            if (current.pending) current.pending = false;

                            const toolCall = ev.tool_call;

                            // Add tool call to tracking with loading status
                            activeToolCalls.set(toolCall.id, {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                status: 'loading',
                                args: toolCall.function.arguments,
                            });

                            // Update UI with loading state
                            current.toolCalls = Array.from(
                                activeToolCalls.values()
                            );

                            // Persist current assistant state (function call request)
                            await persistAssistant({
                                content: current.text,
                                reasoning: current.reasoning_text ?? null,
                                toolCalls: current.toolCalls ?? undefined,
                            });

                            pendingToolCalls.push(toolCall);
                            continue;
                        } else if (ev.type === 'reasoning') {
                            if (current.reasoning_text === null)
                                current.reasoning_text = ev.text;
                            else current.reasoning_text += ev.text;
                            streamAcc.append(ev.text, { kind: 'reasoning' });
                            try {
                                await hooks.doAction(
                                    'ai.chat.stream:action:reasoning',
                                    ev.text,
                                    {
                                        threadId: threadIdRef.value,
                                        assistantId: assistantDbMsg.id,
                                        streamId: newStreamId,
                                        reasoningLength:
                                            current.reasoning_text?.length || 0,
                                    }
                                );
                            } catch {
                                /* intentionally empty */
                            }
                        } else if (ev.type === 'text') {
                            if (current.pending) current.pending = false;
                            const delta = ev.text;
                            streamAcc.append(delta, { kind: 'text' });
                            await hooks.doAction(
                                'ai.chat.stream:action:delta',
                                delta,
                                {
                                    threadId: threadIdRef.value,
                                    assistantId: assistantDbMsg.id,
                                    streamId: newStreamId,
                                    deltaLength: delta.length,
                                    totalLength:
                                        current.text.length + delta.length,
                                    chunkIndex: chunkIndex++,
                                }
                            );
                            current.text += delta;
                        } else if (ev.type === 'image') {
                            if (current.pending) current.pending = false;
                            // Store image first, then use hash placeholder (not Base64)
                            if (assistantFileHashes.length < 6) {
                                let blob: Blob | null = null;
                                if (ev.url.startsWith('data:image/'))
                                    blob = dataUrlToBlob(ev.url);
                                else if (/^https?:/.test(ev.url)) {
                                    try {
                                        // Use $fetch with responseType: 'blob'
                                        blob = await $fetch<Blob>(ev.url, {
                                            responseType: 'blob',
                                        });
                                    } catch {
                                        /* intentionally empty */
                                    }
                                }
                                if (blob) {
                                    try {
                                        const meta = await createOrRefFile(
                                            blob,
                                            'gen-image'
                                        );
                                        assistantFileHashes.push(meta.hash);
                                        // Use valid 1x1 transparent pixel and store hash in alt text to eliminate console errors
                                        const placeholder = `![file-hash:${meta.hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`;
                                        const already =
                                            current.text.includes(placeholder);
                                        if (!already) {
                                            current.text +=
                                                (current.text ? '\n\n' : '') +
                                                placeholder;
                                        }
                                        const serialized =
                                            await persistAssistant({
                                                content: current.text,
                                                reasoning:
                                                    current.reasoning_text ??
                                                    null,
                                            });
                                        current.file_hashes =
                                            serialized?.split(',') ?? [];
                                    } catch {
                                        /* intentionally empty */
                                    }
                                } else {
                                    // Fallback: couldn't convert to blob, use URL directly
                                    const placeholder = `![generated image](${ev.url})`;
                                    const already =
                                        current.text.includes(placeholder);
                                    if (!already) {
                                        current.text +=
                                            (current.text ? '\n\n' : '') +
                                            placeholder;
                                    }
                                }
                            }
                        }

                        // Batch writes: persist every 500ms OR every 50 chunks (whichever comes first)
                        // to reduce DB pressure while maintaining progress safety
                        const now = Date.now();
                        const shouldPersist =
                            now - lastPersistAt >= WRITE_INTERVAL_MS ||
                            chunkIndex % 50 === 0;
                        if (shouldPersist) {
                            await persistAssistant({
                                content: current.text,
                                reasoning: current.reasoning_text ?? null,
                            });
                            if (assistantFileHashes.length) {
                                current.file_hashes = assistantFileHashes;
                            }
                            lastPersistAt = now;
                        }
                    }

                    if (pendingToolCalls.length > 0) {
                        const toolResultsForNextLoop: Array<{
                            call: ToolCall;
                            result: string;
                        }> = [];

                        for (const toolCall of pendingToolCalls) {
                            const execution = await toolRegistry.executeTool(
                                toolCall.function.name,
                                toolCall.function.arguments
                            );

                            let toolResultText: string;
                            let toolStatus: 'complete' | 'error' = 'complete';
                            if (execution.error) {
                                toolStatus = 'error';
                                toolResultText = `Error executing tool "${toolCall.function.name}": ${execution.error}`;
                                console.warn('[useChat] tool execution error', {
                                    tool: toolCall.function.name,
                                    error: execution.error,
                                    timedOut: execution.timedOut,
                                });
                            } else {
                                toolResultText = execution.result || '';
                            }

                            activeToolCalls.set(toolCall.id, {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                status: toolStatus,
                                args: toolCall.function.arguments,
                                result:
                                    toolStatus === 'complete'
                                        ? toolResultText
                                        : undefined,
                                error:
                                    toolStatus === 'error'
                                        ? execution.error
                                        : undefined,
                            });
                            current.toolCalls = Array.from(
                                activeToolCalls.values()
                            );

                            const SUMMARY_THRESHOLD = 500;
                            let uiSummary = toolResultText;
                            if (toolResultText.length > SUMMARY_THRESHOLD) {
                                uiSummary = `Tool result (${Math.round(
                                    toolResultText.length / 1024
                                )}KB): ${toolResultText.slice(
                                    0,
                                    200
                                )}... [truncated for display]`;
                            }

                            await tx.appendMessage({
                                thread_id: threadIdRef.value,
                                role: 'tool',
                                data: {
                                    content: uiSummary,
                                    tool_call_id: toolCall.id,
                                    tool_name: toolCall.function.name,
                                },
                            });

                            toolResultsForNextLoop.push({
                                call: toolCall,
                                result: toolResultText,
                            });
                        }

                        orMessages.push({
                            role: 'assistant',
                            content: [
                                { type: 'text', text: current.text || '' },
                            ],
                            tool_calls: pendingToolCalls.map((toolCall) => ({
                                id: toolCall.id,
                                type: 'function' as const,
                                function: {
                                    name: toolCall.function.name,
                                    arguments: toolCall.function.arguments,
                                },
                            })),
                        });

                        for (const payload of toolResultsForNextLoop) {
                            orMessages.push({
                                role: 'tool',
                                tool_call_id: payload.call.id,
                                name: payload.call.function.name,
                                content: [
                                    { type: 'text', text: payload.result },
                                ],
                            });
                        }

                        pendingToolCalls.length = 0;
                        continueLoop = true;
                        continue;
                    }
                } catch (streamError) {
                    if (loopIteration > 1) {
                        console.warn(
                            '[useChat] Stream error during tool loop',
                            streamError
                        );
                        continueLoop = false;
                    }
                    throw streamError;
                }
            }

            const current = tailAssistant.value!;
            const fullText = current.text;
            const hookName = 'ui.chat.message:filter:incoming';
            const errorsBefore = hooks._diagnostics.errors[hookName] ?? 0;
            const incoming = await hooks.applyFilters(
                hookName,
                fullText,
                threadIdRef.value
            );
            const errorsAfter = hooks._diagnostics.errors[hookName] ?? 0;
            if (errorsAfter > errorsBefore) {
                throw new Error('Incoming filter threw an exception');
            }
            if (current.pending) current.pending = false;
            current.text = incoming;
            await persistAssistant({
                content: incoming,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                finalize: true, // Clear pending flag to trigger sync
            });
            const finalized: StoredMessage = {
                ...assistantDbMsg,
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : assistantDbMsg.file_hashes,
            };
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: threadIdRef.value,
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
                            threadId: threadIdRef.value,
                            length: incoming.length,
                            fileHashes: finalized.file_hashes || null,
                            reasoningLength: (current.reasoning_text || '')
                                .length,
                        },
                    });
                }
            } catch {
                /* intentionally empty */
            }
            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
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
            streamAcc.finalize();
            backgroundJobId.value = null;
            backgroundJobMode.value = 'none';
            backgroundJobInfo.value = null;
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                if (isDetached()) return;
            }
            if (aborted.value) {
                if (tailAssistant.value?.pending)
                    tailAssistant.value.pending = false;
                try {
                    await hooks.doAction('ai.chat.send:action:after', {
                        threadId: threadIdRef.value,
                        aborted: true,
                    });
                } catch (e) {
                    if (import.meta.dev) {
                        console.warn('[useChat] abort hook failed', e);
                    }
                }
                // Only delete if there's no text; otherwise preserve with 'stopped' status
                if (tailAssistant.value?.id && !tailAssistant.value.text) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch (e) {
                        if (import.meta.dev) {
                            console.warn(
                                '[useChat] failed to delete empty assistant',
                                e
                            );
                        }
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    // Preserve partial message with 'stopped' status for continue functionality
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stopped';

                    // Add to messages array if not already there (flush before nulling)
                    if (
                        !messages.value.find(
                            (m) => m.id === tailAssistant.value!.id
                        )
                    ) {
                        messages.value.push(tailAssistant.value);
                    } else {
                        // Update existing message in array
                        const msgIdx = messages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (msgIdx >= 0) {
                            messages.value[msgIdx] = { ...tailAssistant.value };
                        }
                    }

                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                content: tailAssistant.value.text,
                                error: 'stopped',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stopped', // Store in data for reliable sync
                                },
                                error: 'stopped', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                }
            } else {
                const lastUser = [...messages.value]
                    .reverse()
                    .find((m) => m.role === 'user');
                const retryFn = lastUser
                    ? () => {
                          void retryMessage(lastUser.id);
                      }
                    : undefined;
                // Inline tag object (Req 18.1) for clarity & tree-shaking
                reportError(err, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: threadIdRef.value || '',
                        streamId: streamId.value || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    retry: retryFn,
                    toast: true,
                    retryable: !!retryFn,
                });
                const e = err instanceof Error ? err : new Error(String(err));
                streamAcc.finalize({ error: e });
                await hooks.doAction('ai.chat.stream:action:error', {
                    threadId: threadIdRef.value,
                    streamId: streamId.value,
                    error: e,
                    aborted: false,
                });
                if (!tailAssistant.value?.text && tailAssistant.value?.id) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stream_interrupted';
                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                error: 'stream_interrupted',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stream_interrupted', // Store in data for reliable sync
                                },
                                error: 'stream_interrupted', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                } else if (tailAssistant.value?.pending) {
                    tailAssistant.value.pending = false;
                }
            }
        } finally {
            loading.value = false;
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (abortController.value) {
                abortController.value = null;
            }
            setTimeout(() => {
                if (!loading.value && streamState.finalized) resetStream();
            }, 0);
        }
    }

    // END sendMessage

    async function retryMessage(messageId: string, modelOverride?: string) {
        await retryMessageImpl(
            {
                loading,
                threadIdRef,
                tailAssistant,
                rawMessages,
                messages,
                hooks,
                sendMessage,
                defaultModelId: DEFAULT_AI_MODEL,
                suppressNextTailFlush: (assistantId: string) => {
                    lastSuppressedAssistantId = assistantId;
                },
            },
            messageId,
            modelOverride
        );
    }

    async function continueMessage(messageId: string, modelOverride?: string) {
        await continueMessageImpl(
            {
                loading,
                aborted,
                abortController,
                threadIdRef,
                tailAssistant,
                rawMessages,
                messages,
                streamId,
                streamAcc,
                streamState,
                hooks,
                effectiveApiKey,
                hasInstanceKey,
                defaultModelId: DEFAULT_AI_MODEL,
                getSystemPromptContent,
                useAiSettings,
                resetStream,
            },
            messageId,
            modelOverride
        );
    }

    function clear() {
        const disposeHooks = () => {
            if (!cleanupFns.length) return;
            for (const dispose of cleanupFns.splice(0, cleanupFns.length)) {
                try {
                    dispose();
                } catch {
                    /* intentionally empty */
                }
            }
        };

        const isBackgroundActive =
            backgroundStreamingAllowed.value &&
            (backgroundJobId.value || backgroundJobMode.value !== 'none');

        if (isBackgroundActive) {
            detached.value = true;
            clearBackgroundJobSubscriptions({ keepTracking: true });
            disposeHooks();
            // Do NOT reset backgroundJobId, backgroundJobMode, or backgroundJobInfo
            // This allows reattachment or background processing to continue
            return;
        }
        if (abortController.value) {
            // CRITICAL: Abort any active stream before clearing to prevent memory leaks
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch (e) {
                if (import.meta.dev) {
                    console.warn(
                        '[useChat] abort controller cleanup failed',
                        e
                    );
                }
            }
            streamAcc.finalize({ aborted: true });
            abortController.value = null;
        }

        clearBackgroundJobSubscriptions();

        // Clean up any registered hooks to avoid leaking listeners across threads
        disposeHooks();

        rawMessages.value = [];
        messages.value = [];
        streamAcc.reset();
    }

    // Keep in-memory history in sync when a message is edited elsewhere (e.g., inline edit UI)
    function applyLocalEdit(id: string, text: string) {
        let updated = false;
        const rawIdx = rawMessages.value.findIndex((m) => m.id === id);
        const raw = rawIdx !== -1 ? rawMessages.value[rawIdx] : undefined;
        if (raw) {
            if (Array.isArray(raw.content)) {
                raw.content = raw.content.map((p) =>
                    p.type === 'text' ? { ...p, text } : p
                );
            } else {
                raw.content = text;
            }
            rawMessages.value = [...rawMessages.value];
            updated = true;
        }
        const uiIdx = messages.value.findIndex((m) => m.id === id);
        if (uiIdx !== -1) {
            const uiMsg = messages.value[uiIdx];
            if (uiMsg) {
                uiMsg.text = text;
                messages.value = [...messages.value];
                updated = true;
            }
        }
        if (tailAssistant.value?.id === id) {
            tailAssistant.value.text = text;
            updated = true;
        }
        return updated;
    }

    void reattachBackgroundJobs();

    onScopeDispose(() => {
        clear();
    });

    return {
        messages,
        rawMessages,
        sendMessage,
        send: sendMessage,
        retryMessage,
        continueMessage,
        loading,
        backgroundJobId,
        backgroundJobMode,
        threadId: threadIdRef,
        streamId,
        resetStream,
        streamState,
        tailAssistant,
        flushTailAssistant,
        applyLocalEdit,
        ensureHistorySynced,
        abort: () => {
            if (backgroundJobId.value) {
                const jobId = backgroundJobId.value;
                const info = backgroundJobInfo.value;
                backgroundJobId.value = null;
                backgroundJobMode.value = 'none';
                backgroundJobInfo.value = null;
                aborted.value = true;
                void abortBackgroundJob(jobId);
                if (abortController.value) {
                    try {
                        abortController.value.abort();
                    } catch {
                        /* intentionally empty */
                    }
                    abortController.value = null;
                }
                streamAcc.finalize({ aborted: true });
                if (tailAssistant.value?.pending)
                    tailAssistant.value.pending = false;
                if (info?.messageId) {
                    const target = resolveUiMessage(info.messageId);
                    if (target) {
                        target.pending = false;
                        target.error = 'stopped';
                        messages.value = [...messages.value];
                    }
                    void updateMessageRecord(info.messageId, {
                        pending: false,
                        error: 'stopped',
                    });
                }
                return;
            }

            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {
                /* intentionally empty */
            }
            streamAcc.finalize({ aborted: true });
            if (tailAssistant.value?.pending)
                tailAssistant.value.pending = false;
            try {
                const appConfig = useAppConfig() as {
                    errors?: { showAbortInfo?: boolean };
                };
                const showAbort =
                    typeof appConfig.errors === 'object' &&
                    appConfig.errors.showAbortInfo === true;
                reportError(
                    err('ERR_STREAM_ABORTED', 'Generation aborted', {
                        severity: 'info',
                        tags: {
                            domain: 'chat',
                            threadId: threadIdRef.value || '',
                            streamId: streamId.value || '',
                            stage: 'abort',
                        },
                    }),
                    { code: 'ERR_STREAM_ABORTED', toast: showAbort }
                );
            } catch {
                /* intentionally empty */
            }
        },
        clear,
    };
}
