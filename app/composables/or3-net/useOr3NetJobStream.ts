import { readonly, ref } from 'vue';
import { useRuntimeConfig } from '#imports';

import { useOr3NetAuth } from './useOr3NetAuth';
import { useOr3NetClient } from './useOr3NetClient';
import {
    normalizeOr3NetHostUrl,
    type Or3NetErrorEnvelope,
    type Or3NetJobDetail,
    type Or3NetJobStatus,
    type Or3NetJobStreamEvent,
} from './types';

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.2;

const TERMINAL_STATUSES = new Set<Or3NetJobStatus>([
    'completed',
    'failed',
    'aborted',
]);

export function useOr3NetJobStream() {
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            or3Net?: {
                enabled?: boolean;
                hostUrl?: string;
            };
        };
    };
    const auth = useOr3NetAuth();
    const client = useOr3NetClient();

    const baseUrl = normalizeOr3NetHostUrl(runtimeConfig.public.or3Net?.hostUrl);

    const activeJobId = ref<string | null>(null);
    const pending = ref(false);
    const connected = ref(false);
    const error = ref<Error | null>(null);
    const status = ref<Or3NetJobStatus | null>(null);
    const content = ref('');
    const events = ref<Or3NetJobStreamEvent[]>([]);
    const result = ref<unknown>(undefined);
    const failure = ref<Record<string, unknown> | null>(null);
    const isTerminal = ref(false);

    let activeController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionRunId = 0;
    let reconnectAttempt = 0;

    function clearReconnectTimer(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function clearTransport(options: {
        resetReconnectAttempt?: boolean;
        resetTerminal?: boolean;
    } = {}): void {
        clearReconnectTimer();
        if (activeController) {
            activeController.abort();
            activeController = null;
        }
        connected.value = false;
        pending.value = false;
        if (options.resetReconnectAttempt !== false) {
            reconnectAttempt = 0;
        }
        if (options.resetTerminal !== false) {
            isTerminal.value = false;
        }
    }

    function resetStreamState(jobId: string | null): void {
        activeJobId.value = jobId;
        error.value = null;
        status.value = null;
        content.value = '';
        events.value = [];
        result.value = undefined;
        failure.value = null;
        isTerminal.value = false;
    }

    function recordEvent(event: Or3NetJobStreamEvent): void {
        if (events.value.length >= 100) {
            events.value.shift();
        }
        events.value.push(event);
    }

    function applyEvent(event: Or3NetJobStreamEvent): void {
        recordEvent(event);
        switch (event.event) {
            case 'job.accepted':
                status.value = 'pending';
                return;
            case 'job.started':
                status.value = 'running';
                return;
            case 'text.delta':
                content.value += event.data.text;
                return;
            case 'tool.call':
            case 'tool.result':
                return;
            case 'job.completed':
                status.value = 'completed';
                result.value = event.data;
                isTerminal.value = true;
                connected.value = false;
                return;
            case 'job.failed':
                status.value = 'failed';
                failure.value = event.data;
                isTerminal.value = true;
                connected.value = false;
                return;
            case 'job.aborted':
                status.value = 'aborted';
                isTerminal.value = true;
                connected.value = false;
                return;
            case 'error':
                failure.value = event.data as Record<string, unknown>;
                error.value = new Error(
                    event.data.error || 'OR3 Net stream failed'
                );
                return;
        }
    }

    function parseJsonData(text: string): unknown {
        if (!text.trim()) return null;
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }

    function toStreamEvent(
        eventName: string,
        payload: unknown
    ): Or3NetJobStreamEvent | null {
        switch (eventName) {
            case 'job.accepted':
                return {
                    event: 'job.accepted',
                    data: (payload ?? {}) as { job_id: string },
                };
            case 'job.started':
                return {
                    event: 'job.started',
                    data: (payload ?? {}) as { job_id: string; started_at?: string },
                };
            case 'text.delta':
                return {
                    event: 'text.delta',
                    data: (payload ?? {}) as { text: string },
                };
            case 'tool.call':
                return {
                    event: 'tool.call',
                    data: (payload ?? {}) as {
                        name: string;
                        tool_call_id?: string;
                        arguments?: string | Record<string, unknown>;
                    },
                };
            case 'tool.result':
                return {
                    event: 'tool.result',
                    data: (payload ?? {}) as {
                        name: string;
                        tool_call_id?: string;
                        result?: string | Record<string, unknown>;
                        content?: string;
                    },
                };
            case 'job.completed':
                return {
                    event: 'job.completed',
                    data: (payload ?? {}) as Record<string, unknown> & { job_id?: string },
                };
            case 'job.failed':
                return {
                    event: 'job.failed',
                    data: (payload ?? {}) as Record<string, unknown>,
                };
            case 'job.aborted':
                return {
                    event: 'job.aborted',
                    data: (payload ?? {}) as { job_id: string },
                };
            case 'error':
                return {
                    event: 'error',
                    data: (payload ?? {}) as Or3NetErrorEnvelope,
                };
            default:
                return null;
        }
    }

    function parseAndApplyFrame(frame: string): void {
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
                continue;
            }
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
        }

        if (dataLines.length === 0) {
            return;
        }

        const payload = parseJsonData(dataLines.join('\n'));
        const event = toStreamEvent(eventName, payload);
        if (!event) {
            return;
        }

        applyEvent(event);
    }

    async function syncJobState(jobId: string): Promise<void> {
        let job: Or3NetJobDetail;
        try {
            job = await client.getJob(jobId);
        } catch {
            return;
        }

        status.value = job.status;
        if (job.result !== undefined) {
            result.value = job.result;
        }
        if (job.error !== undefined) {
            failure.value = job.error as Record<string, unknown>;
        }
        if (TERMINAL_STATUSES.has(job.status)) {
            isTerminal.value = true;
        }
    }

    function getReconnectDelayMs(): number {
        const baseDelayMs = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
            RECONNECT_MAX_DELAY_MS
        );
        reconnectAttempt += 1;
        const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_RATIO;
        return Math.max(RECONNECT_BASE_DELAY_MS, Math.round(baseDelayMs * jitter));
    }

    function scheduleReconnect(jobId: string): void {
        clearReconnectTimer();
        const delayMs = getReconnectDelayMs();
        reconnectTimer = setTimeout(() => {
            void connect(jobId, true).catch(() => undefined);
        }, delayMs);
    }

    async function connect(jobId: string, isReconnect = false): Promise<void> {
        if (!baseUrl || !auth.isConfigured.value) {
            throw new Error('OR3 Network is not configured');
        }

        const token = await auth.getAccessToken({ forceRefresh: isReconnect });
        if (!token) {
            throw new Error('OR3 Network token unavailable');
        }

        clearTransport({ resetReconnectAttempt: false, resetTerminal: false });
        connectionRunId += 1;
        const runId = connectionRunId;
        resetStreamState(jobId);
        pending.value = true;

        const controller = new AbortController();
        activeController = controller;

        try {
            const response = await fetch(
                `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/stream`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'text/event-stream',
                    },
                    signal: controller.signal,
                }
            );

            if (response.status === 401 && !isReconnect) {
                auth.invalidate();
                await connect(jobId, true);
                return;
            }

            if (!response.ok || !response.body) {
                const bodyText = await response.text().catch(() => '');
                const envelope = parseJsonData(bodyText) as
                    | Or3NetErrorEnvelope
                    | null;
                throw new Error(
                    envelope?.error ||
                        response.statusText ||
                        'OR3 Net stream request failed'
                );
            }

            pending.value = false;
            connected.value = true;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (runId !== connectionRunId) {
                    return;
                }
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    const frame = buffer.slice(0, boundary).trim();
                    buffer = buffer.slice(boundary + 2);
                    if (frame) {
                        parseAndApplyFrame(frame);
                    }
                    boundary = buffer.indexOf('\n\n');
                }
            }

            const tail = buffer.trim();
            if (tail) {
                parseAndApplyFrame(tail);
            }
            connected.value = false;
            if (!isTerminal.value && !controller.signal.aborted) {
                await syncJobState(jobId);
                if (!isTerminal.value) {
                    scheduleReconnect(jobId);
                }
            }
        } catch (cause) {
            if (controller.signal.aborted) {
                return;
            }
            const normalized =
                cause instanceof Error ? cause : new Error(String(cause));
            error.value = normalized;
            connected.value = false;
            await syncJobState(jobId);
            if (!isTerminal.value) {
                scheduleReconnect(jobId);
            }
        } finally {
            if (runId === connectionRunId) {
                pending.value = false;
            }
        }
    }

    return {
        activeJobId: readonly(activeJobId),
        pending: readonly(pending),
        connected: readonly(connected),
        error: readonly(error),
        status: readonly(status),
        content: readonly(content),
        events: readonly(events),
        result: readonly(result),
        failure: readonly(failure),
        isTerminal: readonly(isTerminal),
        async attach(jobId: string | null) {
            if (!jobId) {
                clearTransport();
                resetStreamState(null);
                return;
            }
            await connect(jobId, false);
        },
        detach() {
            clearTransport();
        },
    };
}
