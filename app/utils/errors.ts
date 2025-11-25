// Minimal centralized error utility (Task 1.1)
// Provides: types, err(), isAppError(), asAppError(), reportError(), simpleRetry(), light scrub & duplicate suppression.

import { useHooks } from '~/core/hooks/useHooks';
import { useToast } from '#imports';

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

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
    | 'ERR_VALIDATION'
    | 'ERR_AUTH'
    | 'ERR_RATE_LIMIT'
    | 'ERR_UNSUPPORTED_MODEL'
    | 'ERR_HOOK_FAILURE';

export interface AppError extends Error {
    code: ErrorCode;
    severity: ErrorSeverity; // default 'error'
    retryable?: boolean;
    tags?: Record<string, string | number | boolean | undefined>;
    timestamp: number; // ms epoch
}

export type StandardError = AppError; // alias for wording continuity

// Factory
export function err(
    code: ErrorCode,
    message: string,
    o: {
        severity?: ErrorSeverity;
        retryable?: boolean;
        tags?: Record<string, string | number | boolean | undefined>;
        cause?: unknown;
    } = {}
): AppError {
    const e = new Error(message) as AppError;
    e.code = code;
    e.severity = o.severity || 'error';
    e.retryable = o.retryable;
    e.tags = o.tags;
    e.timestamp = Date.now();
    if (o.cause && e.cause === undefined) e.cause = o.cause;
    return e as AppError;
}

export function isAppError(v: unknown): v is AppError {
    return (
        !!v &&
        typeof v === 'object' &&
        'code' in (v as object) &&
        'severity' in (v as object)
    );
}

export function asAppError(
    v: unknown,
    fb: { code?: ErrorCode; message?: string } = {}
): AppError {
    if (isAppError(v)) return v;
    if (v instanceof Error)
        return err(
            fb.code || 'ERR_INTERNAL',
            v.message || fb.message || 'Error',
            { cause: (v as Error & { cause?: unknown }).cause }
        );
    if (typeof v === 'string') return err(fb.code || 'ERR_INTERNAL', v);
    return err(fb.code || 'ERR_INTERNAL', fb.message || 'Unknown error');
}

// Lightweight secret scrub (only obvious tokens)
function scrubValue(val: unknown): unknown {
    if (typeof val !== 'string') return val;
    if (/(api|key|secret|token)/i.test(val) && val.length > 8) return '***';
    return val.length > 8192 ? val.slice(0, 8192) + '…' : val;
}

// Duplicate suppression (code|message within window)
const recent = new Map<string, number>();
const SUPPRESS_MS = 300;
function shouldLog(code: string, message: string): boolean {
    const key = code + '|' + message;
    const now = Date.now();
    const last = recent.get(key) || 0;
    const dup = now - last < SUPPRESS_MS;
    recent.set(key, now);
    // Opportunistic prune (>1s old) every access (Req 14.1)
    // Map sizes expected to remain tiny (< few hundred); full scan OK.
    for (const [k, t] of recent) if (now - t > 1000) recent.delete(k);
    return !dup;
}

// Use Nuxt UI toast directly; no custom store.
function pushToast(error: AppError, retry?: () => void) {
    if (!import.meta.client) return;
    try {
        const { add } = useToast();
        add({
            id: error.timestamp + '-' + error.code,
            title: error.code,
            description: error.message,
            actions: retry
                ? [
                      {
                          label: 'Retry',
                          onClick: () => {
                              try {
                                  retry();
                              } catch { /* ignore */ }
                          },
                      },
                  ]
                : undefined,
            color:
                error.severity === 'fatal'
                    ? 'error'
                    : error.severity === 'warn'
                    ? 'warning'
                    : error.severity === 'info'
                    ? 'info'
                    : 'error',
        });
    } catch { /* ignore */ }
}

export interface ReportOptions {
    code?: ErrorCode;
    message?: string;
    tags?: Record<string, string | number | boolean | undefined>;
    toast?: boolean; // force toast even if info
    silent?: boolean; // never show toast
    retry?: () => void; // optional retry closure
    severity?: ErrorSeverity; // override severity if wrapping non-error
    retryable?: boolean; // override retryable
}

export function reportError(
    input: unknown,
    opts: ReportOptions = {}
): AppError {
    let e: AppError;
    try {
        e = asAppError(input, { code: opts.code, message: opts.message });
        if (opts.severity) e.severity = opts.severity;
        if (opts.retryable !== undefined) e.retryable = opts.retryable;
        if (opts.tags) e.tags = { ...(e.tags || {}), ...opts.tags };
        // Scrub shallow string fields
        e.message = scrubValue(e.message) as string;
        if (e.tags) {
            for (const k in e.tags) e.tags[k] = scrubValue(e.tags[k]) as string | number | boolean | undefined;
        }
        if (shouldLog(e.code, e.message)) {
            const level =
                e.severity === 'warn'
                    ? 'warn'
                    : e.severity === 'info'
                    ? 'info'
                    : 'error';
            console[level as 'warn' | 'info' | 'error']('[err]', {
                code: e.code,
                msg: e.message,
                severity: e.severity,
                retryable: !!e.retryable,
                tags: e.tags,
            });
        }
        const hooks = useHooks();
        void hooks.doAction('error:raised', e);
        const domain = e.tags?.domain as string | undefined;
        if (domain) void hooks.doAction('error:' + domain, e);
        if (domain === 'chat')
            void hooks.doAction('ai.chat.error:action', { error: e });
        if (
            !opts.silent &&
            !(e.code === 'ERR_STREAM_ABORTED' && e.severity === 'info')
        ) {
            if (opts.toast || e.severity !== 'info') pushToast(e, opts.retry);
        }
        return e;
    } catch (inner) {
        try {
            console.error('[reportError-fallback]', inner, input);
        } catch { /* ignore */ }
        // Best effort fallback error
        return err('ERR_INTERNAL', 'Reporting failed');
    }
}

export async function simpleRetry<T>(
    fn: () => Promise<T>,
    attempts = 2,
    delayMs = 400
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1)
                await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastErr;
}
