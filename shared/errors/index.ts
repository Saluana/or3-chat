/** Shared boundary for error classification and safe user-facing copy.
 * Never trust upstream messages, HTML, response bodies or stacks as UI copy.
 * Diagnostics intentionally contain metadata only; causes remain local.
 */
export type ErrorCode =
    | 'ERR_INTERNAL'
    | 'ERR_STREAM_ABORTED'
    | 'ERR_STREAM_FAILURE'
    | 'ERR_NETWORK'
    | 'ERR_TIMEOUT'
    | 'ERR_DB_WRITE_FAILED'
    | 'ERR_DB_READ_FAILED'
    | 'ERR_DB_QUOTA_EXCEEDED'
    | 'ERR_FILE_VALIDATION'
    | 'ERR_FILE_PERSIST'
    | 'ERR_STORAGE_UPLOAD_FAILED'
    | 'ERR_STORAGE_DOWNLOAD_FAILED'
    | 'ERR_STORAGE_QUOTA_EXCEEDED'
    | 'ERR_STORAGE_FILE_NOT_FOUND'
    | 'ERR_STORAGE_PROVIDER_ERROR'
    | 'ERR_FILE_TOO_LARGE'
    | 'ERR_VALIDATION'
    | 'ERR_AUTH'
    | 'ERR_CREDITS'
    | 'ERR_FORBIDDEN'
    | 'ERR_RATE_LIMIT'
    | 'ERR_BAD_REQUEST'
    | 'ERR_NOT_FOUND'
    | 'ERR_SERVER'
    | 'ERR_PROVIDER'
    | 'ERR_OVERLOADED'
    | 'ERR_ABORTED'
    | 'ERR_UNKNOWN'
    | 'ERR_UNSUPPORTED_MODEL'
    | 'ERR_HOOK_FAILURE'
    | 'ERR_TOOL_OUTCOME_UNKNOWN'
    | 'ERR_SYNC_PAYLOAD_TOO_LARGE'
    | 'ERR_CONTEXT_FULL'
    | 'ERR_MODEL_METADATA_UNAVAILABLE'
    | 'ERR_CONTEXT_LIMIT_INVALID'
    | 'ERR_OUTPUT_LIMIT_INVALID';
export type ErrorSource =
    | 'provider'
    | 'session'
    | 'admin'
    | 'sync'
    | 'storage'
    | 'plugin'
    | 'network'
    | 'unknown';
export type CredentialSource = 'personal' | 'server' | 'session';
export type RecoveryAction = 'update_key' | 'sign_in' | 'add_credits';
export interface ErrorContext {
    code?: ErrorCode;
    source?: ErrorSource;
    credentialSource?: CredentialSource;
    /** App-owned operation fallback, never an exception/response message. */
    fallbackMessage?: string;
    operation?: 'login';
}
export interface ErrorMetadata {
    code: ErrorCode;
    status?: number;
    source: ErrorSource;
    credentialSource?: CredentialSource;
    providerCode?: string | number;
    retryAfterMs?: number;
    retryable: boolean;
}
export interface ErrorPresentation {
    title: string;
    message: string;
    action?: RecoveryAction;
}

const sources: ErrorSource[] = [
    'provider',
    'session',
    'admin',
    'sync',
    'storage',
    'plugin',
    'network',
    'unknown',
];
const credentials: CredentialSource[] = ['personal', 'server', 'session'];
const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const finite = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const knownCode = (v: unknown): v is ErrorCode =>
    typeof v === 'string' && Object.hasOwn(copy, v);

/** Redacts embedded credentials before bounding any app-owned text/tag. */
export function redactErrorText(text: string, maxLength = 400): string {
    return text
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[redacted]')
        .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
        .replace(
            /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
            '[redacted]',
        )
        .replace(
            /(["']?(?:password|passphrase|token|api[_-]?key|secret|authorization|access[_-]?token|refresh[_-]?token|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
            '$1[redacted]',
        )
        .slice(0, maxLength);
}

export function parseRetryAfter(
    value: string | null,
    now = Date.now(),
): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(value) - now;
    return Number.isFinite(ms) && ms >= 0
        ? Math.min(ms, 5 * 60_000)
        : undefined;
}

export function normalizeError(
    input: unknown,
    context: ErrorContext = {},
): ErrorMetadata {
    let e = record(input);
    const serialized =
        typeof input === 'string'
            ? input
            : input instanceof Error
              ? input.message
              : undefined;
    if (serialized && serialized.length <= 2048 && serialized.startsWith('{')) {
        try {
            const parsed = record(JSON.parse(serialized));
            if (knownCode(record(parsed.error).code))
                e = { ...e, data: parsed };
        } catch {
            /* Arbitrary text/HTML is not a structured error. */
        }
    }
    const data = record(e.data);
    const envelope = record(data.error);
    // Our envelope is explicit; arbitrary nested provider text is never promoted.
    const structured = knownCode(envelope.code)
        ? envelope
        : knownCode(data.code)
          ? data
          : e;
    const statusValue =
        finite(e.status) ??
        finite(e.statusCode) ??
        finite(structured.status) ??
        finite(data.statusCode);
    const status =
        statusValue !== undefined && statusValue >= 0 && statusValue <= 599
            ? statusValue
            : undefined;
    const sourceValue = context.source ?? structured.source ?? e.source;
    const source = sources.includes(sourceValue as ErrorSource)
        ? (sourceValue as ErrorSource)
        : (typeof e.name === 'string' && /ResponseError$/.test(e.name)) ||
            e.name === 'OpenRouterStreamError' ||
            e.name === 'OpenRouterProviderError' ||
            e.name === 'OpenRouterProtocolError' ||
            e.name === 'OpenRouterTimeoutError'
          ? 'provider'
          : status === 401
            ? 'session'
            : 'unknown';
    const credentialValue =
        context.credentialSource ??
        structured.credentialSource ??
        e.credentialSource;
    const credentialSource = credentials.includes(
        credentialValue as CredentialSource,
    )
        ? (credentialValue as CredentialSource)
        : undefined;
    let code: ErrorCode = knownCode(structured.code)
        ? structured.code
        : knownCode(e.code)
          ? e.code
          : (context.code ?? 'ERR_INTERNAL');
    // Specific semantics survive generic wrappers; a classified HTTP status wins
    // over generic transport/fallback codes, not domain validation/quota codes.
    const generic = [
        'ERR_INTERNAL',
        'ERR_UNKNOWN',
        'ERR_STREAM_FAILURE',
        'ERR_STORAGE_PROVIDER_ERROR',
        'ERR_STORAGE_UPLOAD_FAILED',
        'ERR_STORAGE_DOWNLOAD_FAILED',
    ].includes(code);
    const classificationStatus =
        status !== undefined && status > 0
            ? status
            : (finite(e.providerCode) ?? status);
    if (generic) {
        if (classificationStatus === 401) code = 'ERR_AUTH';
        else if (classificationStatus === 402) code = 'ERR_CREDITS';
        else if (classificationStatus === 403) code = 'ERR_FORBIDDEN';
        else if (classificationStatus === 429) code = 'ERR_RATE_LIMIT';
        else if (
            classificationStatus === 408 ||
            classificationStatus === 504 ||
            classificationStatus === 524
        )
            code = 'ERR_TIMEOUT';
        else if (classificationStatus === 400 || classificationStatus === 422)
            code = 'ERR_BAD_REQUEST';
        // A provider 404 means no model/endpoint can serve the request (retired
        // model, unsupported input, data policy), not a deleted user item.
        else if (classificationStatus === 404)
            code = source === 'provider' ? 'ERR_UNSUPPORTED_MODEL' : 'ERR_NOT_FOUND';
        else if (classificationStatus === 529) code = 'ERR_OVERLOADED';
        else if (
            classificationStatus !== undefined &&
            classificationStatus >= 500
        )
            code = source === 'provider' ? 'ERR_PROVIDER' : 'ERR_SERVER';
        else if (e.name === 'AbortError') code = 'ERR_ABORTED';
        else if (
            e.name === 'TypeError' &&
            /fetch|network|load failed/i.test(String(e.message))
        )
            code = 'ERR_NETWORK';
        else if (
            source === 'provider' &&
            classificationStatus === 0 &&
            e.kind === 'transport'
        )
            code = 'ERR_NETWORK';
    }
    if (e.name === 'SyncPayloadTooLargeError')
        code = 'ERR_SYNC_PAYLOAD_TOO_LARGE';
    const contextCodes: Record<string, ErrorCode> = {
        context_full: 'ERR_CONTEXT_FULL', model_metadata_unavailable: 'ERR_MODEL_METADATA_UNAVAILABLE',
        invalid_context_limit: 'ERR_CONTEXT_LIMIT_INVALID', invalid_output_limit: 'ERR_OUTPUT_LIMIT_INVALID',
    };
    const domainCode = data.code ?? e.code;
    if (typeof domainCode === 'string' && Object.hasOwn(contextCodes, domainCode)) code = contextCodes[domainCode]!;
    const reportedProviderCode = (!knownCode(envelope.code) ? envelope.code : undefined)
        ?? structured.providerCode ?? e.providerCode;
    if (reportedProviderCode === 'context_length_exceeded' || reportedProviderCode === 'context_window_exceeded') code = 'ERR_CONTEXT_FULL';
    const normallyRetryable = [
        'ERR_NETWORK',
        'ERR_TIMEOUT',
        'ERR_RATE_LIMIT',
        'ERR_SERVER',
        'ERR_PROVIDER',
        'ERR_OVERLOADED',
    ].includes(code);
    const declared = structured.retryable ?? e.retryable;
    // Explicit domain retry policy survives; HTTP auth/validation never retries.
    const permanent =
        [
            'ERR_AUTH',
            'ERR_CREDITS',
            'ERR_FORBIDDEN',
            'ERR_BAD_REQUEST',
            'ERR_VALIDATION',
            'ERR_ABORTED',
            'ERR_STREAM_ABORTED',
            'ERR_DB_QUOTA_EXCEEDED',
            'ERR_STORAGE_QUOTA_EXCEEDED',
            'ERR_FILE_VALIDATION',
            'ERR_FILE_TOO_LARGE',
            'ERR_TOOL_OUTCOME_UNKNOWN',
            'ERR_SYNC_PAYLOAD_TOO_LARGE',
            'ERR_CONTEXT_FULL', 'ERR_MODEL_METADATA_UNAVAILABLE', 'ERR_CONTEXT_LIMIT_INVALID', 'ERR_OUTPUT_LIMIT_INVALID',
        ].includes(code) ||
        (status !== undefined &&
            status >= 400 &&
            status < 500 &&
            ![408, 429].includes(status));
    const retryable =
        !permanent &&
        (typeof declared === 'boolean' ? declared : normallyRetryable);
    const rawProviderCode = reportedProviderCode;
    const providerCode =
        typeof rawProviderCode === 'number' && Number.isFinite(rawProviderCode)
            ? rawProviderCode
            : typeof rawProviderCode === 'string' &&
                [
                    'invalid_api_key',
                    'rate_limit_exceeded',
                    'insufficient_credits',
                    'provider_error',
                    'model_not_found',
                    'content_filter',
                    'overloaded',
                    'bad_request',
                    'context_length_exceeded', 'context_window_exceeded',
                ].includes(rawProviderCode)
              ? rawProviderCode
              : undefined;
    const delay =
        finite(structured.retryAfterMs) ??
        finite(e.retryAfterMs) ??
        (e.headers instanceof Headers
            ? parseRetryAfter(e.headers.get('retry-after'))
            : undefined);
    return {
        code,
        status,
        source,
        credentialSource,
        providerCode,
        retryAfterMs:
            delay !== undefined && delay >= 0
                ? Math.min(delay, 300_000)
                : undefined,
        retryable,
    };
}

const copy: Record<ErrorCode, [string, string]> = {
    ERR_CONTEXT_FULL: ['Context full', 'Context full — compact, edit the request, or choose a larger supported model.'],
    ERR_MODEL_METADATA_UNAVAILABLE: ['Model capacity unavailable', 'Model capacity is unavailable. Refresh models or choose a model with known capacity.'],
    ERR_CONTEXT_LIMIT_INVALID: ['Invalid context maximum', 'Choose a positive maximum context value or use the model limit.'],
    ERR_OUTPUT_LIMIT_INVALID: ['Invalid reply allowance', 'The requested reply allowance exceeds this model’s output limit or is invalid.'],
    ERR_TOOL_OUTCOME_UNKNOWN: [
        'Tool outcome unknown',
        'A tool may have already run. Check its result before retrying to avoid repeating a side effect.',
    ],
    ERR_SYNC_PAYLOAD_TOO_LARGE: [
        'Change too large to sync',
        'This change exceeds sync limits. Reduce its size before trying again.',
    ],
    ERR_INTERNAL: [
        'Something went wrong',
        'The operation could not be completed. Please try again.',
    ],
    ERR_UNKNOWN: [
        'Something went wrong',
        'The operation could not be completed. Please try again.',
    ],
    ERR_STREAM_FAILURE: [
        'Response interrupted',
        'The AI response could not be completed. Try sending your message again.',
    ],
    ERR_STREAM_ABORTED: ['Response stopped', 'The response was stopped.'],
    ERR_ABORTED: ['Request cancelled', 'The request was cancelled.'],
    ERR_NETWORK: ['Connection problem', 'Check your connection and try again.'],
    ERR_TIMEOUT: [
        'Request timed out',
        'The request took too long. Please try again.',
    ],
    ERR_AUTH: ['Sign in required', 'Sign in to OR3 again to continue.'],
    ERR_CREDITS: [
        'OpenRouter credits needed',
        'Add credits to your OpenRouter account, then try again.',
    ],
    ERR_FORBIDDEN: [
        'Access denied',
        'You do not have permission for this operation. Check your access or contact your administrator.',
    ],
    ERR_RATE_LIMIT: [
        'Too many requests',
        'Please wait a moment before trying again.',
    ],
    ERR_BAD_REQUEST: [
        'Request could not be accepted',
        'Check your input and the selected model, then try again.',
    ],
    ERR_VALIDATION: [
        'Check your input',
        'Check the values you entered and try again.',
    ],
    ERR_NOT_FOUND: [
        'Item unavailable',
        'This item could not be found. Refresh and check that it still exists.',
    ],
    ERR_SERVER: [
        'Service unavailable',
        'The service could not complete the request. Please try again later.',
    ],
    ERR_PROVIDER: [
        'AI provider unavailable',
        'The AI provider could not complete the request. Please try again later.',
    ],
    ERR_OVERLOADED: [
        'AI provider busy',
        'The AI provider is busy. Please try again shortly.',
    ],
    ERR_UNSUPPORTED_MODEL: [
        'Model unavailable',
        'Choose another model and try again.',
    ],
    ERR_DB_READ_FAILED: [
        'Could not load local data',
        'Local data could not be read. Please try again.',
    ],
    ERR_DB_WRITE_FAILED: [
        'Could not save locally',
        'Your changes could not be saved in this browser. Please try again.',
    ],
    ERR_DB_QUOTA_EXCEEDED: [
        'Browser storage full',
        'Free some browser storage or remove unneeded files, then try again.',
    ],
    ERR_FILE_VALIDATION: [
        'Attachment not accepted',
        'Check the attachment type, size and number of files.',
    ],
    ERR_FILE_TOO_LARGE: [
        'File too large',
        'Choose a smaller file and try again.',
    ],
    ERR_FILE_PERSIST: [
        'Could not save attachment',
        'The attachment could not be saved. Please try attaching it again.',
    ],
    ERR_STORAGE_UPLOAD_FAILED: [
        'Upload failed',
        'The file could not be uploaded. Please try again.',
    ],
    ERR_STORAGE_DOWNLOAD_FAILED: [
        'Download failed',
        'The file could not be downloaded. Please try again.',
    ],
    ERR_STORAGE_QUOTA_EXCEEDED: [
        'Workspace storage full',
        'Remove unneeded files or contact your administrator to increase storage.',
    ],
    ERR_STORAGE_FILE_NOT_FOUND: [
        'File unavailable',
        'The file could not be found. Check that it still exists.',
    ],
    ERR_STORAGE_PROVIDER_ERROR: [
        'File transfer failed',
        'The file transfer could not be completed. Please try again.',
    ],
    ERR_HOOK_FAILURE: [
        'Extension problem',
        'An extension could not complete this operation. Try again or contact its maintainer.',
    ],
};

export function presentError(
    input: unknown,
    context: ErrorContext = {},
): ErrorPresentation {
    const e = normalizeError(input, context);
    let [title, message] = copy[e.code];
    let action: RecoveryAction | undefined;
    if (e.code === 'ERR_AUTH') {
        if (e.source === 'provider') {
            if (e.credentialSource === 'server') {
                title = 'Server AI connection needs attention';
                message =
                    'The server OpenRouter key was rejected. Contact your administrator to update it.';
            } else if (e.credentialSource === 'personal') {
                title = 'OpenRouter key rejected';
                message =
                    'Check your OpenRouter API key and update it, then try again.';
                action = 'update_key';
            } else {
                title = 'AI connection needs attention';
                message =
                    'OpenRouter authorization failed. Check your connection settings or contact your administrator.';
            }
        } else if (context.operation === 'login') {
            title = 'Sign-in failed';
            message = 'Check your sign-in details and try again.';
        } else action = 'sign_in';
    } else if (e.code === 'ERR_CREDITS') {
        if (e.credentialSource === 'server')
            message =
                'The server OpenRouter account needs credits. Contact your administrator.';
        else if (e.credentialSource === 'personal') action = 'add_credits';
    } else if (e.code === 'ERR_RATE_LIMIT' && e.retryAfterMs) {
        message = `Please wait ${Math.ceil(e.retryAfterMs / 1000)} seconds before trying again.`;
    }
    if (
        context.fallbackMessage &&
        ![
            'ERR_AUTH',
            'ERR_CREDITS',
            'ERR_FORBIDDEN',
            'ERR_RATE_LIMIT',
            'ERR_NETWORK',
            'ERR_TIMEOUT',
            'ERR_SERVER',
            'ERR_PROVIDER',
            'ERR_OVERLOADED',
            'ERR_CONTEXT_FULL', 'ERR_MODEL_METADATA_UNAVAILABLE', 'ERR_CONTEXT_LIMIT_INVALID', 'ERR_OUTPUT_LIMIT_INVALID',
        ].includes(e.code)
    ) {
        message = redactErrorText(context.fallbackMessage);
    }
    return { title, message, action };
}

/** The only diagnostic fields permitted in public UI, logs or wire envelopes. */
export function errorDiagnostics(
    input: unknown,
    context: ErrorContext = {},
): ErrorMetadata {
    return normalizeError(input, context);
}

/** Response envelope for the provider proxy; no upstream text or key material. */
export function publicErrorEnvelope(
    input: unknown,
    context: ErrorContext = {},
) {
    const error = normalizeError(input, context);
    return {
        error: { ...error, message: presentError(error, context).message },
    };
}

/** Background providers persist an error string; retain metadata in that existing field. */
export function serializeError(
    input: unknown,
    context: ErrorContext = {},
): string {
    return JSON.stringify(publicErrorEnvelope(input, context));
}
