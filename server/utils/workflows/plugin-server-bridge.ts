import type { H3Event } from 'h3';
import { createError, getHeader, readBody, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../auth/is-ssr-auth-enabled';
import { checkSyncRateLimit, recordSyncRequest } from '../sync/rate-limiter';
import { enforceRateLimit } from '../rate-limit/enforce';
import { getJobProvider } from '../background-jobs/store';
import type { CreateJobParams } from '../background-jobs/types';
import { requireJobWorkspaceAccess } from '../background-jobs/access';
import { emitJobDelta, emitJobStatus, hasJobViewers, initJobLiveState } from '../background-jobs/viewers';
import { logBackgroundEvent } from '../background-jobs/logging';
import { executeServerTool, listServerTools } from '../chat/tool-registry';
import { getNotificationEmitter } from '../notifications/registry';
import { emitBackgroundJobWebhookEvent } from '../webhooks/hook-emissions';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { createOpenRouterClient as buildOpenRouterClient, DEFAULT_HEADERS } from '~~/shared/openrouter';
import { normalizeOpenRouterBaseUrl } from '~~/shared/openrouter/url';

/** Generic host operations supplied only after the package dispatcher authorizes the route. */
export function createWorkflowServerBridge(requestEvent: H3Event) {
    const reservedRequests = new Set<string>();
    return {
        readBody,
        setNoStore(event: H3Event) {
            if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
            setResponseHeader(event, 'Cache-Control', 'no-store');
        },
        async authorize(event: H3Event, rateKey: 'workflow:background' | 'workflow:hitl') {
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
            const session = await resolveSessionContext(requestEvent);
            const userId = session.user?.id;
            const workspaceId = session.workspace?.id;
            if (!session.authenticated || !userId || !workspaceId) {
                throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
            }
            const provider = await getJobProvider();
            return {
                name: provider.name,
                async createJob(input: CreateJobParams) {
                    if (input.userId !== userId || input.kind !== 'workflow') {
                        throw createError({ statusCode: 403, statusMessage: 'Invalid workflow job scope' });
                    }
                    await requireJobWorkspaceAccess(requestEvent, session, workspaceId, 'workspace.write');
                    const { assertServerProjectExecutionSupported } = await import('../chat/project-policy');
                    await assertServerProjectExecutionSupported({ subject: userId, workspaceId, threadId: input.threadId, abortSignal: AbortSignal.timeout(10_000) });
                    return provider.createJob({
                        ...input,
                        execution: { version: 1, kind: 'workflow', workspaceId },
                        // Workflows have no pending canonical chat write. A settled
                        // phase fences chat recovery while allowing terminal retention.
                        historyPhase: 'committed',
                    });
                },
                getJob: provider.getJob.bind(provider),
                updateJob: provider.updateJob.bind(provider),
                completeJob: provider.completeJob.bind(provider),
                failJob: provider.failJob.bind(provider),
                getAbortController: provider.getAbortController?.bind(provider),
            };
        },
        getSyncGateway: getActiveSyncGatewayAdapter,
        emitJobDelta,
        emitJobStatus,
        hasJobViewers,
        initJobLiveState,
        logBackgroundEvent,
        executeServerTool,
        listServerTools,
        getNotificationEmitter,
        emitWebhook: emitBackgroundJobWebhookEvent,
        createOpenRouterClient(input: { apiKey: string }) {
            const serverURL = normalizeOpenRouterBaseUrl(useRuntimeConfig().openrouterBaseUrl);
            return {
                client: buildOpenRouterClient({ apiKey: input.apiKey, serverURL }),
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
