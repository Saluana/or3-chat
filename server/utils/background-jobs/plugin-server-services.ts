import type { H3Event } from 'h3';
import { createError, getHeader, readBody, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { HTTPClient } from '@openrouter/sdk';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../auth/is-ssr-auth-enabled';
import { checkSyncRateLimit, recordSyncRequest } from '../sync/rate-limiter';
import { enforceRateLimit } from '../rate-limit/enforce';
import { getJobProvider } from '../background-jobs/store';
import type { JobUpdate, CreateJobParams } from '../background-jobs/types';
import { requireJobWorkspaceAccess } from '../background-jobs/access';
import { emitJobDelta, emitJobStatus, hasJobViewers, initJobLiveState } from '../background-jobs/viewers';
import { logBackgroundEvent } from '../background-jobs/logging';
import { executeServerTool, listServerTools } from '../chat/tool-registry';
import { getNotificationEmitter } from '../notifications/registry';
import { emitBackgroundJobWebhookEvent } from '../webhooks/hook-emissions';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { createOpenRouterClient as buildOpenRouterClient, DEFAULT_HEADERS } from '~~/shared/openrouter';
import { normalizeOpenRouterBaseUrl } from '~~/shared/openrouter/url';
import { canonicalHistoryContext } from '../chat/canonical-history-context';
import { assertServerProjectExecutionSupported } from '../chat/project-policy';

interface WorkflowJobOrigin { jobId: string; userId: string; workspaceId: string; threadId: string; messageId: string }

let warnedLegacyWorkflowOrigin = false;

/** Generic host operations supplied only after the package dispatcher authorizes the route. */
export function createTrustedPluginServerServices(requestEvent: H3Event, grants: ReadonlySet<string>) {
    const allow = (grant: string) => { if (!grants.has(grant)) throw createError({ statusCode: 403, statusMessage: 'Plugin grant required' }); };
    const reservedRequests = new Set<string>();
    return {
        readBody,
        setNoStore(event: H3Event) {
            if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
            setResponseHeader(event, 'Cache-Control', 'no-store');
        },
        async authorize(event: H3Event, rateKey: string) {
            allow('jobs.background');
            const session = await resolveSessionContext(event);
            if (!session.authenticated || !session.user || !session.workspace) {
                throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
            }
            requireCan(session, 'workspace.write', { kind: 'workspace', id: session.workspace.id });
            enforceRateLimit(event, checkSyncRateLimit(session.user.id, rateKey));
            recordSyncRequest(session.user.id, rateKey);
            reservedRequests.add(JSON.stringify([session.user.id, rateKey]));
            return { userId: session.user.id, workspaceId: session.workspace.id };
        },
        resolveApiKey(event: H3Event) {
            allow('ai.provider');
            const config = useRuntimeConfig(event);
            const allowUserOverride = config.openrouterAllowUserOverride !== false;
            const requireUserKey = config.openrouterRequireUserKey === true;
            const authHeader = getHeader(event, 'authorization');
            const keyHeader = getHeader(event, 'x-or3-openrouter-key');
            const clientKey = (typeof keyHeader === 'string' && keyHeader.trim() ? keyHeader.trim() : undefined) ||
                (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
            return requireUserKey ? clientKey :
                (allowUserOverride ? clientKey : undefined) || config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
        },
        async getJobProvider() {
            allow('jobs.background');
            const session = await resolveSessionContext(requestEvent);
            const userId = session.user?.id;
            const workspaceId = session.workspace?.id;
            if (!session.authenticated || !userId || !workspaceId) {
                throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
            }
            const provider = await getJobProvider();
            const authorized = new Set<string>();
            const checkJob = async (id: string, permission: 'workspace.read' | 'workspace.write') => {
                const job = await provider.getJob(id, userId);
                if (!job || job.kind !== 'workflow' || job.execution?.workspaceId !== workspaceId) {
                    throw createError({ statusCode: 403, statusMessage: 'Invalid plugin job scope' });
                }
                await requireJobWorkspaceAccess(requestEvent, session, workspaceId, permission);
                authorized.add(id);
                return job;
            };
            return {
                name: provider.name,
                async createJob(input: CreateJobParams) {
                    if (input.userId !== userId || input.kind !== 'workflow') {
                        throw createError({ statusCode: 403, statusMessage: 'Invalid workflow job scope' });
                    }
                    await requireJobWorkspaceAccess(requestEvent, session, workspaceId, 'workspace.write');
                    await assertServerProjectExecutionSupported({ subject: userId, workspaceId, threadId: input.threadId, abortSignal: AbortSignal.timeout(10_000) });
                    const id = await provider.createJob({
                        ...input,
                        execution: { version: 1, kind: 'workflow', workspaceId },
                        // Workflows have no pending canonical chat write. A settled
                        // phase fences chat recovery while allowing terminal retention.
                        historyPhase: 'committed',
                    });
                    authorized.add(id);
                    return id;
                },
                async getJob(id: string, requestedUserId: string) {
                    if (requestedUserId !== userId) throw createError({ statusCode: 403, statusMessage: 'Invalid plugin job identity' });
                    return checkJob(id, 'workspace.read');
                },
                async updateJob(id: string, update: JobUpdate) { await checkJob(id, 'workspace.write'); return provider.updateJob(id, update); },
                async completeJob(id: string, content: string) { await checkJob(id, 'workspace.write'); return provider.completeJob(id, content); },
                async failJob(id: string, error: string) { await checkJob(id, 'workspace.write'); return provider.failJob(id, error); },
                getAbortController(id: string) {
                    if (!authorized.has(id)) throw createError({ statusCode: 403, statusMessage: 'Invalid plugin job scope' });
                    return provider.getAbortController?.(id);
                },
            };
        },
        getSyncGateway: getActiveSyncGatewayAdapter,
        emitJobDelta,
        emitJobStatus,
        hasJobViewers,
        initJobLiveState,
        logBackgroundEvent,
        executeServerTool: (...args: Parameters<typeof executeServerTool>) => { allow('tools.use'); return executeServerTool(...args); },
        listServerTools: () => { allow('tools.use'); return listServerTools(); },
        getNotificationEmitter,
        emitWebhook: emitBackgroundJobWebhookEvent,
        createOpenRouterClient(input: { apiKey: string; origin?: WorkflowJobOrigin }) {
            allow('ai.provider');
            const serverURL = normalizeOpenRouterBaseUrl(useRuntimeConfig().openrouterBaseUrl);
            const origin = input.origin && { ...input.origin };
            const httpClient = new HTTPClient({ fetcher: async (request, init) => {
                if (!origin) {
                    // Transition for Workflows builds that predate run origins: job
                    // admission (createJob) still refuses project chats; only the
                    // per-request move fence needs the origin.
                    if (!warnedLegacyWorkflowOrigin) {
                        warnedLegacyWorkflowOrigin = true;
                        console.warn('[workflows] This Workflows package predates run origins; update it to fence project moves during background runs.');
                    }
                    return fetch(request, init);
                }
                const session = await resolveSessionContext(requestEvent);
                if (session.user?.id !== origin.userId) throw new Error('Workflow actor changed.');
                const provider = await getJobProvider();
                const job = await provider.getJob(origin.jobId, origin.userId);
                if (!job || job.kind !== 'workflow' || job.status !== 'streaming'
                    || job.threadId !== origin.threadId || job.messageId !== origin.messageId
                    || job.execution?.workspaceId !== origin.workspaceId)
                    throw new Error('The originating workflow job is no longer available.');
                const jobSignal = provider.getAbortController?.(origin.jobId)?.signal;
                const requestSignal = request instanceof Request ? request.signal : init?.signal;
                const signal = AbortSignal.any([AbortSignal.timeout(10_000),
                    ...(jobSignal ? [jobSignal] : []), ...(requestSignal ? [requestSignal] : [])]);
                await requireJobWorkspaceAccess(requestEvent, session, origin.workspaceId, 'workspace.write');
                const history = canonicalHistoryContext({ subject: origin.userId, workspaceId: origin.workspaceId,
                    threadId: origin.threadId, syncProviderId: useRuntimeConfig().public.sync.provider!, signal });
                const result = await history.read({ kind: 'messages', message_ids: [origin.messageId] });
                const message = result.status === 'ok' ? result.messages?.find(row => row.id === origin.messageId) : undefined;
                if (!message || message.deleted || message.thread_id !== origin.threadId
                    || (message.data as { type?: string } | undefined)?.type !== 'workflow-execution')
                    throw new Error('The originating workflow message is no longer available.');
                await requireJobWorkspaceAccess(requestEvent, session, origin.workspaceId, 'workspace.write');
                await assertServerProjectExecutionSupported({ subject: origin.userId, workspaceId: origin.workspaceId, threadId: origin.threadId, abortSignal: signal });
                signal.throwIfAborted();
                return fetch(request, { ...init, ...(jobSignal ? { signal: AbortSignal.any([jobSignal, ...(requestSignal ? [requestSignal] : [])]) } : {}) });
            } });
            return {
                client: buildOpenRouterClient({ apiKey: input.apiKey, serverURL, httpClient }),
                headers: DEFAULT_HEADERS,
                apiKey: input.apiKey,
                serverURL,
                metadata: 'disabled' as const,
            };
        },
        recordRequest(userId: string, rateKey: string) {
            // Existing workflow packages call this after asynchronous work.
            // authorize already reserved this request's slot before that work.
            if (!reservedRequests.has(JSON.stringify([userId, rateKey]))) {
                recordSyncRequest(userId, rateKey);
            }
        },
    };
}
