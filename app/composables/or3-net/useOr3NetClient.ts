import { useRuntimeConfig } from '#imports';

import { parseOr3NetErrorEnvelope } from './contracts';
import { useOr3NetAuth } from './useOr3NetAuth';
import {
    normalizeOr3NetHostUrl,
    Or3NetRequestError,
    type Or3NetAgent,
    type Or3NetCreateJobInput,
    type Or3NetCreateJobResponse,
    type Or3NetJobDetail,
    type Or3NetJobSummary,
    type Or3NetLaunchMetadata,
    type Or3NetNodeRecord,
    type Or3NetNodeService,
    type Or3NetPreviewDescriptor,
    type Or3NetSessionDetail,
    type Or3NetSessionRecord,
    type Or3NetServiceRestartResponse,
} from './types';

async function readJsonSafely(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.trim() === '') return null;

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function toRetryAfterMs(
    response: Response,
    payload: ReturnType<typeof parseOr3NetErrorEnvelope>
): number | undefined {
    if (typeof payload?.retry_after_ms === 'number' && Number.isFinite(payload.retry_after_ms)) {
        return payload.retry_after_ms;
    }

    const headerValue = response.headers.get('Retry-After');
    if (!headerValue) return undefined;

    const retryAfterSeconds = Number(headerValue);
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
        return undefined;
    }

    return Math.ceil(retryAfterSeconds * 1000);
}

export function useOr3NetClient() {
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            or3Net?: {
                enabled?: boolean;
                hostUrl?: string;
            };
        };
    };
    const auth = useOr3NetAuth();

    const baseUrl = normalizeOr3NetHostUrl(runtimeConfig.public.or3Net?.hostUrl);

    async function request<T>(path: string, input: {
        method?: string;
        body?: unknown;
        headers?: HeadersInit;
        retryOn401?: boolean;
    } = {}): Promise<T> {
        if (!baseUrl || !auth.isConfigured.value) {
            throw new Or3NetRequestError({
                message: 'OR3 Network is not configured',
                status: 503,
            });
        }

        const attempt = async (forceRefresh: boolean): Promise<T> => {
            const token = await auth.getAccessToken({ forceRefresh });
            if (!token) {
                throw new Or3NetRequestError({
                    message: 'OR3 Network token unavailable',
                    status: 401,
                });
            }

            const headers = new Headers(input.headers ?? {});
            headers.set('Authorization', `Bearer ${token}`);
            if (input.body !== undefined) {
                headers.set('Content-Type', 'application/json');
            }

            const response = await fetch(`${baseUrl}${path}`, {
                method: input.method ?? (input.body === undefined ? 'GET' : 'POST'),
                headers,
                body:
                    input.body === undefined
                        ? undefined
                        : JSON.stringify(input.body),
            });

            if (response.status === 401 && input.retryOn401 !== false && !forceRefresh) {
                auth.invalidate();
                return await attempt(true);
            }

            const payload = await readJsonSafely(response);
            if (!response.ok) {
                const envelope = parseOr3NetErrorEnvelope(payload);
                throw new Or3NetRequestError({
                    message:
                        envelope?.error ||
                        response.statusText ||
                        'OR3 Net request failed',
                    status: response.status,
                    code: envelope?.code,
                    requestId: envelope?.request_id,
                    retryAfterMs: toRetryAfterMs(response, envelope),
                    data: payload,
                });
            }

            return payload as T;
        };

        return await attempt(false);
    }

    return {
        request,
        listAgents(workspaceId: string) {
            return request<{ items: Or3NetAgent[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents`
            );
        },
        createAgent(workspaceId: string, body: Or3NetAgent) {
            return request<{ agent: Or3NetAgent }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents`,
                {
                    method: 'POST',
                    body,
                }
            );
        },
        getAgent(workspaceId: string, agentId: string) {
            return request<{ agent: Or3NetAgent }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`
            );
        },
        updateAgent(workspaceId: string, agentId: string, body: Or3NetAgent) {
            return request<{ agent: Or3NetAgent }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`,
                {
                    method: 'PUT',
                    body,
                }
            );
        },
        deleteAgent(workspaceId: string, agentId: string) {
            return request<null>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}`,
                {
                    method: 'DELETE',
                }
            );
        },
        listJobs(workspaceId: string, query?: URLSearchParams) {
            const suffix = query && query.toString() ? `?${query.toString()}` : '';
            return request<{ items: Or3NetJobSummary[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/jobs${suffix}`
            );
        },
        createJob(workspaceId: string, body: Or3NetCreateJobInput) {
            return request<Or3NetCreateJobResponse>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/jobs`,
                {
                    method: 'POST',
                    body,
                }
            );
        },
        getJob(jobId: string) {
            return request<Or3NetJobDetail>(
                `/v1/jobs/${encodeURIComponent(jobId)}`
            );
        },
        abortJob(jobId: string) {
            return request<Record<string, unknown>>(
                `/v1/jobs/${encodeURIComponent(jobId)}/abort`,
                {
                    method: 'POST',
                }
            );
        },
        listSessions(workspaceId: string, query?: URLSearchParams) {
            const suffix = query && query.toString() ? `?${query.toString()}` : '';
            return request<{ items: Or3NetSessionRecord[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions${suffix}`
            );
        },
        listNodes(workspaceId: string) {
            return request<{ items: Or3NetNodeRecord[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/nodes`
            );
        },
        listNodeServices(workspaceId: string, nodeId: string) {
            return request<{ items: Or3NetNodeService[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/services`
            );
        },
        launchNodeService(workspaceId: string, nodeId: string, serviceId: string) {
            return request<Or3NetLaunchMetadata>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/services/${encodeURIComponent(serviceId)}/launch`,
                {
                    method: 'POST',
                }
            );
        },
        restartNodeService(workspaceId: string, nodeId: string, serviceId: string) {
            return request<Or3NetServiceRestartResponse>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/services/${encodeURIComponent(serviceId)}/restart`,
                {
                    method: 'POST',
                }
            );
        },
        revokeNodeService(workspaceId: string, nodeId: string, serviceId: string) {
            return request<{ ok: true; revoked: number }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/nodes/${encodeURIComponent(nodeId)}/services/${encodeURIComponent(serviceId)}/revoke`,
                {
                    method: 'POST',
                }
            );
        },
        listPreviews(workspaceId: string) {
            return request<{ items: Or3NetPreviewDescriptor[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/previews`
            );
        },
        launchPreview(
            workspaceId: string,
            previewId: string,
            body?: { launch_mode_hint?: 'pane' | 'new_tab' | 'external_browser'; path_hint?: string }
        ) {
            return request<Or3NetLaunchMetadata>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/previews/${encodeURIComponent(previewId)}/launch`,
                {
                    method: 'POST',
                    body,
                }
            );
        },
        revokePreview(workspaceId: string, previewId: string) {
            return request<{ preview: Or3NetPreviewDescriptor }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/previews/${encodeURIComponent(previewId)}/revoke`,
                {
                    method: 'POST',
                }
            );
        },
        getSession(workspaceId: string, sessionId: string) {
            return request<Or3NetSessionDetail>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`
            );
        },
        listSessionEvents(workspaceId: string, sessionId: string, query?: URLSearchParams) {
            const suffix = query && query.toString() ? `?${query.toString()}` : '';
            return request<{ items: unknown[] }>(
                `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/events${suffix}`
            );
        },
    };
}
