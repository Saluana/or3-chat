/**
 * @module app/utils/errors
 *
 * Purpose:
 * Minimal, centralized error utilities used across OR3.
 * Provides a consistent error shape, reporting hooks, and lightweight
 * duplicate suppression.
 *
 * Behavior:
 * - `err` creates typed `AppError` objects with metadata
 * - `reportError` emits hooks, logs with dedupe, and optionally shows toasts
 * - `simpleRetry` provides a small retry helper for transient failures
 *
 * Constraints:
 * - Primary copy comes from shared classification and app-owned fallbacks
 * - Logging is best-effort and should not throw
 *
 * Non-Goals:
 * - Full telemetry pipeline
 * - Uploading diagnostic causes or response bodies to telemetry
 */

import { tryGetHooks, useHooks } from '~/core/hooks/useHooks';
import {
    normalizeError,
    presentError,
    errorDiagnostics,
    redactErrorText,
    type ErrorMetadata,
    type ErrorContext,
    type RecoveryAction,
    type ErrorCode,
} from '~~/shared/errors';
export type { ErrorCode } from '~~/shared/errors';

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface AppError extends Error, ErrorMetadata {
    code: ErrorCode;
    severity: ErrorSeverity; // default 'error'
    retryable: boolean;
    tags?: Record<string, string | number | boolean | undefined>;
    timestamp: number; // ms epoch
}

export type StandardError = AppError; // alias for wording continuity

// Only explicit app-owned presentation context can survive another boundary.
// Exception messages and objects claiming to be AppErrors never establish trust.
const trustedErrorContexts = new WeakMap<
    Error,
    Pick<ErrorContext, 'fallbackMessage' | 'operation'>
>();

/**
 * `err`
 *
 * Purpose:
 * Creates an `AppError` with consistent metadata for reporting and UI.
 */
export function err(
    code: ErrorCode,
    message: string,
    o: Partial<Omit<ErrorMetadata, 'code'>> & {
        severity?: ErrorSeverity;
        retryable?: boolean;
        tags?: Record<string, string | number | boolean | undefined>;
        cause?: unknown;
    } = {},
): AppError {
    const e = new Error(message) as AppError;
    e.code = code;
    e.severity = o.severity || 'error';
    Object.assign(e, normalizeError({ ...o, code }));
    e.tags = o.tags;
    e.timestamp = Date.now();
    if (o.cause && e.cause === undefined) e.cause = o.cause;
    return e;
}

/**
 * `isAppError`
 *
 * Purpose:
 * Type guard for `AppError`.
 */
export function isAppError(v: unknown): v is AppError {
    return !!v && typeof v === 'object' && 'code' in v && 'severity' in v;
}

/**
 * `asAppError`
 *
 * Purpose:
 * Normalizes unknown values into `AppError` instances.
 */
export function asAppError(
    v: unknown,
    fb: ErrorContext & { message?: string } = {},
): AppError {
    const inherited =
        v instanceof Error ? trustedErrorContexts.get(v) : undefined;
    const context = {
        ...fb,
        fallbackMessage:
            fb.message ?? fb.fallbackMessage ?? inherited?.fallbackMessage,
        operation: fb.operation ?? inherited?.operation,
    };
    const metadata = normalizeError(v, context);
    const presentation = presentError(metadata, context);
    const original = v && typeof v === 'object' ? (v as Partial<AppError>) : {};
    const e = err(metadata.code, presentation.message, {
        ...metadata,
        severity: original.severity,
        tags: original.tags,
        cause: v,
    });
    if (
        context.fallbackMessage !== undefined ||
        context.operation !== undefined
    ) {
        trustedErrorContexts.set(e, {
            fallbackMessage:
                context.fallbackMessage === undefined
                    ? undefined
                    : redactErrorText(context.fallbackMessage),
            operation: context.operation,
        });
    }
    if (isAppError(v) && v.timestamp) e.timestamp = v.timestamp;
    return e;
}

const LOG_TAGS = new Set(['domain', 'stage', 'op', 'entity', 'rw', 'attempt']);
function safeLogTags(tags: AppError['tags']) {
    return Object.fromEntries(
        Object.entries(tags ?? {})
            .filter(
                ([key, value]) =>
                    LOG_TAGS.has(key) &&
                    (typeof value !== 'string' ||
                        /^[a-z_:-]{1,64}$/.test(value)),
            )
            .map(([key, value]) => [
                key,
                typeof value === 'string' ? redactErrorText(value, 80) : value,
            ]),
    );
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

type ToastAction = {
    label: string;
    onClick: () => void;
};

type ToastPayload = {
    id?: string | number;
    title?: string;
    description?: string;
    actions?: ToastAction[];
    color?:
        | 'primary'
        | 'secondary'
        | 'error'
        | 'success'
        | 'warning'
        | 'info'
        | 'neutral';
    duration?: number;
};

export type ErrorToastApi = {
    add: (toast: ToastPayload) => void;
};

let errorToastApi: ErrorToastApi | null = null;
type ErrorRecoveryApi = Partial<Record<RecoveryAction, () => void>> & {
    details?: (error: ErrorMetadata) => void;
};
let errorRecoveryApi: ErrorRecoveryApi = {};
export function setErrorRecoveryApi(api: ErrorRecoveryApi): void {
    errorRecoveryApi = api;
}

/**
 * Registers the Nuxt UI toast instance captured while a client plugin has an
 * active Vue injection context. Error reporting often runs later from async
 * hooks, where calling `useToast()` directly would trigger a Vue warning.
 */
export function setErrorToastApi(api: ErrorToastApi | null): void {
    errorToastApi = api;
}

// Use Nuxt UI toast directly; no custom store.
function pushToast(error: AppError, retry?: () => void) {
    const toast = errorToastApi;
    if (!toast) return;
    try {
        const presentation = presentError(error, {
            ...trustedErrorContexts.get(error),
            fallbackMessage: error.message,
        });
        const actions: ToastAction[] = [];
        const labels = {
            update_key: 'Update API key',
            sign_in: 'Sign in',
            add_credits: 'Add credits',
        };
        if (presentation.action && errorRecoveryApi[presentation.action]) {
            const recover = errorRecoveryApi[presentation.action]!;
            actions.push({
                label: labels[presentation.action],
                onClick: recover,
            });
        }
        if (
            retry &&
            error.retryable &&
            Date.now() >= error.timestamp + (error.retryAfterMs ?? 0)
        )
            actions.push({
                label: 'Retry',
                onClick: () => {
                    try {
                        retry();
                    } catch {
                        /* reporting is best effort */
                    }
                },
            });
        if (errorRecoveryApi.details)
            actions.push({
                label: 'Details',
                onClick: () => {
                    errorRecoveryApi.details?.(errorDiagnostics(error));
                },
            });
        toast.add({
            title: presentation.title,
            description: presentation.message,
            actions: actions.length ? actions : undefined,
            duration: presentation.action ? 0 : 8000,
            color:
                error.severity === 'fatal'
                    ? 'error'
                    : error.severity === 'warn'
                      ? 'warning'
                      : error.severity === 'info'
                        ? 'info'
                        : 'error',
        });
    } catch {
        /* ignore */
    }
}

export interface ReportOptions extends ErrorContext {
    code?: ErrorCode;
    message?: string;
    tags?: Record<string, string | number | boolean | undefined>;
    toast?: boolean; // override the severity-based toast default
    silent?: boolean; // never show toast
    retry?: () => void; // optional retry closure
    severity?: ErrorSeverity; // override severity if wrapping non-error
    retryable?: boolean; // override retryable
}

/**
 * `reportError`
 *
 * Purpose:
 * Central reporting path that logs, emits hooks, and optionally shows toasts.
 *
 * Behavior:
 * - Suppresses duplicates within a short window
 * - Emits `error:raised` and domain-specific hooks
 * - Scrubs obvious token-like strings in messages and tags
 */
export function reportError(
    input: unknown,
    opts: ReportOptions = {},
): AppError {
    let e: AppError;
    try {
        e = asAppError(input, opts);
        if (opts.severity) e.severity = opts.severity;
        if (opts.retryable !== undefined)
            e.retryable = normalizeError({
                ...e,
                retryable: opts.retryable,
            }).retryable;
        if (opts.tags) e.tags = { ...(e.tags || {}), ...opts.tags };
        if (shouldLog(e.code, e.message)) {
            const level =
                e.severity === 'warn'
                    ? 'warn'
                    : e.severity === 'info'
                      ? 'info'
                      : 'error';
            console[level]('[err]', {
                msg: e.message,
                severity: e.severity,
                tags: safeLogTags(e.tags),
                ...errorDiagnostics(e),
            });
        }
        // Prefer inject-free cache; fall back to useHooks only on SSR where
        // request context is available and the client cache is intentionally unset.
        const hooks =
            tryGetHooks() ??
            (import.meta.server
                ? (() => {
                      try {
                          return useHooks();
                      } catch {
                          return null;
                      }
                  })()
                : null);
        if (hooks) {
            void hooks.doAction('error:raised', e);
            const domain = e.tags?.domain as string | undefined;
            if (domain) void hooks.doAction('error:' + domain, e);
            if (domain === 'chat')
                void hooks.doAction('ai.chat.error:action', { error: e });
        }
        const shouldToast = opts.toast ?? e.severity !== 'info';
        if (
            !opts.silent &&
            shouldToast &&
            !(e.code === 'ERR_STREAM_ABORTED' && e.severity === 'info')
        ) {
            pushToast(e, opts.retry);
        }
        return e;
    } catch (inner) {
        try {
            console.error('[reportError-fallback]', errorDiagnostics(inner));
        } catch {
            /* ignore */
        }
        // Best effort fallback error
        return err('ERR_INTERNAL', 'Reporting failed');
    }
}

/**
 * `simpleRetry`
 *
 * Purpose:
 * Retries an async operation with a fixed delay.
 */
export async function simpleRetry<T>(
    fn: () => Promise<T>,
    attempts = 2,
    delayMs = 400,
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
