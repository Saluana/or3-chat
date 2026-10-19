import { useState } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    type LockPageRuntimeConfig,
    useLockPageRuntimeConfig,
} from './runtime';

const LOCK_PAGE_SESSION_TTL_MS = 5_000;

export type LockPageAccessReason =
    | 'disabled'
    | 'ssr-auth-disabled'
    | 'authenticated'
    | 'forbidden'
    | 'guest-allowed'
    | 'unauthenticated'
    | 'session-error';

export interface LockPageAccessResult {
    allowed: boolean;
    reason: LockPageAccessReason;
    session: SessionContext | null;
    errorMessage?: string;
}

function getSessionValidationState() {
    const validatedAt = useState<number>('lock-page-session-validated-at', () => 0);
    return { validatedAt };
}

function extractErrorMessage(error: unknown): string | undefined {
    if (!(error instanceof Error) || !error.message.trim()) return undefined;
    const message = error.message;
    // Raw request errors look like '[GET] "/api/auth/session": 429 …'.
    const rawRequestError = /^\[[A-Z]+\] "[^"]*": (\d{3})\b/.exec(message);
    const status = Number((error as { statusCode?: number }).statusCode) || Number(rawRequestError?.[1]);
    if (status === 429) {
        const seconds = /Retry after (\d+)s/.exec(message)?.[1];
        return seconds
            ? `Too many attempts. Please wait ${seconds} seconds and try again.`
            : 'Too many attempts. Please wait a minute and try again.';
    }
    if (rawRequestError) {
        // A 403 carries a sentence written for people ("A valid invite is
        // required to register."). Other raw request errors mean nothing to a
        // visitor, so the lock page falls back to its plain-language default.
        const detail = message.slice(rawRequestError[0].length).trim();
        return status === 403 && detail ? detail : undefined;
    }
    return message;
}

export function evaluateLockPageAccess(input: {
    config: LockPageRuntimeConfig;
    session: SessionContext | null;
    appAccessAllowed?: boolean;
    hadSessionError?: boolean;
}): LockPageAccessResult {
    const {
        config,
        session,
        appAccessAllowed,
        hadSessionError = false,
    } = input;

    if (!config.ssrAuthEnabled) {
        return {
            allowed: true,
            reason: 'ssr-auth-disabled',
            session,
        };
    }

    if (!config.enabled) {
        return {
            allowed: true,
            reason: 'disabled',
            session,
        };
    }

    if (hadSessionError) {
        return {
            allowed: false,
            reason: 'session-error',
            session,
        };
    }

    if (session?.authenticated) {
        if (appAccessAllowed === false) {
            return {
                allowed: false,
                reason: 'forbidden',
                session,
            };
        }

        return {
            allowed: true,
            reason: 'authenticated',
            session,
        };
    }

    if (config.guestAccessEnabled) {
        return {
            allowed: true,
            reason: 'guest-allowed',
            session,
        };
    }

    return {
        allowed: false,
        reason: 'unauthenticated',
        session,
    };
}

export async function resolveLockPageAccess(): Promise<LockPageAccessResult> {
    const config = useLockPageRuntimeConfig();
    // Refreshes explicitly below when it needs to, so skip the automatic load.
    const sessionState = useSessionContext({ autoLoad: false });
    const { validatedAt } = getSessionValidationState();
    const cachedPayload = sessionState.data.value;
    const cachedSession = cachedPayload?.session ?? null;

    if (!config.ssrAuthEnabled || !config.enabled) {
        return evaluateLockPageAccess({
            config,
            session: cachedSession,
            appAccessAllowed: cachedPayload?.appAccessAllowed,
        });
    }

    const now = Date.now();
    const shouldRefresh =
        sessionState.pending.value ||
        !sessionState.data.value ||
        now - validatedAt.value > LOCK_PAGE_SESSION_TTL_MS;

    let hadSessionError = Boolean(sessionState.error.value);
    let errorMessage = extractErrorMessage(sessionState.error.value);

    try {
        if (shouldRefresh) {
            // SSR refresh joins the pending useFetch request (dedupe: 'defer').
            // Wait for it before treating an empty startup payload as signed out.
            await sessionState.refresh();
            // Nuxt reports SSR failures through the error ref without rejecting.
            hadSessionError = Boolean(sessionState.error.value);
            errorMessage = extractErrorMessage(sessionState.error.value);
            validatedAt.value = hadSessionError ? 0 : Date.now();
        }
    } catch (error) {
        hadSessionError = true;
        // A new composable caller has its own error ref; it must retry rather
        // than trusting stale shared data after this failed validation.
        validatedAt.value = 0;
        errorMessage = extractErrorMessage(error) ?? errorMessage;
    }

    const payload = sessionState.data.value;
    const session = payload?.session ?? null;
    const result = evaluateLockPageAccess({
        config,
        session,
        appAccessAllowed: payload?.appAccessAllowed,
        hadSessionError,
    });

    return errorMessage ? { ...result, errorMessage } : result;
}
