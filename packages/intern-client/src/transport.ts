import {
    InternClientError,
    InternUnavailableError,
    type InternErrorCode,
} from './errors';
import { redactInternSecrets } from './redaction';
import {
    internSseEventCursor,
    internSseEventKey,
    readInternSseStream,
    type InternSseEvent,
} from './sse';

export type InternHttpMethod =
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE';

export interface InternAuthContext {
    method: InternHttpMethod;
    path: string;
    baseUrl: string;
    requireAuth: boolean;
}

export interface InternResolvedAuth {
    token?: string;
    scheme?: string;
    headers?: HeadersInit;
}

export type InternAuthResolver = (
    context: InternAuthContext
) =>
    | InternResolvedAuth
    | null
    | undefined
    | Promise<InternResolvedAuth | null | undefined>;

export interface InternClock {
    now(): number;
    random(): number;
    sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
    setTimeout(callback: () => void, milliseconds: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface InternTransportOptions {
    baseUrl: string | (() => string);
    fetch?: typeof globalThis.fetch;
    resolveAuth?: InternAuthResolver;
    defaultTimeoutMs?: number;
    streamConnectTimeoutMs?: number;
    streamInactivityTimeoutMs?: number;
    clock?: Partial<InternClock>;
}

export interface InternResponseContext {
    method: InternHttpMethod;
    path: string;
    response: Response;
}

export type InternResponseType = 'json' | 'text' | 'void';

export interface InternRequestOptions<T = unknown> {
    method?: InternHttpMethod;
    body?: unknown;
    headers?: HeadersInit;
    signal?: AbortSignal;
    timeoutMs?: number;
    requireAuth?: boolean;
    baseUrl?: string;
    responseType?: InternResponseType;
    acceptedStatuses?:
        | readonly number[]
        | ((status: number, response: Response) => boolean);
    onResponse?: (
        context: InternResponseContext
    ) => void | Promise<void>;
    parse?: (value: unknown, response: Response) => T;
}

export interface InternReconnectOptions {
    maxAttempts?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: number;
}

export interface InternStreamResumeOptions<T = unknown> {
    initialCursor?: string | number;
    queryParameter?: string;
    sendLastEventId?: boolean;
    cursorFromEvent?: (
        event: InternSseEvent<T>
    ) => string | number | undefined;
}

export interface InternStreamDedupeOptions<T = unknown> {
    maxEntries?: number;
    key?: (event: InternSseEvent<T>) => string | undefined;
}

export interface InternStreamOptions<T = unknown>
    extends Omit<InternRequestOptions<never>, 'parse' | 'responseType'> {
    reconnect?: boolean | InternReconnectOptions;
    resume?: InternStreamResumeOptions<T>;
    dedupe?: boolean | InternStreamDedupeOptions<T>;
    isTerminal?: (event: InternSseEvent<T>) => boolean;
    /** Maximum silence after connection; 0 disables the inactivity deadline. */
    inactivityTimeoutMs?: number;
}

export interface InternTransport {
    buildUrl(path: string, explicitBaseUrl?: string): string;
    request<T = unknown>(
        path: string,
        options?: InternRequestOptions<T>
    ): Promise<T>;
    stream<T = unknown>(
        path: string,
        options?: InternStreamOptions<T>
    ): AsyncIterable<InternSseEvent<T>>;
}

function sensitiveQueryKey(key: string): boolean {
    return (
        /^(?:authorization|password|passphrase|secret|api[_-]?key)$/i.test(
            key
        ) ||
        /(?:^|[_-])(?:password|passphrase|secret|token|api[_-]?key)$/i.test(
            key
        ) ||
        /(?:Password|Passphrase|Secret|Token|ApiKey)$/.test(key)
    );
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_STREAM_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

function defaultSleep(
    milliseconds: number,
    signal?: AbortSignal
): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = globalThis.setTimeout(done, milliseconds);
        function done() {
            signal?.removeEventListener('abort', aborted);
            resolve();
        }
        function aborted() {
            globalThis.clearTimeout(timer);
            signal?.removeEventListener('abort', aborted);
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', aborted, { once: true });
    });
}

function createClock(input?: Partial<InternClock>): InternClock {
    return {
        now: input?.now ?? (() => Date.now()),
        random: input?.random ?? (() => Math.random()),
        sleep: input?.sleep ?? defaultSleep,
        setTimeout:
            input?.setTimeout ??
            ((callback, milliseconds) =>
                globalThis.setTimeout(callback, milliseconds)),
        clearTimeout:
            input?.clearTimeout ??
            ((handle) =>
                globalThis.clearTimeout(
                    handle as ReturnType<typeof globalThis.setTimeout>
                )),
    };
}

function normalizeBaseUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new InternClientError(
            'validation_failed',
            'The selected host URL is invalid.'
        );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new InternClientError(
            'validation_failed',
            'The selected host must use HTTP or HTTPS.'
        );
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new InternClientError(
            'validation_failed',
            'Host credentials and query parameters must not appear in the URL.'
        );
    }
    return url.toString().replace(/\/+$/, '');
}

function validatePath(path: string): string {
    const trimmed = path.trim();
    if (
        !trimmed ||
        /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
        trimmed.startsWith('//')
    ) {
        throw new InternClientError(
            'validation_failed',
            'Service requests require a relative path.'
        );
    }
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    let url: URL;
    try {
        url = new URL(normalized, 'https://or3.invalid');
    } catch {
        throw new InternClientError(
            'validation_failed',
            'The service request path is invalid.'
        );
    }
    if (url.hash) {
        throw new InternClientError(
            'validation_failed',
            'Service request paths must not contain fragments.'
        );
    }
    for (const key of url.searchParams.keys()) {
        if (sensitiveQueryKey(key)) {
            throw new InternClientError(
                'validation_failed',
                'Credentials and secrets must be sent in headers or request bodies, never query parameters.'
            );
        }
    }
    return `${url.pathname}${url.search}`;
}

function appendCursor(
    path: string,
    queryParameter: string,
    cursor?: string
): string {
    const validated = validatePath(path);
    if (cursor === undefined || cursor === '') return validated;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(queryParameter)) {
        throw new InternClientError(
            'validation_failed',
            'The stream cursor parameter is invalid.'
        );
    }
    const url = new URL(validated, 'https://or3.invalid');
    url.searchParams.set(queryParameter, cursor);
    return `${url.pathname}${url.search}`;
}

function isAbortError(error: unknown): boolean {
    return (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
    );
}

function isRawBody(value: unknown): value is BodyInit {
    if (typeof value === 'string') return true;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
    if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
    if (
        typeof URLSearchParams !== 'undefined' &&
        value instanceof URLSearchParams
    ) {
        return true;
    }
    if (
        typeof ReadableStream !== 'undefined' &&
        value instanceof ReadableStream
    ) {
        return true;
    }
    return false;
}

function payloadMessage(payload: unknown, fallback: string): string {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        for (const key of ['message', 'error', 'detail']) {
            if (typeof record[key] === 'string' && record[key].trim()) {
                return record[key].trim();
            }
        }
    }
    if (typeof payload === 'string' && payload.trim()) return payload.trim();
    return fallback;
}

function payloadString(payload: unknown, key: string): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return undefined;
    }
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }
    return undefined;
}

function errorCodeForResponse(
    status: number,
    remoteCode?: string
): InternErrorCode {
    const code = remoteCode?.toLowerCase() ?? '';
    if (
        status === 503 ||
        code === 'capability_unavailable' ||
        code === 'runner_disabled' ||
        code === 'runner_missing' ||
        code === 'runner_auth_missing'
    ) {
        return 'unavailable';
    }
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 408 || status === 504 || code === 'timeout') return 'timeout';
    if (status === 409) return 'conflict';
    if (status === 400 || status === 422) return 'validation_failed';
    return 'http';
}

function makeResponseError(
    response: Response,
    payload: unknown,
    secrets: readonly string[]
): InternClientError {
    const remoteCode = payloadString(payload, 'code');
    const requestId =
        response.headers.get('X-Request-Id') ??
        payloadString(payload, 'request_id');
    const code = errorCodeForResponse(response.status, remoteCode);
    const options = {
        status: response.status,
        remoteCode,
        requestId,
        retryable:
            code === 'timeout' ||
            code === 'offline' ||
            response.status === 429 ||
            response.status >= 500,
        details: {
            status: response.status,
            payload,
            requestId,
        },
        secrets,
    };
    const message = payloadMessage(
        payload,
        `Request failed with status ${response.status}.`
    );
    return code === 'unavailable'
        ? new InternUnavailableError(message, options)
        : new InternClientError(code, message, options);
}

async function readResponsePayload(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '');
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function statusAccepted(
    response: Response,
    accepted?: InternRequestOptions['acceptedStatuses']
): boolean {
    if (response.ok) return true;
    if (Array.isArray(accepted)) return accepted.includes(response.status);
    return typeof accepted === 'function'
        ? accepted(response.status, response)
        : false;
}

interface AbortScope {
    readonly signal: AbortSignal;
    readonly timedOut: () => boolean;
    clearTimeout(): void;
    resetTimeout(milliseconds: number): void;
    dispose(): void;
}

function createAbortScope(
    externalSignal: AbortSignal | undefined,
    timeoutMs: number,
    clock: InternClock
): AbortScope {
    const controller = new AbortController();
    let timeoutHandle: unknown;
    let didTimeout = false;
    const externalAbort = () => {
        controller.abort(
            externalSignal?.reason ?? new DOMException('Aborted', 'AbortError')
        );
    };
    if (externalSignal?.aborted) {
        externalAbort();
    } else {
        externalSignal?.addEventListener('abort', externalAbort, {
            once: true,
        });
    }
    const clearTimeout = () => {
        if (timeoutHandle !== undefined) {
            clock.clearTimeout(timeoutHandle);
            timeoutHandle = undefined;
        }
    };
    const resetTimeout = (milliseconds: number) => {
        clearTimeout();
        if (Number.isFinite(milliseconds) && milliseconds > 0) {
            timeoutHandle = clock.setTimeout(() => {
                didTimeout = true;
                controller.abort(
                    new DOMException('Timed out', 'TimeoutError')
                );
            }, milliseconds);
        }
    };
    resetTimeout(timeoutMs);
    return {
        signal: controller.signal,
        timedOut: () => didTimeout,
        clearTimeout,
        resetTimeout,
        dispose() {
            clearTimeout();
            externalSignal?.removeEventListener('abort', externalAbort);
        },
    };
}

function monitorStreamActivity(
    stream: ReadableStream<Uint8Array>,
    onActivity: () => void
): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            onActivity();
            controller.enqueue(value);
        },
        async cancel(reason) {
            await reader.cancel(reason);
        },
    });
}

function requestFailure(
    error: unknown,
    scope: AbortScope,
    externalSignal: AbortSignal | undefined,
    secrets: readonly string[]
): InternClientError {
    if (error instanceof InternClientError) return error;
    if (scope.timedOut()) {
        return new InternClientError('timeout', 'The request timed out.', {
            retryable: true,
            cause: error,
            secrets,
        });
    }
    if (externalSignal?.aborted || isAbortError(error)) {
        return new InternClientError('aborted', 'The request was stopped.', {
            cause: error,
            secrets,
        });
    }
    return new InternClientError(
        'offline',
        'Could not reach the selected host.',
        {
            retryable: true,
            cause: error,
            secrets,
        }
    );
}

function reconnectConfig(
    input: InternStreamOptions['reconnect']
): Required<InternReconnectOptions> | null {
    if (!input) return null;
    const options = input === true ? {} : input;
    const finite = (value: number | undefined, fallback: number) =>
        Number.isFinite(value) ? (value as number) : fallback;
    return {
        maxAttempts: Math.min(
            100,
            Math.max(
                0,
                Math.floor(finite(options.maxAttempts, 5))
            )
        ),
        minDelayMs: Math.min(
            60_000,
            Math.max(0, finite(options.minDelayMs, 250))
        ),
        maxDelayMs: Math.min(
            60_000,
            Math.max(0, finite(options.maxDelayMs, 10_000))
        ),
        factor: Math.min(
            10,
            Math.max(1, finite(options.factor, 2))
        ),
        jitter: Math.min(
            1,
            Math.max(0, finite(options.jitter, 0.2))
        ),
    };
}

function reconnectDelay(
    attempt: number,
    config: Required<InternReconnectOptions>,
    random: number,
    serverRetry?: number
): number {
    const exponential =
        serverRetry ??
        Math.min(
            config.maxDelayMs,
            config.minDelayMs * config.factor ** Math.max(0, attempt - 1)
        );
    const bounded = Math.min(config.maxDelayMs, Math.max(0, exponential));
    const jittered =
        bounded *
        (1 - config.jitter + config.jitter * 2 * Math.min(1, Math.max(0, random)));
    return Math.round(jittered);
}

function shouldReconnect(error: InternClientError): boolean {
    return (
        error.retryable ||
        error.code === 'offline' ||
        error.code === 'timeout' ||
        (error.code === 'http' && (error.status ?? 0) >= 500)
    );
}

class BoundedEventKeys {
    private readonly values = new Set<string>();
    private readonly order: string[] = [];

    constructor(private readonly limit: number) {}

    hasOrAdd(key: string): boolean {
        if (this.values.has(key)) return true;
        this.values.add(key);
        this.order.push(key);
        while (this.order.length > this.limit) {
            const oldest = this.order.shift();
            if (oldest !== undefined) this.values.delete(oldest);
        }
        return false;
    }
}

export function createInternTransport(
    options: InternTransportOptions
): InternTransport {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new InternUnavailableError(
            'No Fetch-compatible transport is available.',
            { capability: 'fetch' }
        );
    }
    const clock = createClock(options.clock);
    const configuredTimeout =
        options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const configuredStreamTimeout =
        options.streamConnectTimeoutMs ?? DEFAULT_STREAM_CONNECT_TIMEOUT_MS;
    const configuredStreamInactivityTimeout =
        options.streamInactivityTimeoutMs ??
        DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS;

    const currentBaseUrl = (explicit?: string) =>
        normalizeBaseUrl(
            explicit ??
                (typeof options.baseUrl === 'function'
                    ? options.baseUrl()
                    : options.baseUrl)
        );

    const buildUrl = (path: string, explicitBaseUrl?: string): string =>
        `${currentBaseUrl(explicitBaseUrl)}${validatePath(path)}`;

    async function resolvedHeaders(
        method: InternHttpMethod,
        path: string,
        requestOptions: Pick<
            InternRequestOptions,
            'headers' | 'requireAuth' | 'baseUrl'
        >,
        accept: string
    ): Promise<{ headers: Headers; secrets: string[] }> {
        const requireAuth = requestOptions.requireAuth !== false;
        const baseUrl = currentBaseUrl(requestOptions.baseUrl);
        const headers = new Headers(requestOptions.headers);
        if (!headers.has('Accept')) headers.set('Accept', accept);
        const auth = requireAuth
            ? await options.resolveAuth?.({
                  method,
                  path,
                  baseUrl,
                  requireAuth,
              })
            : undefined;
        const authHeaders = new Headers(auth?.headers);
        authHeaders.forEach((value, key) => headers.set(key, value));
        const token = auth?.token?.trim();
        if (token) {
            headers.set(
                'Authorization',
                `${auth?.scheme?.trim() || 'Bearer'} ${token}`
            );
        }
        if (
            requireAuth &&
            options.resolveAuth &&
            !headers.has('Authorization')
        ) {
            throw new InternClientError(
                'unauthorized',
                'No credential is available for the selected host.',
                { status: 401 }
            );
        }
        const secrets: string[] = [];
        if (token) secrets.push(token);
        for (const [key, value] of headers.entries()) {
            if (
                /authorization|cookie|secret|password|token|api[_-]?key/i.test(
                    key
                )
            ) {
                secrets.push(value, value.replace(/^\S+\s+/, ''));
            }
        }
        return { headers, secrets: secrets.filter(Boolean) };
    }

    async function request<T = unknown>(
        path: string,
        requestOptions: InternRequestOptions<T> = {}
    ): Promise<T> {
        const method =
            requestOptions.method ??
            (requestOptions.body === undefined ? 'GET' : 'POST');
        const validatedPath = validatePath(path);
        const { headers, secrets } = await resolvedHeaders(
            method,
            validatedPath,
            requestOptions,
            'application/json'
        );
        let body: BodyInit | undefined;
        if (requestOptions.body !== undefined) {
            if (isRawBody(requestOptions.body)) {
                body = requestOptions.body as BodyInit;
            } else {
                body = JSON.stringify(requestOptions.body);
                if (!headers.has('Content-Type')) {
                    headers.set('Content-Type', 'application/json');
                }
            }
        }
        const scope = createAbortScope(
            requestOptions.signal,
            requestOptions.timeoutMs ?? configuredTimeout,
            clock
        );
        try {
            const response = await fetchImpl(
                buildUrl(validatedPath, requestOptions.baseUrl),
                {
                    method,
                    headers,
                    body,
                    cache: 'no-store',
                    signal: scope.signal,
                }
            );
            await requestOptions.onResponse?.({
                method,
                path: validatedPath,
                response,
            });
            if (
                !statusAccepted(response, requestOptions.acceptedStatuses)
            ) {
                const payload = await readResponsePayload(response);
                throw makeResponseError(response, payload, secrets);
            }
            const responseType = requestOptions.responseType ?? 'json';
            let value: unknown;
            if (responseType === 'void' || response.status === 204) {
                value = undefined;
            } else if (responseType === 'text') {
                value = await response.text();
            } else {
                try {
                    value = await response.json();
                } catch (error) {
                    throw new InternClientError(
                        'protocol',
                        'The host returned invalid JSON.',
                        {
                            status: response.status,
                            cause: error,
                            secrets,
                        }
                    );
                }
            }
            if (!requestOptions.parse) return value as T;
            try {
                return requestOptions.parse(value, response);
            } catch (error) {
                if (error instanceof InternClientError) throw error;
                throw new InternClientError(
                    'protocol',
                    'The host returned an invalid response.',
                    {
                        status: response.status,
                        details: redactInternSecrets(value, secrets),
                        cause: error,
                        secrets,
                    }
                );
            }
        } catch (error) {
            throw requestFailure(
                error,
                scope,
                requestOptions.signal,
                secrets
            );
        } finally {
            scope.dispose();
        }
    }

    async function* stream<T = unknown>(
        path: string,
        streamOptions: InternStreamOptions<T> = {}
    ): AsyncIterable<InternSseEvent<T>> {
        const method = streamOptions.method ?? 'GET';
        const reconnect = reconnectConfig(streamOptions.reconnect);
        const resume = streamOptions.resume;
        const queryParameter = resume?.queryParameter ?? 'cursor';
        const dedupeInput = streamOptions.dedupe;
        const dedupeOptions =
            dedupeInput === true
                ? {}
                : dedupeInput && typeof dedupeInput === 'object'
                  ? dedupeInput
                  : null;
        const eventKeys = dedupeOptions
            ? new BoundedEventKeys(
                  Math.max(1, Math.floor(dedupeOptions.maxEntries ?? 2048))
              )
            : null;
        let cursor =
            resume?.initialCursor === undefined
                ? undefined
                : String(resume.initialCursor);
        let attempt = 0;
        let serverRetry: number | undefined;

        while (true) {
            const attemptPath = appendCursor(path, queryParameter, cursor);
            const attemptHeaders = new Headers(streamOptions.headers);
            if (cursor && resume?.sendLastEventId) {
                attemptHeaders.set('Last-Event-ID', cursor);
            }
            const { headers, secrets } = await resolvedHeaders(
                method,
                attemptPath,
                { ...streamOptions, headers: attemptHeaders },
                'text/event-stream'
            );
            let body: BodyInit | undefined;
            if (streamOptions.body !== undefined) {
                if (isRawBody(streamOptions.body)) {
                    body = streamOptions.body as BodyInit;
                } else {
                    body = JSON.stringify(streamOptions.body);
                    if (!headers.has('Content-Type')) {
                        headers.set('Content-Type', 'application/json');
                    }
                }
            }
            const scope = createAbortScope(
                streamOptions.signal,
                streamOptions.timeoutMs ?? configuredStreamTimeout,
                clock
            );
            let failure: InternClientError | undefined;
            let ended = false;
            try {
                const response = await fetchImpl(
                    buildUrl(attemptPath, streamOptions.baseUrl),
                    {
                        method,
                        headers,
                        body,
                        cache: 'no-store',
                        signal: scope.signal,
                    }
                );
                const inactivityTimeout =
                    streamOptions.inactivityTimeoutMs ??
                    configuredStreamInactivityTimeout;
                scope.resetTimeout(inactivityTimeout);
                await streamOptions.onResponse?.({
                    method,
                    path: attemptPath,
                    response,
                });
                if (
                    !statusAccepted(
                        response,
                        streamOptions.acceptedStatuses
                    )
                ) {
                    const payload = await readResponsePayload(response);
                    throw makeResponseError(response, payload, secrets);
                }
                if (!response.body) {
                    throw new InternClientError(
                        'protocol',
                        'The host did not return an event stream.',
                        { status: response.status, secrets }
                    );
                }
                for await (const event of readInternSseStream<T>(
                    monitorStreamActivity(response.body, () =>
                        scope.resetTimeout(inactivityTimeout)
                    ),
                    scope.signal
                )) {
                    if (event.retry !== undefined) {
                        serverRetry = event.retry;
                    }
                    const nextCursor =
                        resume?.cursorFromEvent?.(event) ??
                        internSseEventCursor(
                            event as InternSseEvent<unknown>
                        );
                    if (nextCursor !== undefined) {
                        cursor = String(nextCursor);
                        event.cursor = cursor;
                    }
                    const key =
                        dedupeOptions?.key?.(event) ??
                        internSseEventKey(
                            event as InternSseEvent<unknown>
                        );
                    if (key && eventKeys?.hasOrAdd(key)) continue;
                    yield event;
                    if (streamOptions.isTerminal?.(event)) return;
                }
                if (scope.signal.aborted) {
                    throw (
                        scope.signal.reason ??
                        new DOMException('Aborted', 'AbortError')
                    );
                }
                ended = true;
            } catch (error) {
                failure = requestFailure(
                    error,
                    scope,
                    streamOptions.signal,
                    secrets
                );
            } finally {
                scope.dispose();
            }

            if (streamOptions.signal?.aborted) {
                throw (
                    failure ??
                    new InternClientError(
                        'aborted',
                        'The stream was stopped.'
                    )
                );
            }
            if (!reconnect) {
                if (failure) throw failure;
                return;
            }
            const reconnectFailure =
                failure ??
                new InternClientError(
                    'offline',
                    ended
                        ? 'The event stream ended before a terminal event.'
                        : 'The event stream disconnected.',
                    { retryable: true }
                );
            if (
                !shouldReconnect(reconnectFailure) ||
                attempt >= reconnect.maxAttempts
            ) {
                throw reconnectFailure;
            }
            attempt += 1;
            const delay = reconnectDelay(
                attempt,
                reconnect,
                clock.random(),
                serverRetry
            );
            try {
                await clock.sleep(delay, streamOptions.signal);
            } catch (error) {
                throw new InternClientError(
                    'aborted',
                    'The stream was stopped.',
                    { cause: error, secrets }
                );
            }
        }
    }

    return { buildUrl, request, stream };
}
