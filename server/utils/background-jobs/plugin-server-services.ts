import type { H3Event } from 'h3';
import { createError, getHeader, readBody, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
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
        createOpenRouterClient(input: { apiKey: string }) {
            allow('ai.provider');
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
