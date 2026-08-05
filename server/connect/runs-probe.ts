import { createError } from 'h3';

export interface RunsProbeResult {
    readonly sessions: boolean;
    readonly events: boolean;
}

type RunsProbeFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export async function probeRunsCapabilities(
    baseUrl: string,
    token: string,
    options: { fetch?: RunsProbeFetch; timeoutMs?: number } = {}
): Promise<RunsProbeResult> {
    let origin: URL;
    try {
        origin = new URL(baseUrl);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'The runtime host URL is invalid.' });
    }
    if (
        (origin.protocol !== 'https:' &&
            !['localhost', '127.0.0.1'].includes(origin.hostname)) ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash ||
        !['/', '/or3/'].includes(origin.pathname.endsWith('/') ? origin.pathname : `${origin.pathname}/`)
    ) {
        throw createError({ statusCode: 400, statusMessage: 'The runtime host URL is invalid.' });
    }
    const path = origin.pathname.endsWith('/') ? origin.pathname : `${origin.pathname}/`;
    const target = new URL('v1/capabilities', `${origin.origin}${path}`).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 4_000);
    try {
        const response = await (options.fetch ?? globalThis.fetch)(target, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) return { sessions: false, events: false };
        const payload = (await response.json()) as Record<string, unknown>;
        const features = record(payload.features);
        const endpoints = record(payload.endpoints);
        return {
            sessions: features.session_resources === true || validEndpoint(endpoints.sessions),
            events: features.run_events_sse === true || validEndpoint(endpoints.run_events),
        };
    } catch {
        return { sessions: false, events: false };
    } finally {
        clearTimeout(timeout);
    }
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function validEndpoint(value: unknown): boolean {
    const endpoint = record(value);
    return typeof endpoint.path === 'string' && endpoint.path.trim().startsWith('/');
}
